-- ============================================================
-- Migration: Cache + Usage Logs
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Unique constraint on chargers_cache for upsert
ALTER TABLE chargers_cache
  ADD CONSTRAINT chargers_cache_city_state_unique UNIQUE (city, state);

-- 2. Usage logs table
CREATE TABLE IF NOT EXISTS usage_logs (
  id              serial PRIMARY KEY,
  user_id         uuid REFERENCES auth.users,
  module          text NOT NULL,
  city            text,
  claude_tokens_in  int DEFAULT 0,
  claude_tokens_out int DEFAULT 0,
  claude_cost_usd   decimal DEFAULT 0,
  google_places_queries int DEFAULT 0,
  google_places_cost_usd decimal DEFAULT 0,
  total_cost_usd  decimal DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE usage_logs DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_module ON usage_logs (module);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs (created_at);

-- 3. ev_chargers — banco próprio de carregadores que cresce a cada análise
CREATE TABLE IF NOT EXISTS ev_chargers (
  id            serial PRIMARY KEY,
  city          text NOT NULL,
  state         text NOT NULL,
  name          text,
  address       text,
  lat           decimal,
  lng           decimal,
  power_kw      decimal DEFAULT 0,
  charger_type  text DEFAULT 'unknown',
  connector     text,
  operator      text,
  source        text,
  verified      boolean DEFAULT false,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
ALTER TABLE ev_chargers DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_ev_chargers_city ON ev_chargers (city);
CREATE INDEX IF NOT EXISTS idx_ev_chargers_location ON ev_chargers (lat, lng);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ev_chargers_unique ON ev_chargers (lat, lng, name);

-- 4. point_pois_cache — POIs por ponto (raio fixo 500m/1km/2km/3km/5km) para reuso
CREATE TABLE IF NOT EXISTS point_pois_cache (
  id          bigserial PRIMARY KEY,
  lat         decimal NOT NULL,
  lng         decimal NOT NULL,
  city        text,
  state       text,
  pois_json   jsonb NOT NULL,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE point_pois_cache DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_point_pois_cache_loc ON point_pois_cache (lat, lng);
CREATE INDEX IF NOT EXISTS idx_point_pois_cache_city ON point_pois_cache (city);
CREATE INDEX IF NOT EXISTS idx_point_pois_cache_created ON point_pois_cache (created_at);

-- 5. city_ev_data — dados manuais por cidade (frota EV + carregadores AC/DC)
-- Cache que cresce conforme analistas preenchem, sobrepondo ABVE quando disponível.
CREATE TABLE IF NOT EXISTS city_ev_data (
  id              serial PRIMARY KEY,
  city            text NOT NULL,
  state           text NOT NULL,
  bev             integer,
  phev            integer,
  total_evs       integer GENERATED ALWAYS AS (COALESCE(bev, 0) + COALESCE(phev, 0)) STORED,
  chargers_ac     integer,
  chargers_dc     integer,
  total_chargers  integer GENERATED ALWAYS AS (COALESCE(chargers_ac, 0) + COALESCE(chargers_dc, 0)) STORED,
  source          text DEFAULT 'manual',
  updated_by      text,
  updated_at      timestamptz DEFAULT now(),
  UNIQUE(city, state)
);
ALTER TABLE city_ev_data DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_city_ev_data_city_state ON city_ev_data (city, state);

-- DC na cidade (total) revisado na tela de revisão (admin). Escopo cidade, então
-- persiste aqui; já os DC por raio (200m/500m/1km/2km) são sempre buscados frescos
-- via ev_chargers por proximidade ao endereço e NÃO são persistidos.
ALTER TABLE city_ev_data ADD COLUMN IF NOT EXISTS dc_in_city integer;

-- ============================================================
-- 6. censo_setores — renda por setor censitário (Censo 2022 do IBGE)
--
-- Carregado POR MUNICÍPIO, sob demanda, pelo comando de operação
--   npm run ingerir-renda -- --municipio <código IBGE de 7 dígitos>
-- porque o IBGE publica malha por estado (São Paulo tem 170 MB) e ninguém pode
-- esperar esse download no meio da geração de um mapa.
--
-- Tamanho medido (geometria, Censo 2022): São Paulo capital 16,1 MB (27.301
-- setores) · Florianópolis 2,6 MB · Curitiba 1,4 MB · cidade média ~0,4 MB.
-- Município mediano do Brasil: ~0,08 MB.
--
-- RENDA É DO RESPONSÁVEL PELO DOMICÍLIO (variáveis V06004 média e V06006
-- mediana), não renda domiciliar total nem per capita — o Censo 2022 só publica
-- essas por município. Subestima domicílio com mais de uma renda; o viés é
-- parecido entre regiões, então serve para COMPARAR bairros. Essa ressalva vai
-- no relatório de execução, nunca no HTML do cliente.
--
-- Valores em REAIS DE 2022 (salário mínimo de 2022 = R$ 1.212,00). Faixa é
-- calculada em múltiplos de salário mínimo do ano do dado, para não envelhecer.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS censo_setores (
  cd_setor      text PRIMARY KEY,
  cd_mun        text NOT NULL,
  nm_mun        text,
  uf            text,
  situacao      text,                    -- Urbana | Rural
  geom          extensions.geometry(MultiPolygon, 4326) NOT NULL,
  renda_media   numeric,                 -- V06004, R$ de 2022
  renda_mediana numeric,                 -- V06006, R$ de 2022
  responsaveis  integer,                 -- V06001
  ano_dado      integer NOT NULL DEFAULT 2022,
  carregado_em  timestamptz DEFAULT now()
);
ALTER TABLE censo_setores DISABLE ROW LEVEL SECURITY;

-- Índice espacial: é ele que faz o "em que setor esta coordenada cai" ser rápido.
CREATE INDEX IF NOT EXISTS idx_censo_setores_geom ON censo_setores USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_censo_setores_mun ON censo_setores (cd_mun);

-- Controle do que já foi carregado, para o card do painel de admin e para o
-- comando saber o que pular.
CREATE TABLE IF NOT EXISTS censo_municipios_carregados (
  cd_mun        text PRIMARY KEY,
  nm_mun        text,
  uf            text,
  setores       integer NOT NULL,
  bytes_geom    bigint,
  ano_dado      integer NOT NULL DEFAULT 2022,
  carregado_em  timestamptz DEFAULT now()
);
ALTER TABLE censo_municipios_carregados DISABLE ROW LEVEL SECURITY;

-- Função usada pela geração do mapa: coordenada -> setor -> renda.
-- ST_CoveredBy, não ST_Contains: ponto exatamente na divisa de dois setores
-- retorna falso nos DOIS com ST_Contains, e o ponto ficaria sem renda.
CREATE OR REPLACE FUNCTION renda_do_ponto(lat double precision, lng double precision)
RETURNS TABLE (cd_setor text, cd_mun text, situacao text, renda_media numeric, renda_mediana numeric)
LANGUAGE sql STABLE AS $$
  SELECT s.cd_setor, s.cd_mun, s.situacao, s.renda_media, s.renda_mediana
  FROM censo_setores s
  WHERE extensions.ST_CoveredBy(
          extensions.ST_SetSRID(extensions.ST_MakePoint(lng, lat), 4326),
          s.geom)
  LIMIT 1;
$$;

-- Card do painel de admin: quanto ocupa e quanto falta para o limite do plano.
CREATE OR REPLACE VIEW censo_uso_do_banco AS
  SELECT
    (SELECT count(*) FROM censo_municipios_carregados)                AS municipios,
    (SELECT count(*) FROM censo_setores)                              AS setores,
    pg_total_relation_size('censo_setores')                           AS bytes_tabela,
    pg_size_pretty(pg_total_relation_size('censo_setores'))           AS tamanho,
    pg_database_size(current_database())                              AS bytes_banco,
    pg_size_pretty(pg_database_size(current_database()))              AS tamanho_banco;

-- ============================================================
-- 7. ibge_municipios — população e PIB de TODOS os municípios (IBGE)
--
-- O Score do Ponto e o Mapa de Calor leem daqui, sem depender do IBGE estar no
-- ar na hora da geração. Desde 22/10/2026 o IBGE não responde às funções da
-- Vercel (EUA), embora responda normalmente de dentro do Brasil.
--
-- Carregada pelo comando de operação
--   node --import tsx scripts/ibge/carga-municipios.ts
-- que gera arquivos SQL para colar AQUI, no editor do painel (uma vez por ano:
-- população sai ~agosto, PIB municipal ~dezembro, com 2 anos de defasagem).
--
-- SÓ LEITURA para o app: segurança de linha ligada e uma única regra, de
-- leitura. Nem a chave pública nem usuário logado gravam aqui — população e PIB
-- alimentam relatórios, e tabela aberta para escrita deixaria qualquer um trocar
-- a população de uma cidade. O editor do painel grava (roda como dono).
--
-- 5.571 linhas, ~1 MB com índice.
-- ============================================================

CREATE TABLE IF NOT EXISTS ibge_municipios (
  cd_mun         integer PRIMARY KEY,          -- código IBGE de 7 dígitos
  nome           text NOT NULL,
  nome_busca     text NOT NULL,                -- nome em minúsculas (mesma regra da busca no app)
  uf             text NOT NULL,
  populacao      integer NOT NULL CHECK (populacao > 0),
  ano_populacao  integer NOT NULL,
  pib_mil        numeric CHECK (pib_mil > 0),  -- PIB total em R$ mil; NULL = IBGE ainda não publicou
  ano_pib        integer,
  carregado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (uf, nome_busca)
);

ALTER TABLE ibge_municipios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ibge_municipios_leitura ON ibge_municipios;
CREATE POLICY ibge_municipios_leitura ON ibge_municipios FOR SELECT TO anon, authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ibge_municipios FROM anon, authenticated;
