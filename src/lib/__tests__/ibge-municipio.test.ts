import { test } from "node:test";
import assert from "node:assert/strict";
import { getMunicipioIBGE, IbgeMunicipioError, ultimoValor, type IbgeDb } from "../ibge-municipio";

/**
 * Desde 22/10/2026 o IBGE não responde às funções da Vercel, e o Score e o
 * Mapa de Calor pararam juntos. População e PIB agora vêm da base de
 * municípios; o IBGE ao vivo só para quem não está nela.
 */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const serie = (pares: Record<string, string>) => [{ resultados: [{ series: [{ serie: pares }] }] }];

const LINHA_FORTALEZA = {
  cd_mun: 2304400,
  populacao: 2582360,
  ano_populacao: 2026,
  pib_mil: 86939832,
  ano_pib: 2023,
  carregado_em: "2026-10-22T17:00:00Z",
};

/** Banco falso: devolve `result` e guarda os filtros usados. */
function fakeDb(result: { data: unknown[] | null; error: { message: string } | null } | Error) {
  const filtros: Record<string, string> = {};
  const db = {
    from: () => ({
      select: () => ({
        eq: (c1: string, v1: string) => ({
          eq: async (c2: string, v2: string) => {
            filtros[c1] = v1;
            filtros[c2] = v2;
            if (result instanceof Error) throw result;
            return result;
          },
        }),
      }),
    }),
  } as unknown as IbgeDb;
  return { db, filtros };
}

/** IBGE falso: responde pela primeira regra cujo trecho aparece na URL e conta as chamadas. */
function fakeIbge(overrides: Array<[string, () => Response | Promise<Response>]> = []) {
  const chamadas: string[] = [];
  const routes: Array<[string, () => Response | Promise<Response>]> = [
    ...overrides,
    ["/municipios", () => json([{ id: 2304400, nome: "Fortaleza" }])],
    ["/6579/", () => json(serie({ "2025": "2570000", "2026": "2582360" }))],
    ["/5938/", () => json(serie({ "2022": "80000000", "2023": "86939832" }))],
  ];
  const fetchImpl = async (url: string) => {
    chamadas.push(url);
    const hit = routes.find(([part]) => url.includes(part));
    if (!hit) throw new Error(`URL inesperada no teste: ${url}`);
    return hit[1]();
  };
  return { fetchImpl, chamadas };
}

const ibgeProibido = async (url: string): Promise<Response> => {
  throw new Error(`o IBGE não devia ser chamado: ${url}`);
};

async function rejeita(p: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof IbgeMunicipioError, `esperava IbgeMunicipioError, veio ${String(err)}`);
    assert.match(err.message, pattern);
    return true;
  });
}

// ---------- base de municípios ----------

test("está na base: entrega população, PIB e anos sem chamar o IBGE", async () => {
  const { db, filtros } = fakeDb({ data: [LINHA_FORTALEZA], error: null });
  const m = await getMunicipioIBGE("Fortaleza", "ce", { db, fetchImpl: ibgeProibido });
  assert.deepEqual(filtros, { uf: "CE", nome_busca: "fortaleza" });
  assert.equal(m.origem, "banco");
  assert.equal(m.population, 2582360);
  assert.equal(m.populationYear, 2026);
  assert.equal(m.gdpTotal, 86_939_832_000);
  assert.equal(m.gdpPerCapita, Math.round(86_939_832_000 / 2582360));
  assert.equal(m.gdpYear, 2023);
});

test("PIB numeric vindo como texto do banco é lido como número", async () => {
  const { db } = fakeDb({ data: [{ ...LINHA_FORTALEZA, pib_mil: "86939832" }], error: null });
  const m = await getMunicipioIBGE("Fortaleza", "CE", { db, fetchImpl: ibgeProibido });
  assert.equal(m.gdpTotal, 86_939_832_000);
});

test("PIB ainda não publicado: bloqueia com aviso, sem número inventado e sem chamar o IBGE", async () => {
  const { db } = fakeDb({ data: [{ ...LINHA_FORTALEZA, pib_mil: null, ano_pib: null }], error: null });
  await rejeita(
    getMunicipioIBGE("Boa Esperança do Norte", "MT", { db, fetchImpl: ibgeProibido }),
    /o IBGE ainda não publicou o PIB de Boa Esperança do Norte\/MT \(base de municípios carregada em 22\/10\/2026\)/
  );
});

// ---------- fora da base: IBGE ao vivo ----------

test("não está na base: busca no IBGE ao vivo, com o ano da série mais recente", async () => {
  const { db } = fakeDb({ data: [], error: null });
  const { fetchImpl } = fakeIbge();
  const m = await getMunicipioIBGE("Fortaleza", "CE", { db, fetchImpl });
  assert.equal(m.origem, "ibge_ao_vivo");
  assert.equal(m.population, 2582360);
  assert.equal(m.populationYear, 2026);
  assert.equal(m.gdpYear, 2023);
});

test("sem banco: vai direto ao IBGE ao vivo", async () => {
  const m = await getMunicipioIBGE("Fortaleza", "CE", { db: null, fetchImpl: fakeIbge().fetchImpl });
  assert.equal(m.origem, "ibge_ao_vivo");
});

test("erro de leitura do banco: tenta o IBGE ao vivo", async () => {
  const { db } = fakeDb({ data: null, error: { message: "permission denied" } });
  const m = await getMunicipioIBGE("Fortaleza", "CE", { db, fetchImpl: fakeIbge().fetchImpl });
  assert.equal(m.origem, "ibge_ao_vivo");
});

test("banco fora e IBGE fora: a mensagem diz os dois motivos", async () => {
  const { db } = fakeDb(new Error("fetch failed"));
  const { fetchImpl } = fakeIbge([["/municipios", () => json({}, 503)]]);
  await rejeita(
    getMunicipioIBGE("Fortaleza", "CE", { db, fetchImpl }),
    /Fortaleza\/CE não foi lido da base de municípios \(fetch failed\), e o IBGE ao vivo falhou — lista de municípios: HTTP 503 \(2 tentativas\)/
  );
});

// ---------- nova tentativa ----------

test("IBGE: primeira tentativa sem resposta, segunda responde — entrega", async () => {
  let n = 0;
  const { db } = fakeDb({ data: [], error: null });
  const { fetchImpl, chamadas } = fakeIbge([
    [
      "/municipios",
      () => {
        if (++n === 1) throw new Error("IBGE não respondeu em 8 s");
        return json([{ id: 2304400, nome: "Fortaleza" }]);
      },
    ],
  ]);
  const m = await getMunicipioIBGE("Fortaleza", "CE", { db, fetchImpl });
  assert.equal(m.population, 2582360);
  assert.equal(chamadas.filter((u) => u.includes("/municipios")).length, 2);
});

test("IBGE: as duas tentativas sem resposta — bloqueia dizendo que tentou duas vezes", async () => {
  const { db } = fakeDb({ data: [], error: null });
  const { fetchImpl, chamadas } = fakeIbge([
    ["/municipios", () => { throw new Error("IBGE não respondeu em 8 s"); }],
  ]);
  await rejeita(
    getMunicipioIBGE("Fortaleza", "CE", { db, fetchImpl }),
    /Fortaleza\/CE não está na base de municípios, e o IBGE ao vivo falhou — lista de municípios: IBGE não respondeu em 8 s \(2 tentativas\)/
  );
  assert.equal(chamadas.length, 2);
});

test("IBGE: HTTP 404 não repete (a resposta seria a mesma)", async () => {
  const { fetchImpl, chamadas } = fakeIbge([["/municipios", () => json({}, 404)]]);
  await rejeita(getMunicipioIBGE("Fortaleza", "XX", { db: null, fetchImpl }), /lista de municípios: HTTP 404$/);
  assert.equal(chamadas.length, 1);
});

test("IBGE: PIB com 500 na primeira e ok na segunda — entrega", async () => {
  let n = 0;
  const { fetchImpl } = fakeIbge([
    ["/5938/", () => (++n === 1 ? json({}, 500) : json(serie({ "2023": "86939832" })))],
  ]);
  const m = await getMunicipioIBGE("Fortaleza", "CE", { db: null, fetchImpl });
  assert.equal(m.gdpYear, 2023);
});

// ---------- IBGE ao vivo: dado que falta é erro ----------

test("IBGE: município fora da lista bloqueia", async () => {
  await rejeita(
    getMunicipioIBGE("Fortalesa", "CE", { db: null, fetchImpl: fakeIbge().fetchImpl }),
    /município "Fortalesa" não está na lista do IBGE para CE/
  );
});

test("IBGE: série de população vazia bloqueia", async () => {
  const { fetchImpl } = fakeIbge([["/6579/", () => json([])]]);
  await rejeita(getMunicipioIBGE("Fortaleza", "CE", { db: null, fetchImpl }), /série de população veio vazia/);
});

test("IBGE: série de PIB vazia bloqueia", async () => {
  const { fetchImpl } = fakeIbge([["/5938/", () => json([])]]);
  await rejeita(getMunicipioIBGE("Fortaleza", "CE", { db: null, fetchImpl }), /série de PIB veio vazia/);
});

test("último valor da série: pega o ano mais recente; zero ou vazio não vira número", () => {
  assert.deepEqual(ultimoValor(serie({ "2025": "10", "2026": "12" })), { valor: 12, ano: 2026 });
  assert.equal(ultimoValor(serie({ "2026": "0" })), null);
  assert.equal(ultimoValor(serie({ "2026": "..." })), null);
  assert.equal(ultimoValor([]), null);
});
