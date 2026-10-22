/**
 * Concorrentes do Score: eletropostos a até 2 km do ponto.
 *
 * Mesma busca do Mapa de Calor (Places API New, subdividida enquanto uma célula
 * voltar no teto), mesma validação (tipo, fechados, repetidos) e o mesmo tipo
 * DC/AC, pela potência informada pelo Google — nunca pelo nome. Até 22/10/2026
 * era uma busca única com teto de 20: os cinco pontos medidos (Aldeota, Itaim,
 * Morumbi, Batel, Centro de Florianópolis) bateram no teto, e 58 de 100
 * resultados ficavam fora da conta de DC por não terem "rápido" no nome.
 *
 * Regra do dono (22/10/2026): concorrente sem potência informada conta como DC
 * no cálculo e aparece separado no relatório. Mostrar menos concorrência do que
 * existe é o erro mais caro do Score.
 */

import { specByKey } from "../heatmap/config";
import { circleBounds } from "../heatmap/geo";
import { searchSpecInArea, type FetchFn } from "../heatmap/places";
import { runPipeline } from "../heatmap/pipeline";
import { checkCompleteness } from "../heatmap/qa-gate";
import type { ChargerType, ScopeArea, StudyScope } from "../heatmap/types";
import { ScoreDataError } from "./errors";

export const RAIO_CONCORRENTES_M = 2000;
const FAIXAS_M = [200, 500, 1000, 2000] as const;
type Faixa = (typeof FAIXAS_M)[number];

export interface ConcorrenteScore {
  name: string;
  address: string;
  lat: number;
  lng: number;
  distance_m: number;
  charger_type: ChargerType;
  /** Potência máxima informada pelo Google; null = não informada. */
  powerKw: number | null;
}

export interface ConcorrentesScore {
  /** Todos os eletropostos a até 2 km, do mais perto ao mais longe. */
  lista: ConcorrenteScore[];
  /** Concorrência DC por faixa: DC + potência não informada. */
  dc: Record<Faixa, number>;
  /** Quantos dos `dc` de cada faixa são potência não informada. */
  semPotencia: Record<Faixa, number>;
  /** Rótulos dos que entram em `dc`, por faixa, com o tipo no fim. */
  nomes: Record<Faixa, string[]>;
  /** Consultas à Places API (New) — cobradas como Enterprise + Atmosphere. */
  requests: number;
}

/** Entra na concorrência DC: DC de verdade ou potência não informada. */
export const contaComoDC = (c: Pick<ConcorrenteScore, "charger_type">) => c.charger_type !== "AC";

export function rotuloConcorrente(c: ConcorrenteScore): string {
  const name = c.name.trim() || "Sem nome";
  const addr = c.address.trim();
  const tipo = c.powerKw === null ? "potência não informada" : `${c.charger_type} ${c.powerKw} kW`;
  return `${addr ? `${name} - ${addr}` : name} (${tipo})`;
}

export async function buscarConcorrentes(
  lat: number,
  lng: number,
  local: { city: string; state: string },
  deps: { apiKey: string; fetchImpl?: FetchFn }
): Promise<ConcorrentesScore> {
  if (!deps.apiKey) throw new ScoreDataError("concorrentes", "GOOGLE_MAPS_API_KEY ausente");
  const spec = specByKey("electric_vehicle_charging_station");
  if (!spec) throw new Error("spec de eletroposto ausente no config do Mapa de Calor");

  const center = { lat, lng };
  const area: ScopeArea = {
    requestedName: "ponto",
    resolvedName: "2 km do ponto",
    center,
    radiusM: RAIO_CONCORRENTES_M,
    rawRadiusM: null,
    radiusSource: "fallback",
    radiusClamp: null,
    boundsCoveragePct: null,
    geocodeTypes: [],
  };
  const busca = await searchSpecInArea(spec, area, deps);

  const falhas = busca.summaries.filter((s) => s.error !== null);
  if (falhas.length > 0) {
    throw new ScoreDataError(
      "concorrentes",
      `busca no Google Places falhou — ${falhas.map((s) => `${s.method} "${s.query}": ${s.error}`).join("; ")}`
    );
  }
  const noTeto = checkCompleteness(busca.summaries).violations;
  if (noTeto.length > 0) {
    throw new ScoreDataError("concorrentes", noTeto.map((v) => v.detail).join("; "));
  }

  const scope: StudyScope = {
    mode: "bairro",
    city: local.city,
    state: local.state,
    label: `2 km do ponto · ${local.city}/${local.state}`,
    areas: [area],
    bounds: circleBounds(center, RAIO_CONCORRENTES_M),
    key: `score:${lat},${lng}`,
  };
  const { competitors } = runPipeline(
    scope,
    busca.places.map((place) => ({ layer: spec.layer, typeKey: spec.key, place }))
  );

  const lista: ConcorrenteScore[] = competitors.map((c) => ({
    name: c.name,
    address: c.address,
    lat: c.lat,
    lng: c.lng,
    distance_m: c.distanceToCenterM,
    charger_type: c.charger_type,
    powerKw: c.chargerMaxKw,
  }));

  const porFaixa = <T>(f: (dentro: ConcorrenteScore[]) => T) =>
    Object.fromEntries(FAIXAS_M.map((m) => [m, f(lista.filter((c) => c.distance_m <= m && contaComoDC(c)))])) as Record<Faixa, T>;

  return {
    lista,
    dc: porFaixa((l) => l.length),
    semPotencia: porFaixa((l) => l.filter((c) => c.charger_type === "unknown").length),
    nomes: porFaixa((l) => l.map(rotuloConcorrente)),
    requests: busca.requests,
  };
}
