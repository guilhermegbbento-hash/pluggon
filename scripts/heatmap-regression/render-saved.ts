/**
 * Teste LOCAL e grátis do HTML exportado: re-renderiza, com o gerador ATUAL, os
 * payloads salvos pela última regressão ao vivo (.heatmap-regression-output/<caso>.payload.json)
 * e roda os cenários de navegador. Não chama API do Google e não grava histórico.
 * Serve para iterar antes de gastar com a regressão ao vivo — não a substitui.
 *
 *   npm run test:heatmap-render
 *   npm run test:heatmap-render -- --casos f --cenarios online,firewall_pendurado --repetir 5
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { exportDarkTiles } from "../../src/lib/basemap";
import { renderHeatmapHtml } from "../../src/lib/heatmap/report-html";
import type { HeatmapPayload } from "../../src/lib/heatmap/types";
import { checkInvariants } from "./lib";
import { FCP_LIMIT_MS, findChrome, renderCheck, SCENARIOS, type Scenario } from "./render-check";

const args = process.argv.slice(2);
const argVal = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

// Mesma regra do relatório real: chave de exportação, ou a do app; nenhuma → erro.
const tileUrl = exportDarkTiles();

const chrome = findChrome();
if (!chrome) throw new Error("Chrome/Edge não encontrado (defina CHROME_PATH).");
const chromePath: string = chrome;

const srcDir = path.join(process.cwd(), ".heatmap-regression-output");
const outDir = path.join(srcDir, "local");
mkdirSync(outDir, { recursive: true });

const ids = argVal("--casos")?.split(",") ?? ["a", "b", "c", "d", "e", "f"];
const scenarios = (argVal("--cenarios")?.split(",") as Scenario[] | undefined) ?? [...SCENARIOS];
const repeat = Math.max(1, Number(argVal("--repetir") ?? 1));

interface Row {
  id: string;
  kb: number;
  invariants: string[];
  runs: { scenario: Scenario; fcpMs: number | null; externalRequests: number; externalBeforeFcp: number; violations: string[] }[];
}

async function main() {
const rows: Row[] = [];
for (const id of ids) {
  const payloadFile = path.join(srcDir, `${id}.payload.json`);
  if (!existsSync(payloadFile)) {
    console.warn(`[${id}] sem payload salvo — pulei`);
    continue;
  }
  const payload = JSON.parse(readFileSync(payloadFile, "utf8")) as HeatmapPayload;
  const html = renderHeatmapHtml(payload, { tileUrl });
  const htmlFile = path.join(outDir, `${id}.html`);
  writeFileSync(htmlFile, html);
  const row: Row = { id, kb: Math.round(statSync(htmlFile).size / 1024), invariants: checkInvariants(payload, html), runs: [] };
  for (let i = 0; i < repeat; i++) {
    const report = await renderCheck(htmlFile, chromePath, { outDir, id, scenarios });
    for (const s of report.scenarios) {
      row.runs.push({ scenario: s.scenario, fcpMs: s.fcpMs, externalRequests: s.externalRequests, externalBeforeFcp: s.externalBeforeFcp, violations: s.violations });
    }
    writeFileSync(path.join(outDir, `${id}.render.json`), JSON.stringify(report, null, 2));
  }
  rows.push(row);
  const summary = scenarios
    .map((s) => {
      const runs = row.runs.filter((r) => r.scenario === s);
      const fcps = runs.map((r) => r.fcpMs ?? NaN);
      const bad = runs.reduce((n, r) => n + r.violations.length, 0);
      return `${s}: ${bad === 0 ? "ok" : `FALHOU(${bad})`} FCP ${fcps.join("/")} ms`;
    })
    .join(" | ");
  console.log(`[${id}] ${row.kb} KB | invariantes ${row.invariants.length === 0 ? "ok" : row.invariants.join("; ")} | ${summary}`);
}

writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ ranAt: new Date().toISOString(), fcpLimitMs: FCP_LIMIT_MS, repeat, rows }, null, 2));

const failures = rows.flatMap((r) => [
  ...r.invariants.map((v) => `[${r.id}] invariante: ${v}`),
  ...r.runs.flatMap((run) => run.violations.map((v) => `[${r.id}][${run.scenario}] ${v}`)),
]);
if (failures.length > 0) {
  console.log(`\n${failures.length} problema(s):\n- ${[...new Set(failures)].join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("\nTodos os cenários ok.");
}
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
