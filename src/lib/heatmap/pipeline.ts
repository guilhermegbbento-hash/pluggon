/**
 * Pipeline puro: candidatos brutos → arrays que vão para o mapa.
 *
 * Ordem: validação (raio, tipo, sinal de terminal, status, nome) → dedupe dentro
 * da camada → exclusividade entre camadas → seleção de complementares →
 * métricas das âncoras. Todo ponto que não chega ao mapa vira um Discard com motivo.
 */

import {
  COMPLEMENTARY_SELECTION,
  DEDUPE_RULES,
  INFLUENCE_RULES,
  PLACE_TYPE_SPECS,
  specByKey,
  type FacilitySignalRule,
  type PlaceTypeSpec,
} from "./config";
import { chargerTypeFor } from "./competitors";
import { haversineM, matchArea, nameContained, nameSimilarity } from "./geo";
import { notaAncora } from "./ranking";
import type {
  AnchorOut,
  Candidate,
  CandidatePlace,
  ComplementaryOut,
  CompetitorOut,
  Discard,
  DiscardReason,
  LayerKey,
  RendaFaixa,
  ScopeCounters,
  StudyScope,
  ValidatedBy,
} from "./types";

interface Accepted {
  layer: LayerKey;
  spec: PlaceTypeSpec;
  place: CandidatePlace;
  areaName: string;
  distanceToCenterM: number;
  validatedBy: ValidatedBy;
  order: number;
}

export const LAYER_LABELS: Record<LayerKey, string> = {
  anchor: "âncoras",
  complementary: "complementares",
  competitor: "concorrentes",
};

const fmtM = (m: number) => `${Math.round(m)} m`;

function discardOf(
  layer: LayerKey,
  typeKey: string,
  place: CandidatePlace,
  distanceToCenterM: number,
  reason: DiscardReason,
  detail?: string
): Discard {
  return {
    layer,
    typeKey,
    placeId: place.placeId,
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    distanceToCenterM: Math.round(distanceToCenterM),
    reason,
    ...(detail ? { detail } : {}),
  };
}

export function hasFacilitySignal(place: CandidatePlace, rule: FacilitySignalRule): boolean {
  if (place.userRatingCount >= rule.minUserRatingCount) return true;
  return rule.operatorFields.some((f) =>
    f === "website" ? place.hasWebsite : f === "phone" ? place.hasPhone : place.hasOpeningHours
  );
}

/** Duplicata por proximidade: distância dentro do limite E nome similar. Nunca distância pura. */
export function proximityDuplicate(
  a: { spec: PlaceTypeSpec; place: CandidatePlace },
  b: { spec: PlaceTypeSpec; place: CandidatePlace }
): { distanceM: number; similarity: number } | null {
  const limit =
    a.spec.largeFootprint && b.spec.largeFootprint
      ? DEDUPE_RULES.largeFootprintDistanceM
      : DEDUPE_RULES.distanceM;
  const distanceM = haversineM(a.place, b.place);
  if (distanceM > limit) return null;
  const similarity = nameSimilarity(a.place.name, b.place.name);
  return similarity >= DEDUPE_RULES.nameSimilarityThreshold ? { distanceM, similarity } : null;
}

export function influenceInnerRadiusM(complementaryNear: number, competitorsNear: number): number {
  const r = INFLUENCE_RULES;
  const bonus = Math.min(r.maxComplementaryBonusM, complementaryNear * r.perComplementaryM);
  const penalty = Math.min(r.maxCompetitorPenaltyM, competitorsNear * r.perCompetitorM);
  return Math.min(r.maxInnerM, Math.max(r.minInnerM, r.baseInnerM + bonus - penalty));
}

export function computeCounters(
  anchors: AnchorOut[],
  complementary: ComplementaryOut[],
  competitors: CompetitorOut[],
  /** Âncoras válidas antes do corte da régua. Omitido = ninguém cortou. */
  anchorsFound?: number
): ScopeCounters {
  const anchorsByType: Record<string, number> = {};
  for (const a of anchors) anchorsByType[a.type] = (anchorsByType[a.type] ?? 0) + 1;
  return {
    anchors: anchors.length,
    // Sem corte aplicado, encontradas e mostradas são a mesma coisa; quem corta
    // (generate.ts, depois da renda) recalcula os contadores informando o total.
    anchorsFound: anchorsFound ?? anchors.length,
    anchorsByType,
    complementary: complementary.length,
    competitors: competitors.length,
    competitorsDC: competitors.filter((c) => c.charger_type === "DC").length,
    competitorsAC: competitors.filter((c) => c.charger_type === "AC").length,
    competitorsUnknown: competitors.filter((c) => c.charger_type === "unknown").length,
  };
}

function validate(scope: StudyScope, candidates: Candidate[], discards: Discard[]): Accepted[] {
  const accepted: Accepted[] = [];
  candidates.forEach((c, order) => {
    const spec = specByKey(c.typeKey);
    if (!spec || spec.layer !== c.layer) {
      throw new Error(`Spec inexistente para ${c.layer}/${c.typeKey}`);
    }
    const p = c.place;
    const m = matchArea(p, scope.areas);
    const reject = (reason: DiscardReason, detail?: string) =>
      discards.push(discardOf(c.layer, c.typeKey, p, m.distanceM, reason, detail));

    if (!m.inside) {
      return reject(
        "fora_do_raio",
        `${fmtM(m.distanceM)} do centro de ${m.area.resolvedName} (raio ${fmtM(m.area.radiusM)})`
      );
    }

    let validatedBy: ValidatedBy;
    if (p.source === "openchargemap") {
      if (spec.layer !== "competitor") return reject("tipo_invalido", "OpenChargeMap só valida eletroposto");
      validatedBy = "openchargemap_source";
    } else {
      if (!spec.validTypes.some((t) => p.types.includes(t))) {
        return reject("tipo_invalido", `esperado ${spec.validTypes.join("|")}; types=[${p.types.join(", ")}]`);
      }
      if (spec.requirePrimaryType && !(p.primaryType && spec.validTypes.includes(p.primaryType))) {
        return reject("tipo_principal_divergente", `primaryType=${p.primaryType ?? "ausente"}; esperado ${spec.validTypes.join("|")}`);
      }
      validatedBy = "google_types";
    }

    if (spec.facilitySignal && !hasFacilitySignal(p, spec.facilitySignal)) {
      const fields = spec.facilitySignal.operatorFields.length > 0 ? ", sem site, telefone ou horário" : "";
      return reject(
        spec.facilitySignal.discardReason,
        `${p.userRatingCount} avaliações (mínimo ${spec.facilitySignal.minUserRatingCount})${fields}`
      );
    }
    if (p.businessStatus === "CLOSED_PERMANENTLY") return reject("fechado_permanentemente");
    if (!p.name.trim()) return reject("sem_nome");

    accepted.push({
      layer: c.layer,
      spec,
      place: p,
      areaName: m.area.resolvedName,
      distanceToCenterM: Math.round(m.distanceM),
      validatedBy,
      order,
    });
  });
  return accepted;
}

/** O registro mais proeminente (mais avaliações) representa o lugar. */
const byProminence = (a: Accepted, b: Accepted) =>
  b.place.userRatingCount - a.place.userRatingCount || a.order - b.order;

function dedupeWithinLayer(list: Accepted[], discards: Discard[]): Accepted[] {
  const kept: Accepted[] = [];
  for (const a of [...list].sort(byProminence)) {
    const reject = (reason: DiscardReason, detail: string) =>
      discards.push(discardOf(a.layer, a.spec.key, a.place, a.distanceToCenterM, reason, detail));

    const sameId = kept.find((k) => k.place.placeId === a.place.placeId);
    if (sameId) {
      reject("duplicata_place_id", `mesmo place_id de "${sameId.place.name}" (${sameId.spec.key})`);
      continue;
    }
    let near: { k: Accepted; distanceM: number; similarity: number } | null = null;
    for (const k of kept) {
      const d = proximityDuplicate(a, k);
      if (d) {
        near = { k, ...d };
        break;
      }
    }
    if (near) {
      reject(
        "duplicata_proximidade_nome",
        `${fmtM(near.distanceM)} e similaridade ${near.similarity.toFixed(2)} com "${near.k.place.name}"`
      );
      continue;
    }
    const contained = kept.find(
      (k) =>
        haversineM(a.place, k.place) <= DEDUPE_RULES.containmentDistanceM &&
        nameContained(a.place.name, k.place.name)
    );
    if (contained) {
      reject(
        "duplicata_nome_contido",
        `${fmtM(haversineM(a.place, contained.place))} de "${contained.place.name}", nome contido`
      );
      continue;
    }
    kept.push(a);
  }
  return kept;
}

function enforceLayerExclusivity(byLayer: Record<LayerKey, Accepted[]>, discards: Discard[]): void {
  const higher: Accepted[] = [];
  for (const layer of DEDUPE_RULES.layerPriority) {
    const kept: Accepted[] = [];
    for (const a of byLayer[layer]) {
      const clash =
        higher.find((h) => h.place.placeId === a.place.placeId) ??
        higher.find((h) => proximityDuplicate(a, h) !== null);
      if (clash) {
        discards.push(
          discardOf(
            a.layer,
            a.spec.key,
            a.place,
            a.distanceToCenterM,
            "duplicata_entre_camadas",
            `já está em ${LAYER_LABELS[clash.layer]} como "${clash.place.name}"`
          )
        );
        continue;
      }
      kept.push(a);
    }
    byLayer[layer] = kept;
    higher.push(...kept);
  }
}

const baseOut = (a: Accepted) => ({
  placeId: a.place.placeId,
  name: a.place.name,
  lat: a.place.lat,
  // userRatingCount vem da API e era jogado fora aqui: é o sinal de movimento
  // que a régua usa para separar posto com fila de posto vazio.
  userRatingCount: a.place.userRatingCount,
  lng: a.place.lng,
  address: a.place.address,
  type: a.spec.key,
  typeLabel: a.spec.label,
  areaName: a.areaName,
  distanceToCenterM: a.distanceToCenterM,
  validatedBy: a.validatedBy,
});

export interface PipelineResult {
  anchors: AnchorOut[];
  complementary: ComplementaryOut[];
  competitors: CompetitorOut[];
  counters: ScopeCounters;
  discards: Discard[];
}

export function runPipeline(scope: StudyScope, candidates: Candidate[]): PipelineResult {
  const discards: Discard[] = [];
  const accepted = validate(scope, candidates, discards);

  const byLayer: Record<LayerKey, Accepted[]> = {
    anchor: dedupeWithinLayer(accepted.filter((a) => a.layer === "anchor"), discards),
    complementary: dedupeWithinLayer(accepted.filter((a) => a.layer === "complementary"), discards),
    competitor: dedupeWithinLayer(accepted.filter((a) => a.layer === "competitor"), discards),
  };
  enforceLayerExclusivity(byLayer, discards);

  // Complementares: até maxPerAnchor mais próximos de cada âncora, sem repetição.
  const selected = new Map<string, { cp: Accepted; anchor: Accepted; distanceM: number }>();
  for (const anchor of byLayer.anchor) {
    const near = byLayer.complementary
      .filter((cp) => !selected.has(cp.place.placeId))
      .map((cp) => ({ cp, distanceM: haversineM(anchor.place, cp.place) }))
      .filter((x) => x.distanceM <= COMPLEMENTARY_SELECTION.maxDistanceToAnchorM)
      .sort((x, y) => x.distanceM - y.distanceM)
      .slice(0, COMPLEMENTARY_SELECTION.maxPerAnchor);
    for (const x of near) selected.set(x.cp.place.placeId, { cp: x.cp, anchor, distanceM: x.distanceM });
  }
  for (const cp of byLayer.complementary) {
    if (selected.has(cp.place.placeId)) continue;
    const nearest = byLayer.anchor.reduce(
      (min, a) => Math.min(min, haversineM(a.place, cp.place)),
      Infinity
    );
    const withinReach = nearest <= COMPLEMENTARY_SELECTION.maxDistanceToAnchorM;
    discards.push(
      discardOf(
        "complementary",
        cp.spec.key,
        cp.place,
        cp.distanceToCenterM,
        withinReach ? "complementar_excedente_por_ancora" : "complementar_sem_ancora_proxima",
        Number.isFinite(nearest) ? `âncora mais próxima a ${fmtM(nearest)}` : "nenhuma âncora no escopo"
      )
    );
  }

  const competitors: CompetitorOut[] = byLayer.competitor
    .map((a) => ({
      ...baseOut(a),
      charger_type: chargerTypeFor(a.place.chargerMaxKw),
      chargerMaxKw: a.place.chargerMaxKw,
      chargerTypeSource: a.place.chargerKwSource,
      source: a.place.source,
    }))
    .sort((x, y) => x.distanceToCenterM - y.distanceToCenterM);

  const complementary: ComplementaryOut[] = [...selected.values()]
    .map(({ cp, anchor, distanceM }) => ({
      ...baseOut(cp),
      nearAnchorPlaceId: anchor.place.placeId,
      nearAnchor: anchor.place.name,
      nearAnchorDist: Math.round(distanceM),
    }))
    .sort((x, y) => x.nearAnchor.localeCompare(y.nearAnchor) || x.nearAnchorDist - y.nearAnchorDist);

  const specOrder = (key: string) => PLACE_TYPE_SPECS.findIndex((s) => s.key === key);
  const anchors: AnchorOut[] = byLayer.anchor
    .map((a) => {
      const complementaryWithin300m = complementary.filter(
        (cp) => haversineM(a.place, cp) <= INFLUENCE_RULES.complementaryRadiusM
      ).length;
      const competitorsWithin1km = competitors.filter(
        (c) => haversineM(a.place, c) <= INFLUENCE_RULES.competitorRadiusM
      ).length;
      return {
        ...baseOut(a),
        complementaryWithin300m,
        competitorsWithin1km,
        influenceInnerRadiusM: influenceInnerRadiusM(complementaryWithin300m, competitorsWithin1km),
        // A nota já sai calculada aqui (depende só do lugar). A renda chega
        // depois, em generate.ts, porque vem do banco: até lá, "sem dado",
        // que por decisão do produto não penaliza.
        rankScore: notaAncora(a.spec.key, a.place.userRatingCount),
        rendaFaixa: "sem dado" as RendaFaixa,
        rendaMediana: null,
      };
    })
    .sort((x, y) => specOrder(x.type) - specOrder(y.type) || x.distanceToCenterM - y.distanceToCenterM);

  return {
    anchors,
    complementary,
    competitors,
    counters: computeCounters(anchors, complementary, competitors),
    discards,
  };
}
