import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPLEMENTARY_SELECTION, SEARCH_RULES, specsForLayer } from "../config";
import { searchComplementaryAroundAnchors, type AnchorForComplementary } from "../places";

const ANCHORS: AnchorForComplementary[] = [
  { placeId: "a1", lat: -23.6, lng: -46.7, areaName: "Bairro Teste" },
  { placeId: "a2", lat: -23.61, lng: -46.71, areaName: "Bairro Teste" },
];

const place = (id: string, types: string[]) => ({
  id,
  displayName: { text: `Lugar ${id}` },
  formattedAddress: "Rua Sintética, 1",
  location: { latitude: -23.6, longitude: -46.7 },
  types,
  primaryType: types[0],
});

/** fetch falso: devolve o que o teste mandar, e guarda os corpos enviados. */
function fakeFetch(responses: unknown[][]) {
  const bodies: Record<string, unknown>[] = [];
  let i = 0;
  const impl = (async (_url: string, init?: { body?: string }) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    const places = responses[Math.min(i++, responses.length - 1)];
    return { ok: true, json: async () => ({ places }) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, bodies };
}

test("uma requisição por âncora, com todos os tipos complementares e ordenada por distância", async () => {
  const { impl, bodies } = fakeFetch([[place("p1", ["restaurant"])], [place("p2", ["pharmacy"])]]);
  const r = await searchComplementaryAroundAnchors(ANCHORS, { apiKey: "k", fetchImpl: impl });

  assert.equal(r.requests, 2, "uma requisição por âncora");
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].rankPreference, "DISTANCE");
  assert.deepEqual(
    bodies[0].includedTypes,
    specsForLayer("complementary").map((s) => s.includedType),
    "todos os tipos complementares numa requisição só"
  );
  const circle = (bodies[0].locationRestriction as { circle: { radius: number; center: { latitude: number } } }).circle;
  assert.equal(circle.radius, COMPLEMENTARY_SELECTION.maxDistanceToAnchorM, "raio = a promessa do relatório");
  assert.equal(circle.center.latitude, ANCHORS[0].lat, "centro = a âncora");

  assert.deepEqual(
    r.candidates.map((c) => [c.place.placeId, c.typeKey]),
    [["p1", "restaurant"], ["p2", "pharmacy"]],
    "cada lugar entra com o tipo complementar que ele valida"
  );
});

test("mesmo lugar perto de duas âncoras entra uma vez só", async () => {
  const { impl } = fakeFetch([[place("mesmo", ["bakery"])]]);
  const r = await searchComplementaryAroundAnchors(ANCHORS, { apiKey: "k", fetchImpl: impl });
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].typeKey, "bakery");
});

test("resumo por área: teto só conta quando sobra menos que a cota por âncora", async () => {
  const cheio = (types: string[]) =>
    Array.from({ length: SEARCH_RULES.nearbyMaxResults }, (_, i) => place(`${types[0]}-${i}`, types));

  // 20 resultados válidos: no teto, mas a cota por âncora está satisfeita.
  const ok = await searchComplementaryAroundAnchors([ANCHORS[0]], {
    apiKey: "k",
    fetchImpl: fakeFetch([cheio(["restaurant"])]).impl,
  });
  assert.equal(ok.summaries.length, 1);
  assert.equal(ok.summaries[0].areaName, "Bairro Teste");
  assert.equal(ok.summaries[0].returned, SEARCH_RULES.nearbyMaxResults);
  assert.equal(ok.summaries[0].truncated, false, "20 mais próximos cobrem a cota: não é corte");
  assert.ok(ok.candidates.length >= COMPLEMENTARY_SELECTION.maxPerAnchor);

  // 20 resultados fora da taxonomia: a cota NÃO é atendida — aí é corte de verdade.
  const cortado = await searchComplementaryAroundAnchors([ANCHORS[0]], {
    apiKey: "k",
    fetchImpl: fakeFetch([cheio(["car_repair"])]).impl,
  });
  assert.equal(cortado.candidates.length, 0);
  assert.equal(cortado.summaries[0].truncated, true);
  assert.equal(cortado.summaries[0].cappedCells, 1);
});

test("erro do Google é registrado no resumo, sem derrubar a busca das outras âncoras", async () => {
  let n = 0;
  // A primeira âncora falha nas DUAS tentativas (postPlaces repete em 5xx);
  // a segunda responde normalmente.
  const impl = (async () => {
    n++;
    if (n <= 2) return { ok: false, status: 500, statusText: "erro", json: async () => ({}) } as unknown as Response;
    return { ok: true, json: async () => ({ places: [place("p9", ["gym"])] }) } as unknown as Response;
  }) as unknown as typeof fetch;

  const r = await searchComplementaryAroundAnchors(ANCHORS, { apiKey: "k", fetchImpl: impl });
  assert.match(String(r.summaries[0].error), /HTTP 500/);
  assert.equal(r.candidates.length, 1, "a segunda âncora continua sendo buscada");
});
