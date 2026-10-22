/**
 * Carga da base de municípios do IBGE (população e PIB de TODOS os municípios)
 * na tabela ibge_municipios, que o Score do Ponto e o Mapa de Calor leem.
 *
 * Comando de OPERAÇÃO, rodado uma vez por ano (população sai ~agosto, PIB
 * municipal ~dezembro). Roda da sua máquina, no Brasil — o IBGE não responde às
 * funções da Vercel desde 22/10/2026.
 *
 *   node --import tsx scripts/ibge/carga-municipios.ts
 *
 * NÃO grava no banco: a tabela é só leitura para o app (nem a chave pública
 * grava). Gera arquivos SQL em .ibge-carga/ para colar no editor SQL do painel
 * do Supabase, uma parte por vez. Rodar de novo atualiza as linhas, não duplica.
 *
 * Depois de colar, confira (só leitura, com a chave pública):
 *
 *   node --env-file=.env.local --import tsx scripts/ibge/carga-municipios.ts --conferir
 *
 * Pré-requisito: supabase-migrations.sql (seção 7) rodada no painel.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ibgeFetch } from "../../src/lib/ibge-fetch";
import { nomeBusca, ultimoValor } from "../../src/lib/ibge-municipio";

const IBGE = "https://servicodados.ibge.gov.br/api";
const LINHAS_POR_PARTE = 1000;
const outDir = path.join(process.cwd(), ".ibge-carga");

interface Municipio {
  cd_mun: number;
  nome: string;
  nome_busca: string;
  uf: string;
  populacao: number;
  ano_populacao: number;
  pib_mil: number | null;
  ano_pib: number | null;
}

async function getJson(url: string): Promise<unknown> {
  const res = await ibgeFetch(url, { timeoutMs: 60_000 });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.json();
}

type Series = { localidade: { id: string }; serie: Record<string, string> }[];

/** id do município -> último valor da série, com o ano. */
function porMunicipio(data: unknown): Map<number, { valor: number; ano: number }> {
  const series = (data as { resultados: { series: Series }[] }[])[0].resultados[0].series;
  const out = new Map<number, { valor: number; ano: number }>();
  for (const s of series) {
    const v = ultimoValor([{ resultados: [{ series: [s] }] }]);
    if (v) out.set(Number(s.localidade.id), v);
  }
  return out;
}

async function baixarBase(): Promise<Municipio[]> {
  console.log("Baixando do IBGE: lista de municípios, população e PIB de todos...");
  const [lista, pop, pib] = await Promise.all([
    getJson(`${IBGE}/v1/localidades/municipios?view=nivelado`),
    getJson(`${IBGE}/v3/agregados/6579/periodos/-1/variaveis/9324?localidades=N6[all]`),
    getJson(`${IBGE}/v3/agregados/5938/periodos/-1/variaveis/37?localidades=N6[all]`),
  ]);
  const pops = porMunicipio(pop);
  const pibs = porMunicipio(pib);

  const erros: string[] = [];
  const municipios: Municipio[] = (lista as Record<string, string | number>[]).map((m) => {
    const cd = Number(m["municipio-id"]);
    const nome = String(m["municipio-nome"]);
    const uf = String(m["UF-sigla"]);
    const p = pops.get(cd);
    const b = pibs.get(cd);
    if (!/^\d{7}$/.test(String(cd))) erros.push(`código inválido: ${cd} ${nome}`);
    if (!/^[A-Z]{2}$/.test(uf)) erros.push(`UF inválida para ${cd} ${nome}: "${uf}"`);
    if (!p) erros.push(`sem população: ${cd} ${nome}/${uf}`);
    return {
      cd_mun: cd,
      nome,
      nome_busca: nomeBusca(nome),
      uf,
      populacao: p ? Math.round(p.valor) : 0,
      ano_populacao: p?.ano ?? 0,
      pib_mil: b ? b.valor : null,
      ano_pib: b?.ano ?? null,
    };
  });

  // Conferências: a carga não sai se a base vier estranha.
  const chaves = new Map<string, string>();
  for (const m of municipios) {
    const k = `${m.uf}|${m.nome_busca}`;
    if (chaves.has(k)) erros.push(`nome repetido na mesma UF: ${m.nome}/${m.uf} (${chaves.get(k)} e ${m.cd_mun})`);
    chaves.set(k, String(m.cd_mun));
  }
  const ufs = new Set(municipios.map((m) => m.uf));
  if (municipios.length < 5570) erros.push(`só ${municipios.length} municípios na lista do IBGE (esperado ≥ 5.570)`);
  if (ufs.size !== 27) erros.push(`${ufs.size} UFs na lista (esperado 27)`);
  if (erros.length > 0) throw new Error(`Base do IBGE reprovada, nada foi gerado:\n  ${erros.join("\n  ")}`);
  return municipios;
}

const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;
const anos = (xs: (number | null)[]) => [...new Set(xs.filter((x): x is number => x !== null))].sort().join(", ");

function gerarSql(municipios: Municipio[]): void {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const partes = Math.ceil(municipios.length / LINHAS_POR_PARTE);
  const resumo = `população ${anos(municipios.map((m) => m.ano_populacao))} · PIB ${anos(municipios.map((m) => m.ano_pib))}`;
  for (let i = 0; i < partes; i++) {
    const lote = municipios.slice(i * LINHAS_POR_PARTE, (i + 1) * LINHAS_POR_PARTE);
    const valores = lote
      .map(
        (m) =>
          `(${m.cd_mun}, ${sqlText(m.nome)}, ${sqlText(m.nome_busca)}, '${m.uf}', ${m.populacao}, ${m.ano_populacao}, ` +
          `${m.pib_mil ?? "NULL"}, ${m.ano_pib ?? "NULL"})`
      )
      .join(",\n");
    const sql =
      `-- ibge_municipios — parte ${i + 1} de ${partes} (${lote.length} municípios)\n` +
      `-- Gerado em ${new Date().toISOString()} por scripts/ibge/carga-municipios.ts · ${resumo}\n` +
      `-- Cole no editor SQL do painel do Supabase e rode. Pode rodar de novo: atualiza, não duplica.\n\n` +
      `INSERT INTO ibge_municipios (cd_mun, nome, nome_busca, uf, populacao, ano_populacao, pib_mil, ano_pib)\nVALUES\n` +
      `${valores}\n` +
      `ON CONFLICT (cd_mun) DO UPDATE SET\n` +
      `  nome = EXCLUDED.nome, nome_busca = EXCLUDED.nome_busca, uf = EXCLUDED.uf,\n` +
      `  populacao = EXCLUDED.populacao, ano_populacao = EXCLUDED.ano_populacao,\n` +
      `  pib_mil = EXCLUDED.pib_mil, ano_pib = EXCLUDED.ano_pib, carregado_em = now();\n`;
    writeFileSync(path.join(outDir, `parte-${i + 1}-de-${partes}.sql`), sql);
  }

  const semPib = municipios.filter((m) => m.pib_mil === null);
  console.log(`\n${municipios.length} municípios · ${resumo}`);
  console.log(`${partes} arquivos em ${outDir}`);
  if (semPib.length > 0) {
    console.log(`Sem PIB publicado (Score e Mapa de Calor bloqueiam com aviso): ${semPib.map((m) => `${m.nome}/${m.uf}`).join(", ")}`);
  }
}

/** Compara o que está no banco com o IBGE de agora. Só leitura. */
async function conferir(municipios: Municipio[]): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL/ANON_KEY ausentes (rode com --env-file=.env.local)");

  const banco: Municipio[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(
      `${url}/rest/v1/ibge_municipios?select=cd_mun,nome,nome_busca,uf,populacao,ano_populacao,pib_mil,ano_pib&order=cd_mun`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` } }
    );
    if (!res.ok) throw new Error(`leitura do banco falhou: HTTP ${res.status} ${await res.text()}`);
    const page = (await res.json()) as Municipio[];
    banco.push(...page);
    if (page.length < 1000) break;
  }

  const doBanco = new Map(banco.map((m) => [m.cd_mun, m]));
  const diferencas: string[] = [];
  for (const m of municipios) {
    const b = doBanco.get(m.cd_mun);
    if (!b) {
      diferencas.push(`falta no banco: ${m.cd_mun} ${m.nome}/${m.uf}`);
      continue;
    }
    const pibBanco = b.pib_mil === null ? null : Number(b.pib_mil);
    if (
      b.nome !== m.nome ||
      b.nome_busca !== m.nome_busca ||
      b.uf !== m.uf ||
      b.populacao !== m.populacao ||
      b.ano_populacao !== m.ano_populacao ||
      pibBanco !== m.pib_mil ||
      b.ano_pib !== m.ano_pib
    ) {
      diferencas.push(`diferente do IBGE: ${m.cd_mun} ${m.nome}/${m.uf}`);
    }
  }
  const doIbge = new Set(municipios.map((m) => m.cd_mun));
  const sobrando = banco.filter((b) => !doIbge.has(b.cd_mun));
  for (const b of sobrando) diferencas.push(`no banco mas não no IBGE: ${b.cd_mun} ${b.nome}/${b.uf}`);

  console.log(`\nBanco: ${banco.length} linhas · IBGE agora: ${municipios.length} municípios`);
  if (diferencas.length > 0) {
    console.log(`${diferencas.length} diferença(s):\n  ${diferencas.slice(0, 30).join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log("Banco idêntico ao IBGE: todas as linhas conferem.");
  }
}

async function main() {
  const base = await baixarBase();
  if (process.argv.includes("--conferir")) await conferir(base);
  else gerarSql(base);
}

main().catch((e) => {
  console.error(`\n${(e as Error).message}`);
  process.exit(1);
});
