import { test } from "node:test";
import assert from "node:assert/strict";
import { getCityEVData, getCityEVDataAsync } from "../../abve-real-data";
import { haversineM } from "../../heatmap/geo";
import type { GooglePlaceV1 } from "../../heatmap/places";
import { CENTER, offset } from "../../heatmap/__tests__/helpers";
import { buscarConcorrentes } from "../concorrentes";
import { exigirDcCidade } from "../dc-cidade";
import { ScoreDataError } from "../errors";

/**
 * Até 22/10/2026 o Score buscava concorrentes numa busca única com teto de 20
 * e classificava DC pelo nome. Aqui: a busca subdividida do Mapa de Calor, o
 * tipo pela potência e "potência não informada" contando como DC.
 * Dados sintéticos; nenhuma resposta real do Google.
 */

const LOCAL = { city: "Cidade Teste", state: "SP" };

function eletroposto(id: string, northM: number, eastM: number, kw: number | null, extra: Partial<GooglePlaceV1> = {}): GooglePlaceV1 {
  const at = offset(CENTER, northM, eastM);
  return {
    id,
    displayName: { text: `Eletroposto ${id}` },
    formattedAddress: `Rua ${id}, 100`,
    location: { latitude: at.lat, longitude: at.lng },
    types: ["electric_vehicle_charging_station", "point_of_interest"],
    primaryType: "electric_vehicle_charging_station",
    businessStatus: "OPERATIONAL",
    userRatingCount: 10,
    ...(kw === null ? {} : { evChargeOptions: { connectorAggregation: [{ maxChargeRateKw: kw, count: 2 }] } }),
    ...extra,
  };
}

/**
 * Places API falsa que respeita a área pedida e o teto: 20 por página na
 * searchText (até 60, com token), 20 na searchNearby. Assim a subdivisão é
 * exercitada de verdade.
 */
function fakePlaces(world: GooglePlaceV1[], opts: { status?: number; message?: string } = {}) {
  const calls = { n: 0 };
  const f = (async (url: string, init?: RequestInit) => {
    calls.n++;
    if (opts.status) return new Response(JSON.stringify({ error: { message: opts.message } }), { status: opts.status });
    const body = JSON.parse(String(init?.body));
    const pos = (p: GooglePlaceV1) => ({ lat: p.location!.latitude, lng: p.location!.longitude });
    if (url.endsWith(":searchText")) {
      const { low, high } = body.locationRestriction.rectangle;
      const inside = world.filter((p) => {
        const { lat, lng } = pos(p);
        return lat >= low.latitude && lat <= high.latitude && lng >= low.longitude && lng <= high.longitude;
      });
      const start = Number(body.pageToken ?? 0);
      const next = start + 20;
      return new Response(
        JSON.stringify({ places: inside.slice(start, next), nextPageToken: next < inside.length && next < 60 ? String(next) : undefined })
      );
    }
    const { center, radius } = body.locationRestriction.circle;
    const c = { lat: center.latitude, lng: center.longitude };
    const inside = world.filter((p) => haversineM(c, pos(p)) <= radius);
    return new Response(JSON.stringify({ places: inside.slice(0, 20) }));
  }) as unknown as typeof fetch;
  return { f, calls };
}

async function bloqueia(p: Promise<unknown>, layer: string, pattern: RegExp) {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof ScoreDataError, `esperava ScoreDataError, veio ${String(err)}`);
    assert.equal(err.layer, layer);
    assert.match(err.message, pattern);
    return true;
  });
}

// ---------- contagem por raio ----------

test("concorrentes: potência não informada conta como DC e aparece separada", async () => {
  const world = [
    eletroposto("dc150", 100, 0, 150),
    eletroposto("ac7", 300, 0, 7.4),
    eletroposto("semkw", 0, 900, null),
    eletroposto("dc60", -1500, 0, 60),
    eletroposto("longe", 2500, 0, 150),
  ];
  const r = await buscarConcorrentes(CENTER.lat, CENTER.lng, LOCAL, { apiKey: "k", fetchImpl: fakePlaces(world).f });
  assert.deepEqual(r.lista.map((c) => c.name), ["Eletroposto dc150", "Eletroposto ac7", "Eletroposto semkw", "Eletroposto dc60"]);
  assert.deepEqual(r.dc, { 200: 1, 500: 1, 1000: 2, 2000: 3 });
  assert.deepEqual(r.semPotencia, { 200: 0, 500: 0, 1000: 1, 2000: 1 });
  assert.match(r.nomes[200][0], /Eletroposto dc150 - Rua dc150, 100 \(DC 150 kW\)/);
  assert.match(r.nomes[1000][1], /Eletroposto semkw .*\(potência não informada\)/);
  assert.ok(!r.nomes[2000].some((n) => n.includes("ac7")), "AC não entra na concorrência DC");
});

test("concorrentes: área densa — subdivide e acha todos, não os 20 do teto", async () => {
  const world: GooglePlaceV1[] = [];
  for (let i = 0; i < 90; i++) {
    const ang = (i * 137.5 * Math.PI) / 180;
    const dist = 150 + (i % 18) * 100;
    world.push(eletroposto(`p${i}`, Math.cos(ang) * dist, Math.sin(ang) * dist, i % 3 === 0 ? null : 120));
  }
  const g = fakePlaces(world);
  const r = await buscarConcorrentes(CENTER.lat, CENTER.lng, LOCAL, { apiKey: "k", fetchImpl: g.f });
  assert.equal(r.lista.length, 90);
  assert.equal(r.dc[2000], 90);
  assert.equal(r.semPotencia[2000], 30);
  assert.equal(r.requests, g.calls.n);
  assert.ok(r.requests > 3, `esperava subdivisão, foram ${r.requests} consultas`);
});

test("concorrentes: fechado de vez e lugar que não é eletroposto ficam fora", async () => {
  const world = [
    eletroposto("ok", 100, 0, 50),
    eletroposto("fechado", 200, 0, 50, { businessStatus: "CLOSED_PERMANENTLY" }),
    eletroposto("loja", 300, 0, null, { types: ["store"], primaryType: "store" }),
  ];
  const r = await buscarConcorrentes(CENTER.lat, CENTER.lng, LOCAL, { apiKey: "k", fetchImpl: fakePlaces(world).f });
  assert.deepEqual(r.lista.map((c) => c.name), ["Eletroposto ok"]);
});

test("concorrentes: zero de verdade passa como zero", async () => {
  const r = await buscarConcorrentes(CENTER.lat, CENTER.lng, LOCAL, { apiKey: "k", fetchImpl: fakePlaces([]).f });
  assert.equal(r.lista.length, 0);
  assert.deepEqual(r.dc, { 200: 0, 500: 0, 1000: 0, 2000: 0 });
});

// ---------- bloqueios ----------

test("concorrentes: erro da Places API bloqueia com a mensagem do Google", async () => {
  await bloqueia(
    buscarConcorrentes(CENTER.lat, CENTER.lng, LOCAL, { apiKey: "k", fetchImpl: fakePlaces([], { status: 403, message: "API key not valid" }).f }),
    "concorrentes",
    /busca no Google Places falhou — .*HTTP 403: API key not valid/
  );
});

test("concorrentes: ainda no teto depois de subdividir até o fim bloqueia", async () => {
  // 25 eletropostos no mesmo prédio: nenhuma célula fica abaixo do teto de 20.
  const world = Array.from({ length: 25 }, (_, i) => eletroposto(`mesmo${i}`, 300 + i * 0.1, 0, 22));
  await bloqueia(
    buscarConcorrentes(CENTER.lat, CENTER.lng, LOCAL, { apiKey: "k", fetchImpl: fakePlaces(world).f }),
    "concorrentes",
    /continuou no teto da API/
  );
});

test("concorrentes: sem chave do Google bloqueia sem consultar", async () => {
  const g = fakePlaces([]);
  await bloqueia(buscarConcorrentes(CENTER.lat, CENTER.lng, LOCAL, { apiKey: "", fetchImpl: g.f }), "concorrentes", /GOOGLE_MAPS_API_KEY ausente/);
  assert.equal(g.calls.n, 0);
});

// ---------- DC da cidade (ABVE) ----------

test("DC da cidade: sem número cadastrado bloqueia dizendo o que fazer", () => {
  assert.throws(
    () => exigirDcCidade(null, "Niterói", "RJ"),
    (err: unknown) =>
      err instanceof ScoreDataError &&
      err.layer === "dc_cidade" &&
      err.status === 400 &&
      /Niterói\/RJ ainda não tem o número de carregadores DC da ABVE/.test(err.message) &&
      /preencha "Carregadores DC"/.test(err.message)
  );
});

test("DC da cidade: 0 digitado é dado, não campo vazio", () => {
  assert.equal(exigirDcCidade(0, "Cidade Pequena", "MG"), 0);
  assert.equal(exigirDcCidade(146, "Fortaleza", "CE"), 146);
});

test("DC da cidade: digitado > salvo > lista ABVE > sem dado", async () => {
  const salvo = (row: Record<string, unknown> | null) =>
    ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) }) }) as never;
  const linha = { bev: 10, phev: 5, chargers_ac: 3, chargers_dc: 0, dc_in_city: 14, updated_at: "2026-10-01" };

  assert.equal(getCityEVData("Cidade Fora da Lista", "MG", 1, 1, { chargersDC: 0 }).dcInformado, 0);
  assert.equal(getCityEVData("Cidade Fora da Lista", "MG", 1, 1, null).dcInformado, null);
  // DC salvo como 0 é dado; a contagem antiga do Google (dc_in_city) não entra.
  assert.equal((await getCityEVDataAsync("Cidade Fora da Lista", "MG", 1, 1, null, salvo(linha))).dcInformado, 0);
  assert.equal((await getCityEVDataAsync("Cidade Fora da Lista", "MG", 1, 1, { chargersDC: 7 }, salvo(linha))).dcInformado, 7);
  assert.equal((await getCityEVDataAsync("Cidade Fora da Lista", "MG", 1, 1, null, salvo({ ...linha, chargers_dc: null }))).dcInformado, null);
});
