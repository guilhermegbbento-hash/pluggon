/**
 * EXPERIMENTO (não é regressão, não é gate): quanto do aumento de concorrentes
 * veio da SUBDIVISÃO da busca e quanto da DEDUPE?
 *
 * Roda os 6 casos com a subdivisão DESLIGADA (maxDepth 0) e a dedupe atual
 * LIGADA. Sem QA gate: com a subdivisão desligada a camada bate no teto da API
 * e o gate abortaria — que é justamente o defeito que se quer medir. Por isso
 * orquestra as etapas exportadas direto, sem tocar no código de produção.
 *
 * Compara três momentos:
 *   A) antes (14/09 22:24): sem subdivisão, dedupe anterior;
 *   B) este experimento:    sem subdivisão, dedupe atual;
 *   C) última regressão:    com subdivisão, dedupe atual.
 * B − A = efeito da dedupe; C − B = efeito da subdivisão.
 *
 * Grava só agregados em docs/heatmap-regression/experimentos/.
 *   npm run experiment:heatmap-no-subdivision
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PLACE_TYPE_SPECS, SEARCH_RULES } from "../../src/lib/heatmap/config";
import { runPipeline } from "../../src/lib/heatmap/pipeline";
import { searchSpecInArea } from "../../src/lib/heatmap/places";
import { googleGeocoder, resolveScope } from "../../src/lib/heatmap/scope";
import type { Candidate, SearchSummary } from "../../src/lib/heatmap/types";
import { APP_VERSION } from "../../src/lib/version";
import { REGRESSION_CASES } from "./cases";
import { computeHeatmapSourceHash, HISTORY_DIR, readLatestRecord, type RunRecord } from "./lib";

const BEFORE_RUN_PREFIX = "2026-09-14T22:24"; // última regressão antes da subdivisão

const repoRoot = process.cwd();
const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
if (!googleApiKey) throw new Error("GOOGLE_MAPS_API_KEY ausente.");
const apiKey: string = googleApiKey;

const latest = readLatestRecord(repoRoot);
const currentHash = computeHeatmapSourceHash(repoRoot);
if (!latest || latest.sourceHash !== currentHash || !latest.allPassed) {
  throw new Error(
    "A comparação exige uma regressão ao vivo APROVADA do código atual (com subdivisão). Rode npm run test:heatmap-live antes."
  );
}
const history = readFileSync(path.join(repoRoot, HISTORY_DIR, "history.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as RunRecord);
const before = history.find((r) => r.ranAt.startsWith(BEFORE_RUN_PREFIX));
if (!before) throw new Error(`Regressão de referência ${BEFORE_RUN_PREFIX} não encontrada no histórico.`);
const beforeRun: RunRecord = before;
const latestRun: RunRecord = latest;

// A única mudança do experimento: nenhuma célula é subdividida.
SEARCH_RULES.subdivision.maxDepth = 0;

interface Row {
  id: string;
  label: string;
  before: { competitors: number; dc: number; ac: number; ni: number } | null;
  noSubdivision: { competitors: number; dc: number; ac: number; ni: number; cells: number; cappedCells: number; returnedRaw: number; competitorDiscards: Record<string, number> } | null;
  withSubdivision: { competitors: number; dc: number; ac: number; ni: number; cells: number; cappedCells: number } | null;
  error: string | null;
}

const counts = (c: { competitors: number; competitorsDC: number; competitorsAC: number; competitorsUnknown: number }) => ({
  competitors: c.competitors,
  dc: c.competitorsDC,
  ac: c.competitorsAC,
  ni: c.competitorsUnknown,
});

async function main() {
const rows: Row[] = [];
let requests = 0;
const geocode = googleGeocoder(apiKey);

for (const c of REGRESSION_CASES) {
  const b = beforeRun.cases.find((x) => x.id === c.id);
  const w = latestRun.cases.find((x) => x.id === c.id);
  const row: Row = {
    id: c.id,
    label: c.label,
    before: b?.counts ? counts(b.counts) : null,
    withSubdivision: w?.counts && w.competitorSearch ? { ...counts(w.counts), cells: w.competitorSearch.cells, cappedCells: w.competitorSearch.cappedCells } : null,
    noSubdivision: null,
    error: null,
  };
  try {
    requests++;
    const scope = await resolveScope(c.input, geocode);
    const candidates: Candidate[] = [];
    const searches: SearchSummary[] = [];
    for (const area of scope.areas) {
      const results = await Promise.all(
        PLACE_TYPE_SPECS.map(async (spec) => ({ spec, result: await searchSpecInArea(spec, area, { apiKey }) }))
      );
      for (const { spec, result } of results) {
        requests += result.requests;
        searches.push(...result.summaries);
        for (const place of result.places) candidates.push({ layer: spec.layer, typeKey: spec.key, place });
      }
    }
    const failed = searches.filter((s) => s.error);
    if (failed.length > 0) throw new Error(`${failed.length} busca(s) com erro: ${failed[0].error}`);
    const out = runPipeline(scope, candidates);
    const comp = searches.filter((s) => s.layer === "competitor");
    const discards: Record<string, number> = {};
    for (const d of out.discards.filter((x) => x.layer === "competitor")) discards[d.reason] = (discards[d.reason] ?? 0) + 1;
    row.noSubdivision = {
      ...counts(out.counters),
      cells: comp.reduce((n, s) => n + s.cells, 0),
      cappedCells: comp.reduce((n, s) => n + s.cappedCells, 0),
      returnedRaw: comp.reduce((n, s) => n + s.returned, 0),
      competitorDiscards: discards,
    };
  } catch (err) {
    row.error = err instanceof Error ? err.message : String(err);
  }
  rows.push(row);
  console.log(`[${c.id}] ${c.label}: ${row.error ?? `${row.noSubdivision!.competitors} concorrentes sem subdivisão`}`);
}

const fmtC = (x: { competitors: number; dc: number; ac: number; ni: number } | null) => (x ? `${x.competitors} (${x.dc}/${x.ac}/${x.ni})` : "—");
const delta = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined ? "—" : `${b - a >= 0 ? "+" : ""}${b - a}`);
const ranAt = new Date().toISOString();
const md = [
  `# Experimento — subdivisão desligada × dedupe atual`,
  ``,
  `Rodado em ${ranAt} · gerador v${APP_VERSION} · código ${currentHash} · ~${requests} requisições Google.`,
  ``,
  `- **A — antes** (regressão ${beforeRun.ranAt}): sem subdivisão, dedupe anterior.`,
  `- **B — este experimento**: subdivisão desligada (\`maxDepth = 0\`), dedupe atual, sem QA gate.`,
  `- **C — com subdivisão** (regressão ${latestRun.ranAt}): subdivisão ligada, dedupe atual.`,
  `- **Efeito da dedupe = B − A. Efeito da subdivisão = C − B.** A e C são rodadas em horários diferentes: o Google muda um pouco entre elas, então diferenças de ±2 são ruído.`,
  ``,
  `| Caso | A antes | B sem subdivisão | C com subdivisão | Dedupe (B−A) | Subdivisão (C−B) | Busca B: células / no teto | Busca C: células / no teto |`,
  `|---|---|---|---|---|---|---|---|`,
  ...rows.map((r) =>
    r.error
      ? `| ${r.id}) ${r.label} | ${fmtC(r.before)} | ERRO: ${r.error} | ${fmtC(r.withSubdivision)} | — | — | — | — |`
      : `| ${r.id}) ${r.label} | ${fmtC(r.before)} | ${fmtC(r.noSubdivision)} | ${fmtC(r.withSubdivision)} | ${delta(r.before?.competitors, r.noSubdivision?.competitors)} | ${delta(r.noSubdivision?.competitors, r.withSubdivision?.competitors)} | ${r.noSubdivision?.cells} / ${r.noSubdivision?.cappedCells} | ${r.withSubdivision ? `${r.withSubdivision.cells} / ${r.withSubdivision.cappedCells}` : "—"} |`
  ),
  ``,
  `Concorrentes em (DC/AC/não informado). "No teto" = células que voltaram cheias da API sem poder subdividir — em B, cada uma é concorrência possivelmente cortada.`,
  ``,
].join("\n");

const dir = path.join(repoRoot, HISTORY_DIR, "experimentos");
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const base = `${ranAt.slice(0, 10)}-subdivisao-desligada`;
writeFileSync(path.join(dir, `${base}.md`), md);
writeFileSync(path.join(dir, `${base}.json`), JSON.stringify({ ranAt, generatorVersion: APP_VERSION, sourceHash: currentHash, requests, beforeRun: beforeRun.ranAt, withSubdivisionRun: latestRun.ranAt, rows }, null, 2) + "\n");
console.log(`\n${md}\nGravado em ${path.join(dir, base)}.{md,json}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
