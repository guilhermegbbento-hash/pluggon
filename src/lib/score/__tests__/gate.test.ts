import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { ScoreDataError, type ScoreLayer } from "../errors";
import { geocodeCityCenter, requireCityState } from "../geocode";
import { fetchIBGEData } from "../ibge";
import { parseStrengths } from "../strengths";

// ---------- helpers ----------

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const serie = (value: string) => [{ resultados: [{ series: [{ serie: { "2021": "1", "2022": value } }] }] }];

/** fetch falso: responde pela primeira regra cujo trecho aparece na URL. */
function fakeFetch(routes: Array<[string, () => Response | Promise<Response>]>) {
  return async (url: string) => {
    const hit = routes.find(([part]) => url.includes(part));
    if (!hit) throw new Error(`URL inesperada no teste: ${url}`);
    return hit[1]();
  };
}

async function rejectsWith(p: Promise<unknown>, layer: ScoreLayer, pattern: RegExp) {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof ScoreDataError, `esperava ScoreDataError, veio ${String(err)}`);
    assert.equal(err.layer, layer);
    assert.match(err.message, pattern);
    return true;
  });
}

const IBGE_OK: Array<[string, () => Response]> = [
  ["/municipios", () => json([{ id: 4106902, nome: "Curitiba" }])],
  ["/6579/", () => json(serie("1773718"))],
  ["/5938/", () => json(serie("98000000"))],
];

/** Base de municípios falsa: sempre devolve `linhas`. */
const baseCom = (linhas: unknown[]) =>
  ({ from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: linhas, error: null }) }) }) }) }) as never;

const CURITIBA = {
  cd_mun: 4106902,
  populacao: 1773718,
  ano_populacao: 2026,
  pib_mil: 98000000,
  ano_pib: 2023,
  carregado_em: "2026-10-22T17:00:00Z",
};

// ---------- IBGE (detalhes da base e das tentativas: src/lib/__tests__/ibge-municipio.test.ts) ----------

test("IBGE: população, PIB, PIB per capita e anos vindos da base de municípios", async () => {
  const d = await fetchIBGEData("Curitiba", "PR", { db: baseCom([CURITIBA]), fetchImpl: fakeFetch([]) });
  assert.equal(d.population, 1773718);
  assert.equal(d.population_year, 2026);
  assert.equal(d.gdp_total, 98_000_000_000);
  assert.equal(d.gdp_per_capita, Math.round(98_000_000_000 / 1773718));
  assert.equal(d.gdp_year, 2023);
});

test("IBGE: fora da base, busca ao vivo", async () => {
  const d = await fetchIBGEData("Curitiba", "PR", { db: baseCom([]), fetchImpl: fakeFetch(IBGE_OK) });
  assert.equal(d.population, 1773718);
  assert.equal(d.population_year, 2022);
});

test("IBGE: fora da base e lista de municípios fora do ar bloqueia", async () => {
  await rejectsWith(
    fetchIBGEData("Curitiba", "PR", { db: baseCom([]), fetchImpl: fakeFetch([["/municipios", () => json({}, 503)]]) }),
    "ibge",
    /Curitiba\/PR não está na base de municípios, e o IBGE ao vivo falhou — lista de municípios: HTTP 503 \(2 tentativas\)/
  );
});

test("IBGE: município fora da lista bloqueia em vez de virar população 0", async () => {
  await rejectsWith(
    fetchIBGEData("Curitba", "PR", { db: baseCom([]), fetchImpl: fakeFetch(IBGE_OK) }),
    "ibge",
    /"Curitba" não está na lista do IBGE/
  );
});

test("IBGE: PIB ainda não publicado bloqueia", async () => {
  await rejectsWith(
    fetchIBGEData("Curitiba", "PR", { db: baseCom([{ ...CURITIBA, pib_mil: null, ano_pib: null }]), fetchImpl: fakeFetch([]) }),
    "ibge",
    /ainda não publicou o PIB de Curitiba\/PR/
  );
});

test("IBGE: série de população vazia bloqueia", async () => {
  const f = fakeFetch([["/6579/", () => json([])], ...IBGE_OK]);
  await rejectsWith(fetchIBGEData("Curitiba", "PR", { db: null, fetchImpl: f }), "ibge", /série de população veio vazia/);
});

test("IBGE: PIB com HTTP 500 nas duas tentativas bloqueia", async () => {
  const f = fakeFetch([["/5938/", () => json({}, 500)], ...IBGE_OK]);
  await rejectsWith(fetchIBGEData("Curitiba", "PR", { db: null, fetchImpl: f }), "ibge", /PIB: HTTP 500 \(2 tentativas\)/);
});

// ---------- centro da cidade ----------

const GEOCODE = "maps.googleapis.com/maps/api/geocode";

test("centro da cidade: devolve as coordenadas do geocoding", async () => {
  const f = fakeFetch([[GEOCODE, () => json({ status: "OK", results: [{ geometry: { location: { lat: -25.43, lng: -49.27 } } }] })]]);
  assert.deepEqual(await geocodeCityCenter("Curitiba", "PR", "k", f), { lat: -25.43, lng: -49.27 });
});

test("centro da cidade: REQUEST_DENIED bloqueia com a mensagem do Google, em vez de distância 0", async () => {
  const f = fakeFetch([[GEOCODE, () => json({ status: "REQUEST_DENIED", error_message: "API key inválida" })]]);
  await rejectsWith(geocodeCityCenter("Curitiba", "PR", "k", f), "centro_da_cidade", /REQUEST_DENIED — API key inválida/);
});

test("centro da cidade: ZERO_RESULTS bloqueia", async () => {
  const f = fakeFetch([[GEOCODE, () => json({ status: "ZERO_RESULTS", results: [] })]]);
  await rejectsWith(geocodeCityCenter("Curitiba", "PR", "k", f), "centro_da_cidade", /ZERO_RESULTS/);
});

test("centro da cidade: falha de rede bloqueia", async () => {
  const f = fakeFetch([[GEOCODE, () => { throw new Error("ECONNRESET"); }]]);
  await rejectsWith(geocodeCityCenter("Curitiba", "PR", "k", f), "centro_da_cidade", /ECONNRESET/);
});

test("centro da cidade: sem chave do Google bloqueia", async () => {
  await rejectsWith(geocodeCityCenter("Curitiba", "PR", "", fakeFetch([])), "centro_da_cidade", /GOOGLE_MAPS_API_KEY ausente/);
});

test("localização: ponto sem cidade ou UF bloqueia", () => {
  assert.throws(() => requireCityState({ city: "", state: "PR" }), (e: unknown) => e instanceof ScoreDataError && e.layer === "localizacao");
  assert.doesNotThrow(() => requireCityState({ city: "Curitiba", state: "PR" }));
});

// ---------- pontos fortes (Claude) ----------

function msg(content: Array<Record<string, unknown>>, stop_reason = "end_turn") {
  return { content, stop_reason, usage: { input_tokens: 1, output_tokens: 1 } } as unknown as Anthropic.Message;
}

test("pontos fortes: lê o JSON mesmo depois de um bloco de raciocínio", () => {
  const m = msg([
    { type: "thinking", thinking: "", signature: "x" },
    { type: "text", text: '```json\n{"strengths": ["30 restaurantes em 500 m", " "]}\n```' },
  ]);
  assert.deepEqual(parseStrengths(m), ["30 restaurantes em 500 m"]);
});

test("pontos fortes: resposta cortada no max_tokens bloqueia", () => {
  assert.throws(() => parseStrengths(msg([{ type: "text", text: '{"strengths": ["a' }], "max_tokens")), /cortada no limite/);
});

test("pontos fortes: recusa bloqueia", () => {
  assert.throws(() => parseStrengths(msg([], "refusal")), /recusou/);
});

test("pontos fortes: só raciocínio, sem texto, bloqueia", () => {
  assert.throws(() => parseStrengths(msg([{ type: "thinking", thinking: "", signature: "x" }])), /não devolveu texto/);
});

test("pontos fortes: JSON inválido bloqueia", () => {
  assert.throws(() => parseStrengths(msg([{ type: "text", text: "Aqui estão os pontos" }])), /JSON inválido/);
});

test("pontos fortes: lista vazia bloqueia em vez de entregar o relatório sem a seção", () => {
  assert.throws(() => parseStrengths(msg([{ type: "text", text: '{"strengths": []}' }])), /lista de pontos fortes vazia/);
});
