/**
 * QA gate: roda ANTES de gerar o HTML (e antes de devolver/cachear o payload).
 * Recalcula tudo a partir dos arrays que vão ser renderizados — não confia em
 * nenhum número que o pipeline declarou.
 */

import { COMPLEMENTARY_SELECTION, SCOPE_RULES, specByKey } from "./config";
import { haversineM, matchArea, scopeBoundsFor } from "./geo";
import { computeCounters, influenceInnerRadiusM, LAYER_LABELS } from "./pipeline";
import { INFLUENCE_RULES } from "./config";
import type {
  AnchorOut,
  ComplementaryOut,
  CompetitorOut,
  DiscardReason,
  HeatmapPayload,
  LayerKey,
  QaReport,
  QaViolation,
} from "./types";

export class QaGateError extends Error {
  constructor(public readonly report: QaReport) {
    super(
      `QA gate reprovou o relatório (${report.violations.length} violação(ões)):\n` +
        report.violations.slice(0, 20).map((v) => `- [${v.rule}] ${v.detail}`).join("\n")
    );
    this.name = "QaGateError";
  }
}

const DIST_TOLERANCE_M = 1;

export function runQaGate(p: Omit<HeatmapPayload, "qa"> & { qa?: QaReport | null }): QaReport {
  const violations: QaViolation[] = [];
  const v = (rule: QaViolation["rule"], detail: string) => violations.push({ rule, detail });
  const { scope } = p;

  // Escopo e enquadramento
  const expectedBounds = scopeBoundsFor(scope.areas);
  for (const k of ["south", "west", "north", "east"] as const) {
    if (Math.abs(expectedBounds[k] - scope.bounds[k]) > 1e-9) {
      v("enquadramento_divergente", `scope.bounds.${k} não corresponde aos círculos de estudo`);
    }
  }
  const rule = SCOPE_RULES[scope.mode];
  for (const a of scope.areas) {
    if (a.radiusM < rule.minRadiusM || a.radiusM > rule.maxRadiusM) {
      v("enquadramento_divergente", `raio de ${a.resolvedName} (${a.radiusM} m) fora de ${rule.minRadiusM}–${rule.maxRadiusM} m`);
    }
    // No modo bairro o raio cobre o bairro inteiro por construção: menos que
    // 100% do retângulo do geocoding é defeito, não escolha.
    if (scope.mode === "bairro" && a.boundsCoveragePct !== null && a.boundsCoveragePct < 100) {
      v(
        "cobertura_incompleta",
        `${a.resolvedName}: o raio de ${a.radiusM} m cobre ${a.boundsCoveragePct}% do limite devolvido pelo geocoding (tem que ser 100%)`
      );
    }
  }

  // Completude: camada obrigatória não pode ter célula no teto da API
  for (const s of p.searches) {
    if (s.truncated && specByKey(s.typeKey)?.completeness === "obrigatoria") {
      v(
        "camada_incompleta",
        `${LAYER_LABELS[s.layer]}: ${s.method} "${s.query}" em ${s.areaName} continuou no teto da API em ` +
          `${s.cappedCells} célula(s) após subdividir até a profundidade ${s.maxDepth}`
      );
    }
  }

  // Pontos: raio, tipo, place_id
  const layers: [LayerKey, (AnchorOut | ComplementaryOut | CompetitorOut)[]][] = [
    ["anchor", p.anchors],
    ["complementary", p.complementary],
    ["competitor", p.competitors],
  ];
  const seenIds = new Map<string, string>();
  const maxDistance: Record<LayerKey, number> = { anchor: 0, complementary: 0, competitor: 0 };

  for (const [layer, points] of layers) {
    for (const pt of points) {
      const where = `${LAYER_LABELS[layer]}: "${pt.name}" (${pt.placeId})`;
      const m = matchArea(pt, scope.areas);
      maxDistance[layer] = Math.max(maxDistance[layer], m.distanceM);
      if (m.distanceM > m.area.radiusM + DIST_TOLERANCE_M) {
        v("ponto_fora_do_raio", `${where} a ${Math.round(m.distanceM)} m; raio ${m.area.radiusM} m`);
      }
      if (Math.abs(m.distanceM - pt.distanceToCenterM) > DIST_TOLERANCE_M + 1) {
        v("contador_divergente", `${where} declara ${pt.distanceToCenterM} m, real ${Math.round(m.distanceM)} m`);
      }

      const spec = specByKey(pt.type);
      if (!spec || spec.layer !== layer) {
        v("tipo_nao_validado", `${where} com tipo "${pt.type}" não pertence à camada`);
      } else if (
        !(pt.validatedBy === "google_types" || (pt.validatedBy === "openchargemap_source" && layer === "competitor"))
      ) {
        v("tipo_nao_validado", `${where} sem validação de tipo (${String(pt.validatedBy)})`);
      }

      const prev = seenIds.get(pt.placeId);
      if (prev) v("place_id_duplicado", `${where} repete place_id já presente em ${prev}`);
      else seenIds.set(pt.placeId, LAYER_LABELS[layer]);
    }
  }

  // Contadores x arrays renderizados
  const expected = computeCounters(p.anchors, p.complementary, p.competitors);
  const c = p.counters;
  const numeric: (keyof typeof expected)[] = [
    "anchors",
    "complementary",
    "competitors",
    "competitorsDC",
    "competitorsAC",
    "competitorsUnknown",
  ];
  for (const key of numeric) {
    if (c[key] !== expected[key]) v("contador_divergente", `counters.${key}=${String(c[key])}, array=${String(expected[key])}`);
  }
  const typeKeys = new Set([...Object.keys(expected.anchorsByType), ...Object.keys(c.anchorsByType)]);
  for (const t of typeKeys) {
    if ((c.anchorsByType[t] ?? 0) !== (expected.anchorsByType[t] ?? 0)) {
      v("contador_divergente", `counters.anchorsByType.${t}=${c.anchorsByType[t] ?? 0}, array=${expected.anchorsByType[t] ?? 0}`);
    }
  }
  if (c.competitorsDC + c.competitorsAC + c.competitorsUnknown !== c.competitors) {
    v("contador_divergente", "DC + AC + não informado ≠ total de concorrentes");
  }

  // Métricas das âncoras recalculadas dos arrays renderizados
  for (const a of p.anchors) {
    const nComp = p.complementary.filter((cp) => haversineM(a, cp) <= INFLUENCE_RULES.complementaryRadiusM).length;
    const nCompet = p.competitors.filter((cm) => haversineM(a, cm) <= INFLUENCE_RULES.competitorRadiusM).length;
    if (a.complementaryWithin300m !== nComp) {
      v("contador_divergente", `âncora "${a.name}": complementaryWithin300m=${a.complementaryWithin300m}, real=${nComp}`);
    }
    if (a.competitorsWithin1km !== nCompet) {
      v("contador_divergente", `âncora "${a.name}": competitorsWithin1km=${a.competitorsWithin1km}, real=${nCompet}`);
    }
    if (a.influenceInnerRadiusM !== influenceInnerRadiusM(nComp, nCompet)) {
      v("contador_divergente", `âncora "${a.name}": raio de influência não corresponde aos vizinhos renderizados`);
    }
  }

  const anchorIds = new Map(p.anchors.map((a) => [a.placeId, a]));
  for (const cp of p.complementary) {
    const anchor = anchorIds.get(cp.nearAnchorPlaceId);
    if (!anchor) {
      v("referencia_inexistente", `complementar "${cp.name}" aponta para âncora ausente do mapa`);
    } else if (Math.abs(haversineM(anchor, cp) - cp.nearAnchorDist) > DIST_TOLERANCE_M + 1) {
      v("contador_divergente", `complementar "${cp.name}": nearAnchorDist não corresponde`);
    }
  }

  // Relatório de descartes
  const discardsByReason: Partial<Record<DiscardReason, number>> = {};
  const discardsByLayer: QaReport["discardsByLayer"] = { anchor: {}, complementary: {}, competitor: {} };
  for (const d of p.discards) {
    discardsByReason[d.reason] = (discardsByReason[d.reason] ?? 0) + 1;
    discardsByLayer[d.layer][d.reason] = (discardsByLayer[d.layer][d.reason] ?? 0) + 1;
  }

  return {
    passed: violations.length === 0,
    checkedAt: new Date().toISOString(),
    violations,
    rendered: {
      anchors: p.anchors.length,
      complementary: p.complementary.length,
      competitors: p.competitors.length,
    },
    discardsByReason,
    discardsByLayer,
    maxDistanceM: {
      anchors: Math.round(maxDistance.anchor),
      complementary: Math.round(maxDistance.complementary),
      competitors: Math.round(maxDistance.competitor),
    },
  };
}

export function assertQaGate(p: Omit<HeatmapPayload, "qa"> & { qa?: QaReport | null }): QaReport {
  const report = runQaGate(p);
  if (!report.passed) throw new QaGateError(report);
  return report;
}

export const DISCARD_REASON_LABELS: Record<DiscardReason, string> = {
  fora_do_raio: "fora do raio",
  tipo_invalido: "tipo inválido",
  tipo_principal_divergente: "tipo principal divergente",
  ponto_de_onibus_sem_sinal_de_terminal: "ponto de ônibus sem sinal de terminal",
  aeroporto_sem_porte: "aeroporto sem porte",
  hospital_sem_porte: "hospital sem porte (clínica ou consultório)",
  fechado_permanentemente: "fechado permanentemente",
  sem_nome: "sem nome",
  duplicata_place_id: "duplicata (place_id)",
  duplicata_proximidade_nome: "duplicata (proximidade + nome)",
  duplicata_nome_contido: "duplicata (nome contido a ≤ 50 m)",
  duplicata_entre_camadas: "duplicata entre camadas",
  complementar_sem_ancora_proxima: "complementar sem âncora próxima",
  complementar_excedente_por_ancora: "complementar excedente por âncora",
};

export function formatQaReport(r: QaReport): string {
  const lines = [
    `QA gate: ${r.passed ? "APROVADO" : "REPROVADO"}`,
    `Renderizados: ${r.rendered.anchors} âncoras · ${r.rendered.complementary} complementares · ${r.rendered.competitors} concorrentes`,
    `Distância máx. ao centro: âncoras ${r.maxDistanceM.anchors} m · complementares ${r.maxDistanceM.complementary} m · concorrentes ${r.maxDistanceM.competitors} m`,
    "Descartes por motivo:",
    ...Object.entries(r.discardsByReason).map(
      ([k, n]) => `  - ${DISCARD_REASON_LABELS[k as DiscardReason]}: ${n}`
    ),
    `Complementares sem âncora a ≤ ${COMPLEMENTARY_SELECTION.maxDistanceToAnchorM} m: ` +
      `${r.discardsByReason.complementar_sem_ancora_proxima ?? 0} (possível fluxo em área sem âncora mapeada)`,
  ];
  if (r.violations.length > 0) {
    lines.push("Violações:", ...r.violations.map((x) => `  - [${x.rule}] ${x.detail}`));
  }
  return lines.join("\n");
}
