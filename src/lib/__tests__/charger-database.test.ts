import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cityHasFreshChargers,
  populateChargersFromGoogle,
  populateChargersLocal,
} from "../charger-database";
import { ScoreDataError } from "../score/errors";

/**
 * Até 22/10/2026 toda falha aqui era engolida: erro do banco na gravação,
 * chave negada ou cota estourada no Google (que vêm com HTTP 200), rede fora.
 * O resultado era o Score com menos concorrentes do que existem, sem aviso.
 */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const place = (name: string, lat: number, lng: number) => ({ name, vicinity: `${name}, rua`, geometry: { location: { lat, lng } } });

/** Banco falso: guarda cada upsert; `falha` faz o upsert devolver erro. */
function fakeDb(opts: { falha?: string; count?: number | null; erroLeitura?: string } = {}) {
  const upserts: Array<Array<Record<string, unknown>>> = [];
  const db = {
    from: (table: string) => {
      assert.equal(table, "ev_chargers");
      return {
        upsert: async (rows: Array<Record<string, unknown>>) => {
          upserts.push(rows);
          return { error: opts.falha ? { message: opts.falha } : null };
        },
        select: () => ({
          ilike: () => ({
            gte: async () => ({
              count: opts.count ?? null,
              error: opts.erroLeitura ? { message: opts.erroLeitura } : null,
            }),
          }),
        }),
      };
    },
  };
  return { db: db as never, upserts };
}

/** Google falso: uma resposta por chamada, na ordem. */
function fakeGoogle(respostas: Array<() => Response>) {
  const urls: string[] = [];
  const f = async (url: string) => {
    urls.push(url);
    const r = respostas[Math.min(urls.length - 1, respostas.length - 1)];
    return r();
  };
  return { f, urls };
}

async function bloqueia(p: Promise<unknown>, pattern: RegExp, status: 500 | 502 = 502) {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof ScoreDataError, `esperava ScoreDataError, veio ${String(err)}`);
    assert.equal(err.layer, "concorrentes");
    assert.equal(err.status, status);
    assert.match(err.message, pattern);
    return true;
  });
}

// ---------- busca local (2 km) ----------

test("2 km: grava todos os carregadores num único upsert, sem coordenada repetida", async () => {
  const { db, upserts } = fakeDb();
  const g = fakeGoogle([
    () => json({ status: "OK", results: [place("Zletric Shopping", -3.73, -38.5), place("Eletroposto A", -3.74, -38.51), place("Eletroposto A", -3.74, -38.51)] }),
  ]);
  assert.equal(await populateChargersLocal("fortaleza", "CE", -3.73, -38.5, db, "k", g.f), 1);
  assert.equal(upserts.length, 1);
  assert.deepEqual(upserts[0].map((r) => r.name), ["Zletric Shopping", "Eletroposto A"]);
  assert.equal(upserts[0][0].city, "Fortaleza");
  assert.equal(upserts[0][0].source, "google_places_local");
});

test("2 km: falha na gravação bloqueia em vez de sumir com os concorrentes", async () => {
  const { db } = fakeDb({ falha: "permission denied for table ev_chargers" });
  const g = fakeGoogle([() => json({ status: "OK", results: [place("A", -3.73, -38.5)] })]);
  await bloqueia(
    populateChargersLocal("Fortaleza", "CE", -3.73, -38.5, db, "k", g.f),
    /gravação de 1 carregadores \(Google, 2 km\) falhou \(permission denied for table ev_chargers\)/,
    500
  );
});

test("2 km: REQUEST_DENIED (HTTP 200) bloqueia com o motivo do Google", async () => {
  const { db, upserts } = fakeDb();
  const g = fakeGoogle([() => json({ status: "REQUEST_DENIED", error_message: "This API key is not authorized" })]);
  await bloqueia(
    populateChargersLocal("Fortaleza", "CE", -3.73, -38.5, db, "k", g.f),
    /busca no Google \(2 km do ponto\) recusada \(REQUEST_DENIED — This API key is not authorized\)/
  );
  assert.equal(upserts.length, 0);
});

test("2 km: OVER_QUERY_LIMIT bloqueia", async () => {
  const { db } = fakeDb();
  const g = fakeGoogle([() => json({ status: "OVER_QUERY_LIMIT" })]);
  await bloqueia(populateChargersLocal("Fortaleza", "CE", -3.73, -38.5, db, "k", g.f), /OVER_QUERY_LIMIT/);
});

test("2 km: HTTP 500 bloqueia", async () => {
  const { db } = fakeDb();
  const g = fakeGoogle([() => json({}, 500)]);
  await bloqueia(populateChargersLocal("Fortaleza", "CE", -3.73, -38.5, db, "k", g.f), /falhou \(HTTP 500\)/);
});

test("2 km: falha de rede bloqueia", async () => {
  const { db } = fakeDb();
  const g = fakeGoogle([() => { throw new Error("ECONNRESET"); }]);
  await bloqueia(populateChargersLocal("Fortaleza", "CE", -3.73, -38.5, db, "k", g.f), /ECONNRESET/);
});

test("2 km: sem chave do Google bloqueia sem chamar ninguém", async () => {
  const { db } = fakeDb();
  const g = fakeGoogle([() => json({ status: "OK", results: [] })]);
  await bloqueia(populateChargersLocal("Fortaleza", "CE", -3.73, -38.5, db, "", g.f), /GOOGLE_MAPS_API_KEY ausente/);
  assert.equal(g.urls.length, 0);
});

test("2 km: ZERO_RESULTS é zero de verdade e passa", async () => {
  const { db, upserts } = fakeDb();
  const g = fakeGoogle([() => json({ status: "ZERO_RESULTS", results: [] })]);
  assert.equal(await populateChargersLocal("Fortaleza", "CE", -3.73, -38.5, db, "k", g.f), 1);
  assert.equal(upserts.length, 0);
});

// ---------- varredura da cidade (50 km) ----------

test("cidade: cinco buscas, repetidos entre buscas viram um, um único upsert", async () => {
  const { db, upserts } = fakeDb();
  const g = fakeGoogle([
    () => json({ status: "OK", results: [place("A", -3.7, -38.5), place("B", -3.71, -38.5)] }),
    () => json({ status: "OK", results: [place("A", -3.7, -38.5), place("C", -3.72, -38.5)] }),
    () => json({ status: "ZERO_RESULTS", results: [] }),
  ]);
  assert.equal(await populateChargersFromGoogle("Fortaleza", "CE", -3.7, -38.5, db, "k", g.f), 5);
  assert.equal(g.urls.length, 5);
  assert.equal(upserts.length, 1);
  assert.deepEqual(upserts[0].map((r) => r.name), ["A", "B", "C"]);
});

test("cidade: uma das cinco buscas recusada bloqueia e não grava pela metade", async () => {
  const { db, upserts } = fakeDb();
  const g = fakeGoogle([
    () => json({ status: "OK", results: [place("A", -3.7, -38.5)] }),
    () => json({ status: "OK", results: [place("B", -3.71, -38.5)] }),
    () => json({ status: "OVER_QUERY_LIMIT", error_message: "You have exceeded your daily request quota" }),
  ]);
  await bloqueia(
    populateChargersFromGoogle("Fortaleza", "CE", -3.7, -38.5, db, "k", g.f),
    /"ev charging station" em Fortaleza\) recusada \(OVER_QUERY_LIMIT — You have exceeded/
  );
  assert.equal(upserts.length, 0);
});

// ---------- dados frescos ----------

test("frescos: erro de leitura bloqueia em vez de disparar nova varredura calada", async () => {
  const { db } = fakeDb({ erroLeitura: "connection refused" });
  await bloqueia(cityHasFreshChargers("Fortaleza", db), /leitura de ev_chargers falhou \(connection refused\)/, 500);
});

test("frescos: conta > 0 é cidade com dados; 0 é cidade sem", async () => {
  assert.equal(await cityHasFreshChargers("Fortaleza", fakeDb({ count: 12 }).db), true);
  assert.equal(await cityHasFreshChargers("Fortaleza", fakeDb({ count: 0 }).db), false);
});
