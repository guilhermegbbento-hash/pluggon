/** Construtores de dados SINTÉTICOS para os testes offline. Nenhuma resposta real do Google. */

import { scopeBoundsFor } from "../geo";
import type { Candidate, CandidatePlace, LatLng, LayerKey, ScopeArea, ScopeMode, StudyScope } from "../types";

export const CENTER: LatLng = { lat: -23.5978856, lng: -46.7201808 };

const M_PER_DEG = (6371000 * Math.PI) / 180;

/** Desloca um ponto `northM` metros ao norte e `eastM` metros a leste. */
export function offset(from: LatLng, northM: number, eastM: number): LatLng {
  return {
    lat: from.lat + northM / M_PER_DEG,
    lng: from.lng + eastM / (M_PER_DEG * Math.cos((from.lat * Math.PI) / 180)),
  };
}

export function makeScope(
  opts: { center?: LatLng; radiusM?: number; mode?: ScopeMode; areas?: ScopeArea[] } = {}
): StudyScope {
  const mode = opts.mode ?? "bairro";
  const areas: ScopeArea[] = opts.areas ?? [
    {
      requestedName: "Bairro Teste",
      resolvedName: "Bairro Teste",
      center: opts.center ?? CENTER,
      radiusM: opts.radiusM ?? 1760,
      rawRadiusM: opts.radiusM ?? 1760,
      radiusSource: "bounds",
      radiusClamp: null,
      boundsCoveragePct: 100,
      geocodeTypes: ["sublocality_level_1"],
    },
  ];
  return {
    mode,
    city: "Cidade Teste",
    state: "SP",
    label: mode === "cidade" ? "Cidade Teste/SP" : `${areas.map((a) => a.resolvedName).join(", ")} · Cidade Teste/SP`,
    areas,
    bounds: scopeBoundsFor(areas),
    key: "teste",
  };
}

export function place(
  placeId: string,
  name: string,
  at: LatLng,
  extra: Partial<CandidatePlace> = {}
): CandidatePlace {
  return {
    placeId,
    name,
    lat: at.lat,
    lng: at.lng,
    address: `${name}, endereço sintético`,
    types: [],
    primaryType: null,
    businessStatus: "OPERATIONAL",
    userRatingCount: 50,
    hasWebsite: false,
    hasPhone: false,
    hasOpeningHours: false,
    chargerMaxKw: null,
    chargerKwSource: null,
    source: "google_places",
    ...extra,
  };
}

export function cand(layer: LayerKey, typeKey: string, p: CandidatePlace): Candidate {
  return { layer, typeKey, place: p };
}
