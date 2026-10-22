import { test } from "node:test";
import assert from "node:assert/strict";
import { generateHeatmap, HeatmapGenerationError } from "../generate";
import { loadMunicipalIndicators } from "../municipal";
import type { GeocodeResponse } from "../scope";
import { CENTER, offset } from "./helpers";

/**
 * Desde 06/10/2026 o IBGE falhava em todo fetch do Node (cadeia de certificado
 * incompleta) e os indicadores municipais vinham vazios, calados. Sem
 * população, a estimativa de EVs saía 0 no mapa como se fosse dado. Desde
 * 22/10/2026 população e PIB vêm da base de municípios (o IBGE não responde à
 * Vercel); o IBGE ao vivo só para quem não está nela — os testes sem
 * `supabase` abaixo exercitam esse caminho.
 */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const serie = (value: string) => [{ resultados: [{ series: [{ serie: { "2021": "1", "2022": value } }] }] }];

function fakeIbge(overrides: Array<[string, () => Response]> = []) {
  const routes: Array<[string, () => Response]> = [
    ...overrides,
    ["/municipios", () => json([{ id: 4205407, nome: "Florianópolis" }])],
    ["/6579/", () => json(serie("537211"))],
    ["/5938/", () => json(serie("25000000"))],
  ];
  return async (url: string) => {
    const hit = routes.find(([part]) => url.includes(part));
    if (!hit) throw new Error(`URL inesperada no teste: ${url}`);
    return hit[1]();
  };
}

async function rejectsIbge(p: Promise<unknown>, detail: RegExp) {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof HeatmapGenerationError, `esperava HeatmapGenerationError, veio ${String(err)}`);
    assert.match(err.message, /Dados do IBGE indisponíveis para Florianópolis\/SC/);
    assert.match(err.details.join("\n"), detail);
    return true;
  });
}

test("base de municípios: população, PIB e anos entram nos indicadores sem chamar o IBGE", async () => {
  const linha = { cd_mun: 4205407, populacao: 537211, ano_populacao: 2026, pib_mil: 25000000, ano_pib: 2023, carregado_em: "2026-10-22T17:00:00Z" };
  const supabase = {
    from: (table: string) => {
      if (table !== "ibge_municipios") throw new Error(`tabela fora do teste: ${table}`);
      return { select: () => ({ eq: () => ({ eq: async () => ({ data: [linha], error: null }) }) }) };
    },
  } as never;
  const semIbge = async (url: string): Promise<Response> => {
    throw new Error(`o IBGE não devia ser chamado: ${url}`);
  };
  const m = await loadMunicipalIndicators("Florianópolis", "SC", { supabase, fetchImpl: semIbge });
  assert.equal(m.population, 537211);
  assert.equal(m.gdpPerCapita, Math.round(25_000_000_000 / 537211));
  assert.equal(m.populationYear, 2026);
  assert.equal(m.gdpYear, 2023);
  assert.equal(m.ibgeOrigem, "banco");
});

test("IBGE ao vivo ok: população, PIB per capita e anos entram nos indicadores", async () => {
  const m = await loadMunicipalIndicators("Florianópolis", "SC", { fetchImpl: fakeIbge() });
  assert.equal(m.population, 537211);
  assert.equal(m.gdpPerCapita, Math.round(25_000_000_000 / 537211));
  assert.equal(m.populationYear, 2022);
  assert.equal(m.ibgeOrigem, "ibge_ao_vivo");
});

test("IBGE: falha de TLS/rede aborta em vez de devolver vazio", async () => {
  const f = fakeIbge([["/municipios", () => { throw new Error("UNABLE_TO_VERIFY_LEAF_SIGNATURE"); }]]);
  await rejectsIbge(loadMunicipalIndicators("Florianópolis", "SC", { fetchImpl: f }), /lista de municípios: UNABLE_TO_VERIFY_LEAF_SIGNATURE/);
});

test("IBGE: HTTP 503 nas duas tentativas aborta", async () => {
  const f = fakeIbge([["/municipios", () => json({}, 503)]]);
  await rejectsIbge(loadMunicipalIndicators("Florianópolis", "SC", { fetchImpl: f }), /HTTP 503 \(2 tentativas\)/);
});

test("IBGE: município fora da lista aborta", async () => {
  const f = fakeIbge([["/municipios", () => json([{ id: 1, nome: "Palhoça" }])]]);
  await rejectsIbge(loadMunicipalIndicators("Florianópolis", "SC", { fetchImpl: f }), /não está na lista do IBGE/);
});

test("IBGE: série de população vazia aborta (não vira EVs estimados com população 0)", async () => {
  const f = fakeIbge([["/6579/", () => json([])]]);
  await rejectsIbge(loadMunicipalIndicators("Florianópolis", "SC", { fetchImpl: f }), /população veio vazia/);
});

test("IBGE: série de PIB vazia aborta", async () => {
  const f = fakeIbge([["/5938/", () => json([])]]);
  await rejectsIbge(loadMunicipalIndicators("Florianópolis", "SC", { fetchImpl: f }), /PIB veio vazia/);
});

// ---------- ordem: IBGE reprova antes de qualquer busca paga ----------

const geo = (types: string[], halfSideM: number, withBairro: boolean): GeocodeResponse => ({
  status: "OK",
  results: [
    {
      types,
      address_components: [
        ...(withBairro ? [{ long_name: "Bairro Teste", short_name: "Bairro Teste", types: ["sublocality_level_1", "political"] }] : []),
        { long_name: "Cidade Teste", short_name: "Cidade Teste", types: ["administrative_area_level_2", "political"] },
        { long_name: "Estado Teste", short_name: "SP", types: ["administrative_area_level_1", "political"] },
      ],
      geometry: {
        location: CENTER,
        bounds: { northeast: offset(CENTER, halfSideM, halfSideM), southwest: offset(CENTER, -halfSideM, -halfSideM) },
      },
    },
  ],
});

test("IBGE fora: o mapa aborta sem nenhuma busca no Google Places", async () => {
  let placesRequests = 0;
  const places = (async () => {
    placesRequests++;
    return { ok: true, json: async () => ({ places: [] }) } as unknown as Response;
  }) as unknown as typeof fetch;

  await assert.rejects(
    generateHeatmap(
      { city: "Cidade Teste", state: "SP", regions: ["Bairro Teste"] },
      {
        googleApiKey: "k",
        fetchImpl: places,
        geocode: async (address) =>
          address.startsWith("Bairro")
            ? geo(["sublocality_level_1", "sublocality", "political"], 900, true)
            : geo(["locality", "political"], 9000, false),
        loadMunicipal: async () => {
          throw new HeatmapGenerationError("IBGE indisponível para Cidade Teste/SP.", ["lista de municípios: HTTP 503"]);
        },
      }
    ),
    /IBGE indisponível/
  );
  assert.equal(placesRequests, 0, "nenhuma busca paga antes do IBGE");
});
