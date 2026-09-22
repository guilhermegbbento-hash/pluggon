/**
 * Trava de build: se src/lib/heatmap/ mudou desde a última regressão ao vivo
 * aprovada, o build falha. Não chama API nenhuma.
 */

import { computeHeatmapSourceHash, HISTORY_DIR, readLatestRecord } from "./lib";

const repoRoot = process.cwd();
const current = computeHeatmapSourceHash(repoRoot);
const latest = readLatestRecord(repoRoot);

function fail(msg: string): never {
  console.error(`\n[heatmap-regression] ${msg}\nRode \`npm run test:heatmap-live\` e versione ${HISTORY_DIR}/ antes do deploy.\n`);
  process.exit(1);
}

if (!latest) fail("Nenhuma regressão ao vivo registrada.");
if (latest.sourceHash !== current) {
  fail(
    `src/lib/heatmap/ mudou desde a última regressão ao vivo ` +
      `(registrada ${latest.ranAt} para o código ${latest.sourceHash}; código atual ${current}).`
  );
}
if (!latest.allPassed) fail(`A última regressão ao vivo (${latest.ranAt}) REPROVOU.`);

// Rodada parcial não bloqueia o build, mas não passa calada: o "aprovado" dela
// não cobre os casos que ficaram de fora.
if (latest.partial) {
  console.warn(
    `[heatmap-regression] ATENÇÃO: a última regressão foi PARCIAL — ${latest.cases.length} caso(s) rodaram e ` +
      `ficaram de fora: ${(latest.skipped ?? []).join(", ") || "—"}.`
  );
}

console.log(`[heatmap-regression] ok — regressão ao vivo de ${latest.ranAt} cobre o código atual (${current}).`);
