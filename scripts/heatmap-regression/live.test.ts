/**
 * Regressão AO VIVO dos seis escopos (Google Places + Geocoding reais).
 * Custa dinheiro: rode com `npm run test:heatmap-live` antes de deploy que
 * toque src/lib/heatmap/. O build verifica isso (scripts/heatmap-regression/check.ts).
 *
 * Cada HTML é aberto no Chrome em cinco cenários (online, sem rede, firewall
 * pendurado, sem Leaflet, sem JS) — ver render-check.ts.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HAS_CARTO_EXPORT_KEY } from "../../src/lib/basemap";
import { APP_VERSION } from "../../src/lib/version";
import { loadMunicipalIndicators } from "../../src/lib/heatmap/municipal";
import type { GenerateDeps } from "../../src/lib/heatmap/generate";
import { ABORT_CASES, REGRESSION_CASES } from "./cases";
import { findChrome, renderCheck } from "./render-check";
import {
  computeHeatmapSourceHash,
  markdownTable,
  runAbortCase,
  runCase,
  writeRunRecord,
  type AbortMetrics,
  type CaseMetrics,
} from "./lib";

const repoRoot = process.cwd();
const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
if (!googleApiKey) throw new Error("GOOGLE_MAPS_API_KEY ausente — a regressão ao vivo não roda sem chave.");
if (!HAS_CARTO_EXPORT_KEY) {
  throw new Error("Nenhuma chave do CARTO (NEXT_PUBLIC_CARTO_EXPORT_API_KEY ou NEXT_PUBLIC_CARTO_API_KEY) — o HTML exportado não é gerado sem base cartográfica.");
}
const chrome = findChrome();
if (!chrome) throw new Error("Chrome/Edge não encontrado (defina CHROME_PATH) — a regressão abre cada HTML num navegador real.");

const deps: GenerateDeps = {
  googleApiKey,
  ocmApiKey: process.env.OPENCHARGEMAP_API_KEY ?? null,
  loadMunicipal: (scope) => loadMunicipalIndicators(scope.city, scope.state),
};

const outDir = path.join(repoRoot, ".heatmap-regression-output");
mkdirSync(outDir, { recursive: true });

const cases: CaseMetrics[] = [];
const aborts: AbortMetrics[] = [];
let failures = 0;

for (const c of REGRESSION_CASES) {
  test(`${c.id}) ${c.label} — ${c.purpose}`, async () => {
    const run = await runCase(c, deps);
    cases.push(run.metrics);
    let renderViolations: string[] = [];
    if (run.payload && run.html) {
      writeFileSync(path.join(outDir, `${c.id}.payload.json`), JSON.stringify(run.payload, null, 2));
      const htmlFile = path.join(outDir, `${c.id}.html`);
      writeFileSync(htmlFile, run.html);
      const render = await renderCheck(htmlFile, chrome, { outDir, id: c.id });
      writeFileSync(path.join(outDir, `${c.id}.render.json`), JSON.stringify(render, null, 2));
      renderViolations = render.violations;
      // No histórico versionado só vão números (as mensagens podem citar lugares).
      run.metrics.renderViolations = render.violations.length;
      run.metrics.render = Object.fromEntries(
        render.scenarios.map((s) => [
          s.scenario,
          { violations: s.violations.length, fcpMs: s.fcpMs, externalRequests: s.externalRequests, externalBeforeFcp: s.externalBeforeFcp },
        ])
      );
    }
    try {
      assert.equal(run.metrics.error, null, run.metrics.error ?? "");
      assert.deepEqual(renderViolations, [], "o HTML precisa renderizar corretamente num navegador real, com e sem rede");
      assert.deepEqual(run.metrics.invariantViolations, [], "nenhum ponto fora do raio, nenhum place_id repetido");
      assert.equal(run.metrics.qaPassed, true);
      assert.equal(run.metrics.fitBoundsIsScope, true);
    } catch (err) {
      failures++;
      throw err;
    }
  });
}

for (const c of ABORT_CASES) {
  test(`${c.id}) ${c.label} — ${c.purpose}`, async () => {
    const r = await runAbortCase(c, deps);
    aborts.push({ id: r.id, label: r.label, aborted: r.aborted, code: r.code });
    writeFileSync(path.join(outDir, `${c.id}.abort.json`), JSON.stringify(r, null, 2));
    try {
      assert.equal(r.aborted, true, r.message);
    } catch (err) {
      failures++;
      throw err;
    }
  });
}

after(() => {
  const record = {
    ranAt: new Date().toISOString(),
    generatorVersion: APP_VERSION,
    sourceHash: computeHeatmapSourceHash(repoRoot),
    allPassed:
      failures === 0 && cases.length === REGRESSION_CASES.length && aborts.length === ABORT_CASES.length,
    cases,
    abortCases: aborts,
  };
  writeRunRecord(repoRoot, record);
  console.log(`\n${markdownTable(record)}\n`);
  console.log(`Saída detalhada (não versionada): ${outDir}`);
});
