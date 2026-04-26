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
