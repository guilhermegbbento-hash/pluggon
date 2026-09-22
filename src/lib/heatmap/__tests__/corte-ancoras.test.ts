import { test } from "node:test";
import assert from "node:assert/strict";
import { generateHeatmap } from "../generate";
import { runQaGate } from "../qa-gate";
import type { GeocodeResponse } from "../scope";
import { CENTER, offset } from "./helpers";

/**
 * Regressão de 22/09/2026: com o corte por régua/renda, o pipeline final
 * atribuía complementares às âncoras VALIDADAS e o corte acontecia depois,
 * deixando complementar apontando para âncora fora do mapa. O QA gate pegou
 * (referencia_inexistente) em 4 dos 5 casos ao vivo — mas nenhum teste offline
 * cobria isso, porque o único caso onde ninguém era cortado passava.
 */

const geocodeFake = (): GeocodeResponse => ({
  status: "OK",
  results: [
    {
      types: ["sublocality_level_1", "sublocality", "political"],
      address_components: [
        { long_name: "Bairro Teste", short_name: "Bairro Teste", types: ["sublocality_level_1", "political"] },
        { long_name: "Cidade Teste", short_name: "Cidade Teste", types: ["administrative_area_level_2", "political"] },
        { long_name: "Estado Teste", short_name: "SP", types: ["administrative_area_level_1", "political"] },
      ],
      geometry: {
        location: CENTER,
        bounds: { northeast: offset(CENTER, 900, 900), southwest: offset(CENTER, -900, -900) },
      },
    },
  ],
});

const cidadeFake = (): GeocodeResponse => ({
  status: "OK",
  results: [
    {
      types: ["locality", "political"],
      address_components: [
        { long_name: "Cidade Teste", short_name: "Cidade Teste", types: ["administrative_area_level_2", "political"] },
        { long_name: "Estado Teste", short_name: "SP", types: ["administrative_area_level_1", "political"] },
      ],
      geometry: {
        location: CENTER,
        bounds: { northeast: offset(CENTER, 9000, 9000), southwest: offset(CENTER, -9000, -9000) },
      },
    },
  ],
});

const lugar = (id: string, nome: string, tipo: string, at: { lat: number; lng: number }, avaliacoes: number) => ({
  id,
  displayName: { text: nome },
  formattedAddress: `${nome}, endereço sintético`,
  location: { latitude: at.lat, longitude: at.lng },
  types: [tipo],
  primaryType: tipo,
  businessStatus: "OPERATIONAL",
  userRatingCount: avaliacoes,
});

/** Posto forte perto do centro; posto fraco 800 m a leste, cada um com um complementar ao lado. */
const POSTO_FORTE = offset(CENTER, 0, 0);
const POSTO_FRACO = offset(CENTER, 0, 800);

function fetchFake(): typeof fetch {
  return (async (url: string, init?: { body?: string }) => {
    const corpo = JSON.parse(String(init?.body ?? "{}"));
    const endpoint = String(url);
    if (endpoint.includes("searchText")) {
      const tipo = corpo.includedType;
      if (tipo !== "gas_station") return { ok: true, json: async () => ({ places: [] }) } as unknown as Response;
      return {
        ok: true,
        json: async () => ({
          places: [
            lugar("forte", "Posto Movimentado", "gas_station", POSTO_FORTE, 800),
            lugar("fraco", "Posto Vazio", "gas_station", POSTO_FRACO, 4),
          ],
        }),
      } as unknown as Response;
    }
    // searchNearby: complementares em volta da âncora consultada.
    const centro = corpo.locationRestriction?.circle?.center;
    const perto = Math.abs(centro.latitude - POSTO_FRACO.lat) < 1e-6 && Math.abs(centro.longitude - POSTO_FRACO.lng) < 1e-6;
    return {
      ok: true,
      json: async () => ({
        places: [
          perto
            ? lugar("cp-fraco", "Padaria do Posto Vazio", "bakery", offset(POSTO_FRACO, 30, 0), 20)
            : lugar("cp-forte", "Padaria Movimentada", "bakery", offset(POSTO_FORTE, 30, 0), 20),
        ],
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

test("âncora cortada pela régua não deixa complementar órfão (QA gate limpo)", async () => {
  const payload = await generateHeatmap(
    { city: "Cidade Teste", state: "SP", regions: ["Bairro Teste"] },
    {
      googleApiKey: "k",
      fetchImpl: fetchFake(),
      geocode: async (address) => (address.startsWith("Bairro") ? geocodeFake() : cidadeFake()),
      // Sem renda: "sem dado" não penaliza, o corte é só pela régua.
    }
  );

  const nomes = payload.anchors.map((a) => a.name);
  // O posto de 4 avaliações PASSA no piso de porte (≥3) e cai na RÉGUA (nota
  // 6,0): são dois cortes diferentes, em etapas diferentes.
  assert.deepEqual(nomes, ["Posto Movimentado"], "o posto de 4 avaliações tem que cair pela régua");
  assert.equal(payload.counters.anchorsFound, 2, "encontradas = válidas ANTES do corte da régua");
  assert.equal(payload.counters.anchors, 1, "mostradas = depois do corte");
  const cortadas = payload.discards.filter((d) => d.reason === "ancora_abaixo_do_corte");
  assert.equal(cortadas.length, 1, "a âncora cortada vira descarte com motivo");
  assert.equal(cortadas[0].name, "Posto Vazio");

  // O complementar que pertencia à âncora cortada NÃO pode ficar no mapa
  // apontando para ela.
  for (const cp of payload.complementary) {
    assert.ok(
      payload.anchors.some((a) => a.placeId === cp.nearAnchorPlaceId),
      `complementar "${cp.name}" aponta para âncora que não está no mapa`
    );
  }

  const qa = runQaGate(payload);
  assert.deepEqual(
    qa.violations.filter((v) => v.rule === "referencia_inexistente"),
    [],
    "nenhuma referência a âncora ausente"
  );
  assert.equal(qa.passed, true);
});

/**
 * Segundo defeito da mesma família, achado na revisão offline de 22/09/2026 e
 * que nenhuma checagem pegaria: com o corte aplicado FORA do pipeline, os
 * candidatos reprovados não eram reprocessados e os descartes de âncora —
 * porte, duplicata, tipo — sumiam do relatório de execução. O relatório
 * continuaria bonito, mentindo por omissão.
 */
test("descarte de âncora não some do relatório quando há corte", async () => {
  const comClinica = (async (url: string, init?: { body?: string }) => {
    const corpo = JSON.parse(String(init?.body ?? "{}"));
    if (String(url).includes("searchText")) {
      if (corpo.includedType === "gas_station") {
        return {
          ok: true,
          json: async () => ({
            places: [
              lugar("forte", "Posto Movimentado", "gas_station", POSTO_FORTE, 800),
              lugar("fraco", "Posto Vazio", "gas_station", POSTO_FRACO, 4),
            ],
          }),
        } as unknown as Response;
      }
      if (corpo.includedType === "hospital") {
        // 30 avaliações: cai no piso de porte do hospital (200).
        return {
          ok: true,
          json: async () => ({ places: [lugar("clinica", "Clínica Pequena", "hospital", offset(CENTER, 100, 0), 30)] }),
        } as unknown as Response;
      }
      return { ok: true, json: async () => ({ places: [] }) } as unknown as Response;
    }
    return { ok: true, json: async () => ({ places: [] }) } as unknown as Response;
  }) as unknown as typeof fetch;

  const payload = await generateHeatmap(
    { city: "Cidade Teste", state: "SP", regions: ["Bairro Teste"] },
    {
      googleApiKey: "k",
      fetchImpl: comClinica,
      geocode: async (address) => (address.startsWith("Bairro") ? geocodeFake() : cidadeFake()),
    }
  );

  const motivos = payload.discards.filter((d) => d.layer === "anchor").map((d) => d.reason);
  assert.ok(
    motivos.includes("hospital_sem_porte"),
    `a clínica de 30 avaliações tem que aparecer como descarte; motivos: ${JSON.stringify(motivos)}`
  );
  assert.ok(motivos.includes("ancora_abaixo_do_corte"), "e o posto fraco também, com o motivo do corte");
  assert.equal(payload.anchors.length, 1, "só o posto movimentado vai ao mapa");
});
