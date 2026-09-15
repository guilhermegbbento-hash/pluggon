/**
 * Formatação compartilhada entre a tela do Mapa de Calor e o HTML exportado.
 * Arquivo leve de propósito: a tela importa daqui sem puxar o Leaflet embutido
 * de report-html.ts (que só carrega no clique de exportar).
 */

import type { HeatmapPayload, ScopeArea, StudyScope } from "./types";

export const escapeHtml = (s: string | number | null | undefined) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const fmtKm = (m: number) =>
  `${(m / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km`;

export const fmtInt = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("pt-BR");

export function formatGeneratedAt(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function radiusLabel(a: ScopeArea): string {
  const coverage = a.boundsCoveragePct === null ? "desconhecida" : `${a.boundsCoveragePct}%`;
  return `raio ${fmtKm(a.radiusM)} (${a.radiusSource}${a.radiusClamp ? `, ${a.radiusClamp}` : ""}; cobertura ${coverage})`;
}

/** Aviso de topo quando o raio bateu no teto: parte da área pedida ficou de fora. */
export function radiusCapWarnings(scope: StudyScope): string[] {
  return scope.areas
    .filter((a) => a.radiusClamp === "teto")
    .map((a) => {
      const coverage = a.boundsCoveragePct === null ? "" : ` (cobertura estimada: ${a.boundsCoveragePct}%)`;
      return scope.mode === "cidade"
        ? `Raio limitado a ${fmtKm(a.radiusM)} — parte do município está fora deste estudo${coverage}.`
        : `Raio limitado a ${fmtKm(a.radiusM)} — parte do bairro ${a.resolvedName} está fora deste estudo${coverage}. Considere gerar no modo cidade.`;
    });
}

/** Carimbo de rastreabilidade: versão, escopo resolvido, raio, origem do raio, cobertura e data. */
export function reportStamp(p: Pick<HeatmapPayload, "generatorVersion" | "generatedAt" | "scope">): string {
  const { scope } = p;
  const areas = scope.areas
    .map((a) =>
      scope.mode === "cidade"
        ? `${scope.city} · ${scope.state} · ${radiusLabel(a)}`
        : `${a.resolvedName} · ${scope.city} · ${scope.state} · ${radiusLabel(a)}`
    )
    .join(" | ");
  return `Gerador v${p.generatorVersion} · Escopo: ${areas} · Gerado em ${formatGeneratedAt(p.generatedAt)}`;
}

export function heatmapFileName(scope: StudyScope): string {
  const parts = [scope.city, scope.state, ...(scope.mode === "bairro" ? scope.areas.map((a) => a.resolvedName) : [])];
  return `Mapa_Calor_PLUGGON_${parts.join("_").replace(/[\\/:*?"<>|\s]+/g, "_")}.html`;
}
