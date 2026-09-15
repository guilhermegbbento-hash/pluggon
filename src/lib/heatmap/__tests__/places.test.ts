/**
 * Subdivisão de busca contra uma Places API FALSA que reproduz os tetos reais:
 * searchNearby devolve no máximo 20; searchText no máximo 60 (sem token depois disso).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { specByKey } from "../config";
import { generateHeatmap } from "../generate";
import { haversineM } from "../geo";
import { searchSpecInArea } from "../places";
import { QaGateError } from "../qa-gate";
import type { GeocodeFn } from "../scope";
import { CENTER, makeScope, offset } from "./helpers";

type Pt = { id: string; lat: number; lng: number; types: string[] };

function fakePlacesApi(points: Pt[]): typeof fetch {
  const toPlace = (p: Pt) => ({
    id: p.id,
    displayName: { text: `Estação ${p.id}` },
    location: { latitude: p.lat, longitude: p.lng },
    types: p.types,
    primaryType: p.types[0],
    userRatingCount: 10,
  });
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (u.endsWith(":searchNearby")) {
      const c = body.locationRestriction.circle;
      const center = { lat: c.center.latitude, lng: c.center.longitude };
      const hits = points
        .filter((p) => p.types.includes(body.includedTypes[0]) && haversineM(center, p) <= c.radius)
        .sort((a, b) => haversineM(center, a) - haversineM(center, b))
        .slice(0, 20);
      return new Response(JSON.stringify({ places: hits.map(toPlace) }), { status: 200 });
    }
    if (u.endsWith(":searchText")) {
      const r = body.locationRestriction.rectangle;
      const hits = points
        .filter(
          (p) =>
            p.types.includes(body.includedType) &&
            p.lat >= r.low.latitude &&
            p.lat <= r.high.latitude &&
            p.lng >= r.low.longitude &&
            p.lng <= r.high.longitude
        )
        .slice(0, 60);
      const start = body.pageToken ? Number(body.pageToken) : 0;
      const next = start + 20 < hits.length ? String(start + 20) : undefined;
      return new Response(JSON.stringify({ places: hits.slice(start, start + 20).map(toPlace), nextPageToken: next }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

/** Pontos espalhados numa grade dentro do círculo. */
function spread(n: number, radiusM: number, type: string): Pt[] {
  const pts: Pt[] = [];
  const side = Math.ceil(Math.sqrt(n * 1.4));
  for (let i = 0; i < side && pts.length < n; i++) {
    for (let j = 0; j < side && pts.length < n; j++) {
      const p = offset(CENTER, ((i + 0.5) / side - 0.5) * 2 * radiusM, ((j + 0.5) / side - 0.5) * 2 * radiusM);
      if (haversineM(CENTER, p) <= radiusM * 0.98) pts.push({ id: `${type}-${pts.length}`, ...p, types: [type] });
    }
  }
  return pts;
}

const EV = "electric_vehicle_charging_station";

test("camada obrigatória: 150 eletropostos num raio de 1,5 km voltam TODOS, sem célula no teto", async () => {
  const points = spread(150, 1500, EV);
  assert.equal(points.length, 150);
  const area = makeScope({ radiusM: 1500 }).areas[0];
  const r = await searchSpecInArea(specByKey(EV)!, area, { apiKey: "x", fetchImpl: fakePlacesApi(points) });
  assert.equal(r.places.length, 150, "sem subdivisão voltariam no máximo 60 + 20");
  for (const s of r.summaries) {
    assert.equal(s.cappedCells, 0, `${s.method} "${s.query}"`);
    assert.equal(s.truncated, false);
  }
  assert.ok(r.summaries.find((s) => s.method === "searchNearby")!.cells > 1, "precisou subdividir");
});

test("camada de apoio não subdivide: teto fica sinalizado", async () => {
  const points = spread(150, 1500, "restaurant");
  const area = makeScope({ radiusM: 1500 }).areas[0];
  const r = await searchSpecInArea(specByKey("restaurant")!, area, { apiKey: "x", fetchImpl: fakePlacesApi(points) });
  assert.equal(r.summaries[0].cells, 1);
  assert.equal(r.summaries[0].truncated, true);
  assert.equal(r.places.length, 60);
});

test("camada obrigatória que continua no teto após subdividir aborta o relatório no QA gate", async () => {
  // 30 estações no mesmo ponto: nenhuma subdivisão consegue separar
  const stack: Pt[] = Array.from({ length: 30 }, (_, i) => ({ id: `stack-${i}`, ...offset(CENTER, 100, 100), types: [EV] }));
  const cityResult = {
    types: ["locality", "political"],
    address_components: [
      { long_name: "Cidade Teste", short_name: "Cidade Teste", types: ["administrative_area_level_2", "political"] },
      { long_name: "Estado", short_name: "SP", types: ["administrative_area_level_1", "political"] },
    ],
    geometry: {
      location: CENTER,
      bounds: { northeast: offset(CENTER, 5000, 5000), southwest: offset(CENTER, -5000, -5000) },
    },
  };
  const geocode: GeocodeFn = async () => ({ status: "OK", results: [cityResult] });
  await assert.rejects(
    generateHeatmap({ city: "Cidade Teste", state: "SP", regions: [] }, { googleApiKey: "x", fetchImpl: fakePlacesApi(stack), geocode }),
    (err: unknown) => err instanceof QaGateError && err.report.violations.some((v) => v.rule === "camada_incompleta")
  );
});
