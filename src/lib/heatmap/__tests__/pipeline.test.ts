/**
 * Os 7 bugs do relatório contaminado, reproduzidos com dados sintéticos.
 * Cada teste falha se o defeito voltar.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { influenceInnerRadiusM, runPipeline } from "../pipeline";
import { runQaGate } from "../qa-gate";
import { renderHeatmapHtml } from "../report-html";
import { scopeBoundsFor } from "../geo";
import type { Discard, DiscardReason, HeatmapPayload } from "../types";
import { cand, CENTER, makeScope, offset, place } from "./helpers";

const scope = makeScope({ radiusM: 1760 });

const shellAt = offset(CENTER, 300, 0);
const tieteBase = offset(CENTER, -600, 600);
const openCenterAt = offset(CENTER, 1000, 0);

const candidates = [
  // ÂNCORAS
  cand("anchor", "gas_station", place("a-shell", "Posto Shell", shellAt, { types: ["gas_station"], userRatingCount: 400 })),
  // BUG 1: regionais a centenas de km
  cand("anchor", "bus_station", place("a-rodo-df", "Rodoviária Interestadual", { lat: -15.7939, lng: -47.8828 }, { types: ["bus_station"], userRatingCount: 5000 })),
  cand("anchor", "airport", place("a-vcp", "Aeroporto Internacional de Viracopos", { lat: -23.0074, lng: -47.1345 }, { types: ["airport", "international_airport"], userRatingCount: 90000 })),
  // Aeroporto: heliporto e traslado trazem `airport` em types, mas o tipo principal é outro
  cand("anchor", "airport", place("a-heli", "Heliporto - Palácio", offset(CENTER, 500, -500), { types: ["heliport", "airport", "transportation_service"], primaryType: "heliport", userRatingCount: 3, hasPhone: true })),
  cand("anchor", "airport", place("a-shuttle", "Transporte Executivo Aeroporto", offset(CENTER, -500, 500), { types: ["airport_shuttle_service", "airport"], primaryType: "airport_shuttle_service", userRatingCount: 35, hasWebsite: true })),
  // Tipo principal certo, mas sem porte (loja tipada como aeroporto)
  cand("anchor", "airport", place("a-kiosk", "Loja Aeroporto", offset(CENTER, 700, 700), { types: ["international_airport", "airport"], primaryType: "international_airport", userRatingCount: 2, hasPhone: true })),
  cand("anchor", "airport", place("a-airport-in", "Aeroporto Regional", offset(CENTER, -1400, 300), { types: ["airport"], primaryType: "airport", userRatingCount: 61000 })),
  // Decisão 1: terminal DENTRO do raio é âncora
  cand("anchor", "bus_station", place("a-term-in", "Terminal Rodoviário Leste", offset(CENTER, 0, 900), { types: ["bus_station"], userRatingCount: 3000 })),
  // Ponto de ônibus de rua tipado como bus_station
  cand("anchor", "bus_station", place("a-stop", "Av. Qualquer, 4000", offset(CENTER, -400, -300), { types: ["bus_station", "transit_station"], userRatingCount: 2 })),
  // Nome de endereço, mas com porte e dados de operação: é terminal
  cand("anchor", "bus_station", place("a-term-addr", "Av. Mário de Andrade, 500", offset(CENTER, 0, 1300), { types: ["bus_station"], userRatingCount: 510, hasWebsite: true, hasPhone: true })),
  // Terminal pequeno com telefone: tem sinal
  cand("anchor", "bus_station", place("a-term-small", "Terminal Rodoviário", offset(CENTER, -1000, 0), { types: ["bus_station"], userRatingCount: 23, hasPhone: true })),
  // BUG 4: tipo vindo da query, não de `types`
  cand("anchor", "gas_station", place("a-drogasil-as-gas", "Drogasil", offset(CENTER, 200, 200), { types: ["pharmacy", "store"] })),
  cand("anchor", "gas_station", place("a-police", "Posto Policial - 16° BPM/M", offset(CENTER, -200, 200), { types: ["police"] })),
  cand("anchor", "gas_station", place("a-stadium", "Estádio", offset(CENTER, -300, -100), { types: ["stadium"] })),
  // BUG 5: três registros do mesmo terminal (110–206 m)
  cand("anchor", "bus_station", place("a-tiete-1", "Terminal Rodoviário Tietê", tieteBase, { types: ["bus_station"], userRatingCount: 1341, hasWebsite: true })),
  cand("anchor", "bus_station", place("a-tiete-2", "Rodoviaria Tiete", offset(tieteBase, 114, 0), { types: ["bus_station"], userRatingCount: 1692 })),
  cand("anchor", "bus_station", place("a-tiete-3", "Rodoviária do Tietê", offset(tieteBase, 0, 110), { types: ["bus_station"], userRatingCount: 15122 })),
  // Decisão 3: dois shoppings distintos a 93 m sobrevivem
  cand("anchor", "shopping_mall", place("a-open", "Morumbi Open Center", openCenterAt, { types: ["shopping_mall"], userRatingCount: 800 })),
  cand("anchor", "shopping_mall", place("a-portal", "Shopping Portal do Morumbi", offset(openCenterAt, 93, 0), { types: ["shopping_mall"], userRatingCount: 700 })),
  cand("anchor", "shopping_mall", place("p-mshop", "Morumbi Shopping", offset(CENTER, 0, -700), { types: ["shopping_mall"], userRatingCount: 60000 })),
  // Proximidade SEM nome similar não é duplicata (dois postos a 10 m)
  cand("anchor", "gas_station", place("a-posto-1", "Posto Ipiranga", offset(CENTER, -1200, -600), { types: ["gas_station"], userRatingCount: 100 })),
  cand("anchor", "gas_station", place("a-posto-2", "Auto Posto Sete Estrelas", offset(CENTER, -1190, -600), { types: ["gas_station"], userRatingCount: 90 })),

  // COMPLEMENTARES
  // BUG 5: mesmo lugar na camada de âncoras
  cand("complementary", "supermarket", place("p-mshop", "Morumbi Shopping", offset(CENTER, 0, -700), { types: ["supermarket", "shopping_mall"], userRatingCount: 60000 })),
  cand("complementary", "pharmacy", place("c-drogasil", "Drogasil", offset(shellAt, 10, 0), { types: ["pharmacy"] })),
  cand("complementary", "convenience_store", place("c-drogasil", "Drogasil", offset(shellAt, 10, 0), { types: ["pharmacy", "convenience_store"] })),
  ...["Cantina Bella", "Sushi Kenzo", "Churrascaria Gaúcha", "Pizzaria Forno", "Lanchonete Central", "Bistrô Jardim"].map((name, i) =>
    cand("complementary", "restaurant", place(`c-rest-${i}`, name, offset(shellAt, 0, [20, 40, 60, 80, 90, 95][i]), { types: ["restaurant"] }))
  ),
  cand("complementary", "bakery", place("c-bakery-far", "Padaria Isolada", offset(CENTER, 0, -1650), { types: ["bakery"] })),

  // CONCORRENTES
  // BUG 2: concorrente perto do centro do MUNICÍPIO, fora do escopo
  cand("competitor", "electric_vehicle_charging_station", place("k-far", "Eletroposto Avenida Distante", offset(CENTER, 6000, 6000), { types: ["electric_vehicle_charging_station"], chargerMaxKw: 150, chargerKwSource: "google_ev_options" })),
  cand("competitor", "electric_vehicle_charging_station", place("k-ac", "Eletroposto Hospital", offset(CENTER, 600, 0), { types: ["electric_vehicle_charging_station"], chargerMaxKw: 22, chargerKwSource: "google_ev_options" })),
  cand("competitor", "electric_vehicle_charging_station", place("k-dc", "Eletroposto Rápido", offset(CENTER, -800, 0), { types: ["electric_vehicle_charging_station"], chargerMaxKw: 150, chargerKwSource: "google_ev_options" })),
  // BUG 7: sem potência → não informado, nunca DC
  cand("competitor", "electric_vehicle_charging_station", place("k-unk", "Carregador Ultra Fast DC", offset(CENTER, 0, 400), { types: ["electric_vehicle_charging_station"] })),
  cand("competitor", "electric_vehicle_charging_station", place("ocm:1", "Estação OCM", offset(CENTER, 0, -300), { types: ["electric_vehicle_charging_station"], source: "openchargemap", chargerMaxKw: 7, chargerKwSource: "openchargemap" })),
];

const out = runPipeline(scope, candidates);

const reasonOf = (placeId: string, layer?: string): DiscardReason[] =>
  out.discards.filter((d: Discard) => d.placeId === placeId && (!layer || d.layer === layer)).map((d) => d.reason);
const allPoints = () => [...out.anchors, ...out.complementary, ...out.competitors];

test("BUG 1 — regionais fora do raio são descartados como fora_do_raio", () => {
  assert.deepEqual(reasonOf("a-rodo-df"), ["fora_do_raio"]);
  assert.deepEqual(reasonOf("a-vcp"), ["fora_do_raio"]);
  for (const p of allPoints()) assert.ok(p.distanceToCenterM <= 1760, `${p.name} a ${p.distanceToCenterM} m`);
});

test("Decisão 1 — terminal e aeroporto seguem como categoria; dentro do raio viram âncora", () => {
  const ids = out.anchors.map((a) => a.placeId);
  assert.ok(ids.includes("a-term-in"));
  assert.ok(ids.includes("a-term-addr"), "terminal com nome de endereço mas com porte/dados deve ficar");
  assert.ok(ids.includes("a-term-small"), "terminal pequeno com telefone deve ficar");
  assert.deepEqual(reasonOf("a-stop"), ["ponto_de_onibus_sem_sinal_de_terminal"]);
});

test("Aeroporto — tipo principal precisa ser aeroporto e precisa ter porte", () => {
  assert.deepEqual(reasonOf("a-heli"), ["tipo_principal_divergente"]);
  assert.deepEqual(reasonOf("a-shuttle"), ["tipo_principal_divergente"]);
  assert.deepEqual(reasonOf("a-kiosk"), ["aeroporto_sem_porte"]);
  assert.ok(out.anchors.some((a) => a.placeId === "a-airport-in"), "aeroporto de verdade dentro do raio é âncora");
});

test("BUG 2 — concorrentes usam o MESMO escopo: longe sai, perto entra", () => {
  assert.deepEqual(reasonOf("k-far"), ["fora_do_raio"]);
  assert.ok(out.competitors.some((c) => c.placeId === "k-ac"));
  assert.ok(out.competitors.some((c) => c.placeId === "k-dc"));
});

test("BUG 3 — métricas da âncora vêm dos arrays renderizados, com direção definida", () => {
  const shell = out.anchors.find((a) => a.placeId === "a-shell")!;
  // 7 complementares brutos perto do posto, só 5 renderizados
  assert.equal(shell.complementaryWithin300m, 5);
  assert.equal(reasonOf("c-rest-4").concat(reasonOf("c-rest-5")).filter((r) => r === "complementar_excedente_por_ancora").length, 2);
  // Eletropostos renderizados a 300 m, 424 m e 500 m do posto
  assert.equal(shell.competitorsWithin1km, 3);
  // 250 + 5×15 − 3×25
  assert.equal(shell.influenceInnerRadiusM, 250);
  assert.ok(!("nearbyCompCount" in shell));
});

test("BUG 3 — direção do efeito: complementar aumenta, concorrente diminui", () => {
  assert.ok(influenceInnerRadiusM(4, 0) > influenceInnerRadiusM(0, 0));
  assert.ok(influenceInnerRadiusM(0, 2) < influenceInnerRadiusM(0, 0));
  assert.ok(influenceInnerRadiusM(4, 2) < influenceInnerRadiusM(4, 0));
});

test("BUG 4 — tipo validado por `types`, não pelo nome nem pela query", () => {
  assert.deepEqual(reasonOf("a-drogasil-as-gas"), ["tipo_invalido"]);
  assert.deepEqual(reasonOf("a-police"), ["tipo_invalido"]);
  assert.deepEqual(reasonOf("a-stadium"), ["tipo_invalido"]);
  for (const a of out.anchors) assert.equal(a.validatedBy, "google_types");
});

test("BUG 5 — dedupe por place_id, por proximidade+nome e entre camadas", () => {
  const tietes = out.anchors.filter((a) => a.placeId.startsWith("a-tiete"));
  assert.equal(tietes.length, 1, "os três Tietê colapsam em um");
  assert.equal(tietes[0].placeId, "a-tiete-3", "fica o registro mais proeminente");
  assert.deepEqual(
    [...reasonOf("a-tiete-1"), ...reasonOf("a-tiete-2")],
    ["duplicata_proximidade_nome", "duplicata_proximidade_nome"]
  );

  const ids = out.anchors.map((a) => a.placeId);
  assert.ok(ids.includes("a-open") && ids.includes("a-portal"), "shoppings distintos a 93 m sobrevivem");
  assert.ok(ids.includes("a-posto-1") && ids.includes("a-posto-2"), "distância pura não funde postos diferentes");

  assert.deepEqual(reasonOf("p-mshop", "complementary"), ["duplicata_entre_camadas"]);
  assert.deepEqual(reasonOf("c-drogasil"), ["duplicata_place_id"]);

  const seen = new Set<string>();
  for (const p of allPoints()) {
    assert.ok(!seen.has(p.placeId), `place_id repetido: ${p.placeId}`);
    seen.add(p.placeId);
  }
});

test("complementar longe de qualquer âncora não entra e é reportado", () => {
  assert.deepEqual(reasonOf("c-bakery-far"), ["complementar_sem_ancora_proxima"]);
});

function payloadOf(): HeatmapPayload {
  return {
    generatorVersion: "teste",
    generatedAt: "2026-09-14T12:00:00.000Z",
    scope,
    ...out,
    searches: [],
    sources: [{ name: "OpenChargeMap (Bairro Teste)", status: "indisponivel", detail: "OPENCHARGEMAP_API_KEY ausente" }],
    municipal: null,
    qa: null,
    googleQueries: 0,
  };
}

test("BUG 6 — fitBounds enquadra o escopo (centro + raio), não os pontos", () => {
  const html = renderHeatmapHtml(payloadOf(), { tileUrl: "about:blank" });
  const fits = html.match(/fitBounds\(/g) ?? [];
  assert.equal(fits.length, 1);
  assert.match(html, /map\.fitBounds\(\[\[scope\.bounds\.south, scope\.bounds\.west\], \[scope\.bounds\.north, scope\.bounds\.east\]\]/);
  assert.deepEqual(scope.bounds, scopeBoundsFor(scope.areas));
});

test("BUG 7 — sem potência é 'não informado' e nunca conta como DC; título cita o bairro", () => {
  const unk = out.competitors.find((c) => c.placeId === "k-unk")!;
  assert.equal(unk.charger_type, "unknown", "nome com 'Ultra Fast DC' não pode virar DC");
  assert.equal(out.counters.competitorsDC, 1);
  assert.equal(out.counters.competitorsAC, 2);
  assert.equal(out.counters.competitorsUnknown, 1);

  const html = renderHeatmapHtml(payloadOf(), { tileUrl: "about:blank" });
  assert.match(html, /<title>PLUGGON — Mapa de Calor — Bairro Teste · Cidade Teste\/SP<\/title>/);
  assert.match(html, /n&atilde;o informado/);
});

test("nome contido a ≤ 50 m: plataforma do mesmo terminal colapsa; calibração anterior intacta", () => {
  const s = makeScope({ radiusM: 3000 });
  const term = offset(CENTER, 500, 500);
  const mall = offset(CENTER, -800, 0);
  const tiete = offset(CENTER, 800, -800);
  const r = runPipeline(s, [
    cand("anchor", "bus_station", place("t-main", "Terminal Pinheirinho", term, { types: ["bus_station"], userRatingCount: 5000 })),
    cand("anchor", "bus_station", place("t-plat", "Terminal Pinheirinho - 650 - Santa Rita / Pinheirinho", offset(term, 12, 0), { types: ["bus_station"], userRatingCount: 150 })),
    // Os dois shoppings: a 93 m (como no caso real) e também a 40 m, para provar que a regra nova não os funde
    cand("anchor", "shopping_mall", place("m-open", "Morumbi Open Center", mall, { types: ["shopping_mall"], userRatingCount: 800 })),
    cand("anchor", "shopping_mall", place("m-portal", "Shopping Portal do Morumbi", offset(mall, 93, 0), { types: ["shopping_mall"], userRatingCount: 700 })),
    cand("anchor", "shopping_mall", place("m-open-40", "Morumbi Open Center", offset(CENTER, -2000, 0), { types: ["shopping_mall"], userRatingCount: 800 })),
    cand("anchor", "shopping_mall", place("m-portal-40", "Shopping Portal do Morumbi", offset(CENTER, -1960, 0), { types: ["shopping_mall"], userRatingCount: 700 })),
    cand("anchor", "bus_station", place("ti-1", "Terminal Rodoviário Tietê", tiete, { types: ["bus_station"], userRatingCount: 1341, hasWebsite: true })),
    cand("anchor", "bus_station", place("ti-2", "Rodoviaria Tiete", offset(tiete, 114, 0), { types: ["bus_station"], userRatingCount: 1692 })),
    cand("anchor", "bus_station", place("ti-3", "Rodoviária do Tietê", offset(tiete, 0, 110), { types: ["bus_station"], userRatingCount: 15122 })),
  ]);
  const ids = r.anchors.map((a) => a.placeId);
  assert.ok(ids.includes("t-main") && !ids.includes("t-plat"));
  assert.deepEqual(r.discards.filter((d) => d.placeId === "t-plat").map((d) => d.reason), ["duplicata_nome_contido"]);
  for (const id of ["m-open", "m-portal", "m-open-40", "m-portal-40"]) assert.ok(ids.includes(id), `${id} precisa sobreviver`);
  assert.deepEqual(ids.filter((id) => id.startsWith("ti-")), ["ti-3"]);
});

test("pipeline sai aprovado pelo QA gate", () => {
  const report = runQaGate(payloadOf());
  assert.deepEqual(report.violations, []);
  assert.equal(report.passed, true);
});
