import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeBoundsFor } from "../geo";
import { runPipeline } from "../pipeline";
import { assertQaGate, QaGateError, runQaGate } from "../qa-gate";
import { renderHeatmapHtml, reportStamp } from "../report-html";
import type { HeatmapPayload } from "../types";
import { cand, CENTER, makeScope, offset, place } from "./helpers";

function basePayload(): HeatmapPayload {
  const scope = makeScope({ radiusM: 1500 });
  const out = runPipeline(scope, [
    cand("anchor", "gas_station", place("a1", "Posto Um", offset(CENTER, 100, 0), { types: ["gas_station"] })),
    // 1.200 avaliações: shopping de verdade passa no piso de porte (≥100).
    cand("anchor", "shopping_mall", place("a2", "Shopping Dois", offset(CENTER, -500, 0), { types: ["shopping_mall"], userRatingCount: 1200 })),
    cand("complementary", "pharmacy", place("c1", "Farmácia Três", offset(CENTER, 150, 0), { types: ["pharmacy"] })),
    cand("competitor", "electric_vehicle_charging_station", place("k1", "Eletroposto Quatro", offset(CENTER, 0, 300), { types: ["electric_vehicle_charging_station"], chargerMaxKw: 60, chargerKwSource: "google_ev_options" })),
  ]);
  return {
    generatorVersion: "9.9.9",
    generatedAt: "2026-09-14T15:30:00.000Z",
    scope,
    ...out,
    searches: [],
    sources: [],
    municipal: null,
    qa: null,
    googleQueries: 0,
  };
}

const clone = (p: HeatmapPayload): HeatmapPayload => JSON.parse(JSON.stringify(p));
const rules = (p: HeatmapPayload) => runQaGate(p).violations.map((v) => v.rule);

test("payload íntegro passa", () => {
  assert.equal(runQaGate(basePayload()).passed, true);
});

test("ponto fora do raio reprova", () => {
  const p = clone(basePayload());
  const far = offset(CENTER, 5000, 0);
  Object.assign(p.competitors[0], far);
  assert.ok(rules(p).includes("ponto_fora_do_raio"));
});

test("place_id repetido entre camadas reprova", () => {
  const p = clone(basePayload());
  p.complementary[0].placeId = p.anchors[0].placeId;
  assert.ok(rules(p).includes("place_id_duplicado"));
});

test("ponto sem validação de tipo reprova", () => {
  const p = clone(basePayload());
  (p.anchors[0] as { validatedBy: string }).validatedBy = "nome";
  assert.ok(rules(p).includes("tipo_nao_validado"));
  const q = clone(basePayload());
  q.anchors[0].type = "pharmacy";
  assert.ok(rules(q).includes("tipo_nao_validado"));
});

test("contador divergente do array reprova (inclusive o raio de influência)", () => {
  const p = clone(basePayload());
  p.counters.competitors = 72;
  assert.ok(rules(p).includes("contador_divergente"));

  const q = clone(basePayload());
  q.anchors[0].complementaryWithin300m = 125;
  assert.ok(rules(q).includes("contador_divergente"));

  const r = clone(basePayload());
  r.competitors[0].charger_type = "unknown";
  assert.ok(rules(r).includes("contador_divergente"), "mudar tipo sem mudar DC tem que divergir");
});

test("enquadramento que não é o escopo reprova", () => {
  const p = clone(basePayload());
  p.scope.bounds.north += 1;
  assert.ok(rules(p).includes("enquadramento_divergente"));
});

test("gate reprovado impede gerar o HTML", () => {
  const p = clone(basePayload());
  p.counters.anchors = 42;
  assert.throws(() => assertQaGate(p), QaGateError);
  assert.throws(() => renderHeatmapHtml(p, { tileUrl: "about:blank" }), QaGateError);
});

test("carimbo: versão, escopo resolvido, raio, origem do raio e data", () => {
  const p = basePayload();
  const stamp = reportStamp(p);
  assert.match(stamp, /Gerador v9\.9\.9/);
  assert.match(stamp, /Bairro Teste · Cidade Teste · SP/);
  assert.match(stamp, /raio 1,5 km \(bounds; cobertura 100%\)/);
  assert.match(stamp, /14\/09\/2026/);
  const html = renderHeatmapHtml(p, { tileUrl: "about:blank" });
  assert.ok(html.includes(stamp.replace(/&/g, "&amp;")), "carimbo precisa estar no rodapé do HTML");
});

test("modo cidade com raio no teto: aviso no TOPO do relatório, com cobertura", () => {
  const p = clone(basePayload());
  p.scope.mode = "cidade";
  p.scope.areas[0].radiusM = 20000;
  p.scope.areas[0].radiusClamp = "teto";
  p.scope.areas[0].boundsCoveragePct = 57;
  p.scope.bounds = scopeBoundsFor(p.scope.areas);
  const html = renderHeatmapHtml(p, { tileUrl: "about:blank" });
  const warning = html.indexOf('class="scope-warning"');
  assert.ok(warning > 0 && warning < html.indexOf('<div class="main">'), "aviso antes do mapa");
  assert.match(html, /Raio limitado a 20 km — parte do município está fora deste estudo \(cobertura estimada: 57%\)\./);
  assert.match(reportStamp(p), /raio 20 km \(bounds, teto; cobertura 57%\)/);
});

test("modo bairro: cobrir menos que 100% do bairro reprova no gate", () => {
  const p = clone(basePayload());
  p.scope.areas[0].boundsCoveragePct = 56;
  assert.ok(rules(p).includes("cobertura_incompleta"));
  assert.throws(() => renderHeatmapHtml(p, { tileUrl: "about:blank" }), QaGateError);

  const ok = clone(basePayload());
  ok.scope.areas[0].boundsCoveragePct = 100;
  assert.ok(!rules(ok).includes("cobertura_incompleta"));
});

test("camada obrigatória ainda no teto da API reprova; camada de apoio no teto não", () => {
  const base = basePayload();
  const search = {
    layer: "competitor" as const,
    typeKey: "electric_vehicle_charging_station",
    areaName: "Bairro Teste",
    method: "searchNearby" as const,
    query: "electric_vehicle_charging_station",
    pages: 40,
    returned: 800,
    truncated: true,
    error: null,
    cells: 40,
    maxDepth: 6,
    cappedCells: 1,
  };
  assert.ok(rules({ ...base, searches: [search] }).includes("camada_incompleta"));
  const support = { ...search, layer: "complementary" as const, typeKey: "restaurant", method: "searchText" as const, query: "restaurante" };
  assert.ok(!rules({ ...base, searches: [support] }).includes("camada_incompleta"));
});

test("zero concorrentes aparece como resultado, não como erro", () => {
  const p = basePayload();
  const scope = p.scope;
  const out = runPipeline(scope, [
    cand("anchor", "gas_station", place("a1", "Posto Um", offset(CENTER, 100, 0), { types: ["gas_station"] })),
  ]);
  const html = renderHeatmapHtml({ ...p, ...out }, { tileUrl: "about:blank" });
  assert.match(html, /0 concorrentes no raio de 1,5 km/);
});
