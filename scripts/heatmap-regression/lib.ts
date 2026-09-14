/**
 * Núcleo da regressão ao vivo: roda um escopo de ponta a ponta contra as APIs
 * reais, confere as invariantes e produz SÓ métricas agregadas (sem nome,
 * endereço ou coordenada de lugar) para o histórico versionado.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SCOPE_RULES } from "../../src/lib/heatmap/config";
import { generateHeatmap, type GenerateDeps } from "../../src/lib/heatmap/generate";
import { matchArea, scopeBoundsFor } from "../../src/lib/heatmap/geo";
import { computeCounters } from "../../src/lib/heatmap/pipeline";
import { renderHeatmapHtml } from "../../src/lib/heatmap/report-html";
import { ScopeError } from "../../src/lib/heatmap/scope";
import type { DiscardReason, HeatmapPayload, LayerKey } from "../../src/lib/heatmap/types";
import type { RegressionCase } from "./cases";

export const HISTORY_DIR = "docs/heatmap-regression";

export interface CaseMetrics {
  id: string;
  label: string;
  purpose: string;
  error: string | null;
  mode: string | null;
  areas: { radiusM: number; radiusSource: string; radiusClamp: string | null; boundsCoveragePct: number | null }[];
  competitorSearch: { cells: number; maxDepth: number; cappedCells: number } | null;
  complementaryWithoutAnchor: number;
  /** Problemas encontrados ao abrir o HTML num navegador real; null = não verificado. */
  renderViolations: number | null;
  counts: {
    anchors: number;
    complementary: number;
    competitors: number;
    competitorsDC: number;
    competitorsAC: number;
    competitorsUnknown: number;
    anchorsByType: Record<string, number>;
  } | null;
  maxDistanceM: { anchors: number; complementary: number; competitors: number } | null;
  discardsByReason: Partial<Record<DiscardReason, number>>;
  truncatedSearches: number;
  sources: { name: string; status: string }[];
  fitBoundsIsScope: boolean | null;
  qaPassed: boolean | null;
  googleQueries: number | null;
  invariantViolations: string[];
}

export interface AbortMetrics {
  id: string;
  label: string;
  aborted: boolean;
  code: string | null;
}

export interface RunRecord {
  ranAt: string;
  generatorVersion: string;
  sourceHash: string;
  allPassed: boolean;
  cases: CaseMetrics[];
  abortCases: AbortMetrics[];
}

const FIT_SCOPE_RE =
  /map\.fitBounds\(\[\[scope\.bounds\.south, scope\.bounds\.west\], \[scope\.bounds\.north, scope\.bounds\.east\]\]/;

/** Invariantes checadas por fora do QA gate, direto no payload e no HTML. */
export function checkInvariants(p: HeatmapPayload, html: string): string[] {
  const v: string[] = [];
  const layers: [LayerKey, { placeId: string; lat: number; lng: number }[]][] = [
    ["anchor", p.anchors],
    ["complementary", p.complementary],
    ["competitor", p.competitors],
  ];
  const seen = new Map<string, LayerKey>();
  for (const [layer, points] of layers) {
    for (const pt of points) {
      const m = matchArea(pt, p.scope.areas);
      if (m.distanceM > m.area.radiusM + 1) {
        v.push(`${layer} ${pt.placeId} a ${Math.round(m.distanceM)} m do centro (raio ${m.area.radiusM} m)`);
      }
      const prev = seen.get(pt.placeId);
      if (prev) v.push(`place_id ${pt.placeId} repetido (${prev} e ${layer})`);
      else seen.set(pt.placeId, layer);
    }
  }

  const expected = scopeBoundsFor(p.scope.areas);
  if (JSON.stringify(expected) !== JSON.stringify(p.scope.bounds)) v.push("scope.bounds diferente dos círculos de estudo");
  const fits = html.match(/fitBounds\(/g) ?? [];
  if (fits.length !== 1 || !FIT_SCOPE_RE.test(html)) v.push("HTML não enquadra exclusivamente o escopo");

  const rule = SCOPE_RULES[p.scope.mode];
  for (const a of p.scope.areas) {
    if (a.radiusM < rule.minRadiusM || a.radiusM > rule.maxRadiusM) v.push(`raio ${a.radiusM} m fora do intervalo do modo ${p.scope.mode}`);
  }

  const c = computeCounters(p.anchors, p.complementary, p.competitors);
  for (const k of ["anchors", "complementary", "competitors", "competitorsDC", "competitorsAC", "competitorsUnknown"] as const) {
    if (c[k] !== p.counters[k]) v.push(`counters.${k} diverge do array`);
  }
  if (p.competitors.length === 0 && !html.includes("0 concorrentes no raio")) {
    v.push("zero concorrentes sem a mensagem de praça vazia");
  }
  if (!p.qa?.passed) v.push("QA gate não aprovado");
  return v;
}

export interface CaseRun {
  metrics: CaseMetrics;
  payload: HeatmapPayload | null;
  html: string | null;
}

export async function runCase(c: RegressionCase, deps: GenerateDeps): Promise<CaseRun> {
  const base: CaseMetrics = {
    id: c.id,
    label: c.label,
    purpose: c.purpose,
    error: null,
    mode: null,
    areas: [],
    competitorSearch: null,
    complementaryWithoutAnchor: 0,
    renderViolations: null,
    counts: null,
    maxDistanceM: null,
    discardsByReason: {},
    truncatedSearches: 0,
    sources: [],
    fitBoundsIsScope: null,
    qaPassed: null,
    googleQueries: null,
    invariantViolations: [],
  };
  let payload: HeatmapPayload;
  try {
    payload = await generateHeatmap(c.input, deps);
  } catch (err) {
    return { metrics: { ...base, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }, payload: null, html: null };
  }
  const html = renderHeatmapHtml(payload);
  const violations = checkInvariants(payload, html);
  const { counters, qa } = payload;
  return {
    payload,
    html,
    metrics: {
      ...base,
      mode: payload.scope.mode,
      areas: payload.scope.areas.map((a) => ({
        radiusM: a.radiusM,
        radiusSource: a.radiusSource,
        radiusClamp: a.radiusClamp,
        boundsCoveragePct: a.boundsCoveragePct,
      })),
      competitorSearch: (() => {
        const s = payload.searches.filter((x) => x.layer === "competitor");
        return {
          cells: s.reduce((n, x) => n + x.cells, 0),
          maxDepth: Math.max(0, ...s.map((x) => x.maxDepth)),
          cappedCells: s.reduce((n, x) => n + x.cappedCells, 0),
        };
      })(),
      complementaryWithoutAnchor: qa!.discardsByReason.complementar_sem_ancora_proxima ?? 0,
      counts: {
        anchors: counters.anchors,
        complementary: counters.complementary,
        competitors: counters.competitors,
        competitorsDC: counters.competitorsDC,
        competitorsAC: counters.competitorsAC,
        competitorsUnknown: counters.competitorsUnknown,
        anchorsByType: counters.anchorsByType,
      },
      maxDistanceM: qa!.maxDistanceM,
      discardsByReason: qa!.discardsByReason,
      truncatedSearches: payload.searches.filter((s) => s.truncated).length,
      sources: payload.sources.map((s) => ({ name: s.name.replace(/ \(.*\)$/, ""), status: s.status })),
      fitBoundsIsScope: !violations.some((x) => x.includes("enquadra") || x.includes("scope.bounds")),
      qaPassed: qa!.passed,
      googleQueries: payload.googleQueries,
      invariantViolations: violations,
    },
  };
}

export async function runAbortCase(c: RegressionCase, deps: GenerateDeps): Promise<AbortMetrics & { message: string; details: string[] }> {
  try {
    await generateHeatmap(c.input, deps);
    return { id: c.id, label: c.label, aborted: false, code: null, message: "gerou relatório — deveria ter abortado", details: [] };
  } catch (err) {
    if (err instanceof ScopeError) {
      return { id: c.id, label: c.label, aborted: true, code: err.code, message: err.message, details: err.details };
    }
    return { id: c.id, label: c.label, aborted: false, code: null, message: String(err), details: [] };
  }
}

// ---------- Hash do código do gerador ----------

export function computeHeatmapSourceHash(repoRoot: string): string {
  const dir = path.join(repoRoot, "src/lib/heatmap");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .sort();
  const hash = createHash("sha256");
  for (const f of files) {
    hash.update(f);
    hash.update(readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n"));
  }
  return hash.digest("hex").slice(0, 16);
}

// ---------- Histórico versionado ----------

const sumDup = (d: Partial<Record<DiscardReason, number>>) =>
  (d.duplicata_place_id ?? 0) +
  (d.duplicata_proximidade_nome ?? 0) +
  (d.duplicata_nome_contido ?? 0) +
  (d.duplicata_entre_camadas ?? 0);

const km = (m: number) => (m / 1000).toFixed(2).replace(".", ",");

export function markdownTable(record: RunRecord): string {
  const head =
    "| Caso | Modo | Raio (origem; cobertura) | Âncoras | Compl. | Conc. (DC/AC/NI) | Busca conc.: células / prof. / no teto | Dist. máx âncora / compl. / conc. | Fora do raio | Tipo inválido | Tipo principal divergente | Duplicata | Ponto de ônibus s/ terminal | Aeroporto s/ porte | Compl. sem âncora ≤ 500 m | Buscas de apoio no teto | fitBounds = escopo | Render no navegador | QA |\n" +
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  const rows = record.cases.map((c) => {
    if (c.error || !c.counts || !c.maxDistanceM) return `| ${c.id}) ${c.label} | ERRO: ${c.error} ${"|".repeat(18)}`;
    const d = c.discardsByReason;
    const radius = c.areas
      .map((a) => `${km(a.radiusM)} km (${a.radiusSource}${a.radiusClamp ? `, ${a.radiusClamp}` : ""}; ${a.boundsCoveragePct === null ? "—" : `${a.boundsCoveragePct}%`})`)
      .join(" + ");
    const cs = c.competitorSearch;
    return `| ${c.id}) ${c.label} | ${c.mode} | ${radius} | ${c.counts.anchors} | ${c.counts.complementary} | ${c.counts.competitors} (${c.counts.competitorsDC}/${c.counts.competitorsAC}/${c.counts.competitorsUnknown}) | ${cs ? `${cs.cells} / ${cs.maxDepth} / ${cs.cappedCells}` : "—"} | ${km(c.maxDistanceM.anchors)} / ${km(c.maxDistanceM.complementary)} / ${km(c.maxDistanceM.competitors)} km | ${d.fora_do_raio ?? 0} | ${d.tipo_invalido ?? 0} | ${d.tipo_principal_divergente ?? 0} | ${sumDup(d)} | ${d.ponto_de_onibus_sem_sinal_de_terminal ?? 0} | ${d.aeroporto_sem_porte ?? 0} | ${c.complementaryWithoutAnchor} | ${c.truncatedSearches - (cs?.cappedCells ? 1 : 0)} | ${c.fitBoundsIsScope ? "sim" : "NÃO"} | ${c.renderViolations === null ? "—" : c.renderViolations === 0 ? "ok" : `FALHOU (${c.renderViolations})`} | ${c.qaPassed && c.invariantViolations.length === 0 ? "ok" : "FALHOU"} |`;
  });
  const aborts = record.abortCases.map((a) => `- ${a.id}) ${a.label}: ${a.aborted ? `abortou (${a.code})` : "NÃO abortou"}`);
  return [head, ...rows, "", "Desambiguação (têm que abortar):", ...aborts].join("\n");
}

export function writeRunRecord(repoRoot: string, record: RunRecord): void {
  const dir = path.join(repoRoot, HISTORY_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "latest.json"), JSON.stringify(record, null, 2) + "\n");
  appendFileSync(path.join(dir, "history.jsonl"), JSON.stringify(record) + "\n");
  const md = path.join(dir, "HISTORY.md");
  if (!existsSync(md)) {
    writeFileSync(
      md,
      "# Regressão ao vivo — Mapa de Calor\n\n" +
        "Só métricas agregadas (contagens, distâncias máximas, descartes por motivo). " +
        "Nenhum conteúdo do Google é versionado. Gerado por `npm run test:heatmap-live`.\n"
    );
  }
  appendFileSync(
    md,
    `\n## ${record.ranAt} — gerador v${record.generatorVersion} — código ${record.sourceHash} — ${record.allPassed ? "APROVADO" : "REPROVADO"}\n\n${markdownTable(record)}\n`
  );
}

export function readLatestRecord(repoRoot: string): RunRecord | null {
  const file = path.join(repoRoot, HISTORY_DIR, "latest.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as RunRecord;
}
