/**
 * HTML exportável do Mapa de Calor. Função pura (roda no browser e no script
 * de regressão). O QA gate roda ANTES de montar o HTML: payload reprovado não
 * vira relatório.
 */

import { DARK_TILES, TILE_ATTRIBUTION } from "../basemap";
import {
  COMPETITOR_OVERLAP_PX,
  COMPETITOR_ZONE_RADIUS_M,
  INFLUENCE_RULES,
  PLACE_TYPE_SPECS,
  specByKey,
  specsForLayer,
} from "./config";
import { assertQaGate } from "./qa-gate";
import type { HeatmapPayload, ScopeArea, StudyScope } from "./types";

const escapeHtml = (s: string | number | null | undefined) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** JSON seguro dentro de <script>. */
const json = (x: unknown) => JSON.stringify(x).replace(/</g, "\\u003c");

export const fmtKm = (m: number) =>
  `${(m / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km`;

const fmtInt = (n: number | null | undefined) =>
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

export function renderHeatmapHtml(payload: HeatmapPayload, opts: { tileUrl?: string } = {}): string {
  assertQaGate(payload);

  const { scope, counters, municipal } = payload;
  const radiusText = scope.areas.map((a) => fmtKm(a.radiusM)).join(" / ");
  // Camadas obrigatórias no teto nem chegam aqui (o gate aborta); só as de apoio podem aparecer.
  const truncated = payload.searches.filter(
    (s) => s.truncated && specByKey(s.typeKey)?.completeness !== "obrigatoria"
  );
  const capWarnings = radiusCapWarnings(scope);
  const unavailable = payload.sources.filter((s) => s.status !== "ok");
  const anchorEmoji = Object.fromEntries(specsForLayer("anchor").map((s) => [s.key, s.emoji]));
  const typeOrder = PLACE_TYPE_SPECS.map((s) => s.key);
  const stamp = reportStamp(payload);

  const competitorSummary =
    counters.competitors === 0
      ? `<div class="notice opportunity"><strong>0 concorrentes no raio de ${escapeHtml(radiusText)}</strong><br>Pra&ccedil;a sem concorr&ecirc;ncia mapeada &mdash; oportunidade a validar em campo.</div>`
      : "";

  const truncatedNotice =
    truncated.length > 0
      ? `<div class="notice warn">Camadas de apoio no limite de resultados da API (${escapeHtml(
          [...new Set(truncated.map((s) => s.typeKey))].join(", ")
        )}): podem estar incompletas. A camada de concorrentes é sempre buscada até completar.</div>`
      : "";

  const municipalGrid = municipal
    ? `<div class="block-title">Indicadores municipais &mdash; ${escapeHtml(municipal.city)}/${escapeHtml(municipal.state)}</div>
    <div class="stats-grid">
      <div class="stat-card"><div class="label">Pop. munic&iacute;pio</div><div class="value">${fmtInt(municipal.population)}</div></div>
      <div class="stat-card"><div class="label">PIB/cap munic.</div><div class="value">${municipal.gdpPerCapita ? "R$ " + Math.round(municipal.gdpPerCapita / 1000) + "k" : "—"}</div></div>
      <div class="stat-card"><div class="label">EVs munic.</div><div class="value">${fmtInt(municipal.bevPlusPHEV)}</div></div>
      <div class="stat-card"><div class="label">DC munic.</div><div class="value">${municipal.dcChargers > 0 ? fmtInt(municipal.dcChargers) : "sem dados"}</div></div>
      <div class="stat-card"><div class="label">EV/DC munic.</div><div class="value">${municipal.ratioEVperDC || "—"}</div></div>
    </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="pluggon-generator-version" content="${escapeHtml(payload.generatorVersion)}">
<meta name="pluggon-scope-key" content="${escapeHtml(scope.key)}">
<title>PLUGGON — Mapa de Calor — ${escapeHtml(scope.label)}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0D1117; color: #C9D1D9; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
  .header { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; background: #161B22; border-bottom: 1px solid #30363D; }
  .header h1 { font-size: 18px; color: #C9A84C; font-weight: 700; }
  .header h1 span { color: #E6EDF3; font-weight: 600; font-size: 15px; margin-left: 8px; }
  .header-right { font-size: 12px; color: #8B949E; text-align: right; }
  .main { display: flex; flex: 1; overflow: hidden; }
  .sidebar { width: 30%; min-width: 300px; max-width: 440px; display: flex; flex-direction: column; background: #161B22; border-left: 1px solid #30363D; overflow-y: auto; order: 2; }
  .sidebar > * { flex-shrink: 0; }
  .map-container { flex: 1; position: relative; order: 1; }
  #map { width: 100%; height: 100%; background: #0D1117; }
  .block-title { padding: 8px 12px 0; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; color: #8B949E; }
  .block-title.gold { color: #C9A84C; }
  .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 8px 10px 10px; border-bottom: 1px solid #30363D; }
  .stat-card { background: #0D1117; border: 1px solid #30363D; border-radius: 6px; padding: 6px; text-align: center; }
  .stat-card .label { font-size: 9px; color: #8B949E; text-transform: uppercase; }
  .stat-card .value { font-size: 14px; font-weight: 700; margin-top: 2px; color: #E6EDF3; }
  .notice { margin: 8px 10px; padding: 8px 10px; border-radius: 6px; font-size: 11px; line-height: 1.4; }
  .notice.opportunity { background: #66BB6A1A; border: 1px solid #66BB6A; color: #A5D6A7; }
  .notice.warn { background: #FFC1071A; border: 1px solid #FFC107; color: #FFE082; }
  .section-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
  .section-head.gold { color: #C9A84C; border-bottom: 1px solid #30363D; }
  .section-head.toggle { cursor: pointer; user-select: none; border-top: 1px solid #30363D; }
  .section-head.toggle:hover { color: #fff; }
  .section-head.red { color: #F44336; }
  .section-head.gray { color: #8B949E; }
  .group-head { background: #0D1117; padding: 6px 12px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #C9A84C; }
  .group-head.muted { color: #8B949E; }
  .item { display: block; width: 100%; text-align: left; padding: 8px 12px; border: none; background: transparent; color: inherit; cursor: pointer; border-bottom: 1px solid #30363D; transition: background 0.15s; }
  .item:hover { background: #21262D; }
  .item-name { font-size: 12px; font-weight: 600; color: #E6EDF3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-sub { font-size: 10px; color: #8B949E; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-row { display: flex; align-items: center; gap: 6px; }
  .badge { padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700; white-space: nowrap; }
  .badge.dc { background: #FF980030; color: #FF9800; }
  .badge.ac { background: #42A5F530; color: #42A5F5; }
  .badge.unk { background: #21262D; color: #8B949E; }
  .collapse-body { max-height: 260px; overflow-y: auto; border-top: 1px solid #30363D; display: none; }
  .collapse-body.open { display: block; }
  .empty { padding: 12px; text-align: center; font-size: 11px; color: #8B949E; }
  .sources { padding: 8px 12px; font-size: 10px; color: #8B949E; border-top: 1px solid #30363D; line-height: 1.5; }
  .sources .bad { color: #FFC107; }
  .legend { position: absolute; bottom: 12px; right: 12px; background: rgba(22,27,34,0.95); border: 1px solid #30363D; border-radius: 8px; padding: 10px 12px; font-size: 11px; backdrop-filter: blur(6px); z-index: 400; }
  .legend-title { font-weight: 700; color: #fff; margin-bottom: 6px; }
  .legend-row { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; border: 2px solid #0D1117; }
  .legend-zone { width: 12px; height: 12px; border-radius: 50%; }
  .legend-scope { width: 12px; height: 12px; border-radius: 50%; border: 2px dashed #C9A84C; }
  .scope-warning { padding: 10px 20px; background: #FFC10726; border-bottom: 1px solid #FFC107; color: #FFE082; font-size: 13px; font-weight: 600; }
  .footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 8px 20px; background: #161B22; border-top: 1px solid #30363D; font-size: 11px; color: #8B949E; }
  .footer .stamp { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10px; color: #C9D1D9; text-align: right; }
  .leaflet-popup-content-wrapper { background: #161B22; color: #C9D1D9; border: 1px solid #30363D; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
  .leaflet-popup-tip { background: #161B22; border: 1px solid #30363D; }
  .leaflet-popup-content { margin: 10px 12px; font-size: 12px; line-height: 1.5; }
  .cmp-dot { width: 12px; height: 12px; border-radius: 50%; background: #F44336; border: 2px solid #0D1117; }
  .cmp-dot.cmp-group { width: 18px; height: 18px; color: #fff; font-size: 10px; font-weight: 700; line-height: 14px; text-align: center; }
  @media print {
    body { height: auto; overflow: visible; }
    .main { height: 70vh; }
    .footer { position: fixed; bottom: 0; left: 0; right: 0; }
  }
</style>
</head>
<body>
<div class="header">
  <h1>PLUGGON by BLEV Educa&ccedil;&atilde;o<span>Mapa de Calor &mdash; ${escapeHtml(scope.label)}</span></h1>
  <div class="header-right">Raio de estudo: ${escapeHtml(radiusText)}${scope.mode === "bairro" ? "" : " (munic&iacute;pio)"}</div>
</div>
${capWarnings.map((w) => `<div class="scope-warning">&#9888; ${escapeHtml(w)}</div>`).join("\n")}
<div class="main">
  <div class="map-container">
    <div id="map"></div>
    <div class="legend">
      <div class="legend-title">Legenda</div>
      <div class="legend-row"><span class="legend-scope"></span> &Aacute;rea de estudo (raio ${escapeHtml(radiusText)})</div>
      <div class="legend-row"><span class="legend-dot" style="background:#C9A84C;box-shadow:0 0 4px #C9A84C;"></span> Ponto &Acirc;ncora</div>
      <div class="legend-row"><span class="legend-dot" style="background:#fff;width:6px;height:6px;border:1px solid #0D1117;"></span> Ponto Potencial</div>
      <div class="legend-row"><span class="legend-dot" style="background:#F44336;"></span> Concorrente existente (n&uacute;mero = v&aacute;rios no mesmo ponto)</div>
      <div class="legend-row" style="margin-top:8px;"><span class="legend-zone" style="background:#C9A84C;opacity:0.45;"></span> Zona de influ&ecirc;ncia (maior com complementares, menor com concorrentes)</div>
      <div class="legend-row"><span class="legend-zone" style="background:#FF4444;opacity:0.4;"></span> Zona do concorrente</div>
    </div>
  </div>
  <div class="sidebar">
    <div class="block-title gold">No escopo &mdash; raio de ${escapeHtml(radiusText)}</div>
    <div class="stats-grid">
      <div class="stat-card"><div class="label">&Acirc;ncoras</div><div class="value" id="cntAnchors">${counters.anchors}</div></div>
      <div class="stat-card"><div class="label">Potenciais</div><div class="value" id="cntComplementary">${counters.complementary}</div></div>
      <div class="stat-card"><div class="label">Concorrentes</div><div class="value" id="cntCompetitors">${counters.competitors}</div></div>
      <div class="stat-card"><div class="label">DC no raio</div><div class="value">${counters.competitorsDC}</div></div>
      <div class="stat-card"><div class="label">AC no raio</div><div class="value">${counters.competitorsAC}</div></div>
      <div class="stat-card"><div class="label">N&atilde;o informado</div><div class="value">${counters.competitorsUnknown}</div></div>
    </div>
    ${competitorSummary}
    ${truncatedNotice}
    ${municipalGrid}
    <div class="section-head gold">Pontos &Acirc;ncora (${counters.anchors})</div>
    <div id="anchorsList"></div>
    <div class="section-head toggle red" id="toggleCompetitors">
      <span>Concorrentes no raio (${counters.competitors})</span><span id="arrowCompetitors">&#9662;</span>
    </div>
    <div class="collapse-body" id="competitorsList"></div>
    <div class="section-head toggle gray" id="toggleComplementary">
      <span>Pontos Potenciais (${counters.complementary})</span><span id="arrowComplementary">&#9662;</span>
    </div>
    <div class="collapse-body" id="complementaryList"></div>
    <div class="sources">Fontes: ${payload.sources
      .map((s) => `<span class="${s.status === "ok" ? "" : "bad"}">${escapeHtml(s.name)}: ${escapeHtml(s.status === "ok" ? "ok" : s.status)}${s.status === "ok" ? "" : " — " + escapeHtml(s.detail)}</span>`)
      .join(" · ")}${unavailable.length === 0 ? "" : ""}</div>
  </div>
</div>
<div class="footer">
  <div>PLUGGON by BLEV Educa&ccedil;&atilde;o</div>
  <div class="stamp">${escapeHtml(stamp)}</div>
</div>
<script>
const scope = ${json(scope)};
const anchors = ${json(payload.anchors)};
const complementary = ${json(payload.complementary)};
const competitors = ${json(payload.competitors)};
const ANCHOR_EMOJI = ${json(anchorEmoji)};
const TYPE_ORDER = ${json(typeOrder)};
const OUTER_RINGS = ${json(INFLUENCE_RULES.outerRings)};
const INNER_OPACITY = ${INFLUENCE_RULES.innerOpacity};
const COMPETITOR_ZONE_M = ${COMPETITOR_ZONE_RADIUS_M};
const COMPETITOR_OVERLAP_PX = ${COMPETITOR_OVERLAP_PX};

const map = L.map('map');
L.tileLayer(${json(opts.tileUrl ?? DARK_TILES)}, { attribution: ${json(TILE_ATTRIBUTION)}, maxZoom: 19 }).addTo(map);

const escapeHtml = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const km = (m) => (m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' km';
const chargerBadge = (c) => c.charger_type === 'DC'
  ? '<span class="badge dc">DC' + (c.chargerMaxKw ? ' ' + c.chargerMaxKw + ' kW' : '') + '</span>'
  : c.charger_type === 'AC'
    ? '<span class="badge ac">AC' + (c.chargerMaxKw ? ' ' + c.chargerMaxKw + ' kW' : '') + '</span>'
    : '<span class="badge unk">n&atilde;o informado</span>';

// Área de estudo
scope.areas.forEach(a => {
  L.circle([a.center.lat, a.center.lng], { radius: a.radiusM, color: '#C9A84C', weight: 2, dashArray: '8 6', fill: false, interactive: false }).addTo(map);
});

competitors.forEach(c => {
  L.circle([c.lat, c.lng], { radius: COMPETITOR_ZONE_M, color: 'transparent', fillColor: '#FF4444', fillOpacity: 0.10, weight: 0, interactive: false }).addTo(map);
});

anchors.forEach(a => {
  OUTER_RINGS.forEach(r => L.circle([a.lat, a.lng], { radius: r.radiusM, color: 'transparent', fillColor: '#C9A84C', fillOpacity: r.opacity, weight: 0, interactive: false }).addTo(map));
  L.circle([a.lat, a.lng], { radius: a.influenceInnerRadiusM, color: 'transparent', fillColor: '#C9A84C', fillOpacity: INNER_OPACITY, weight: 0, interactive: false }).addTo(map);
});

anchors.forEach(a => {
  const icon = L.divIcon({ html: '<div style="width:14px;height:14px;border-radius:50%;background:#C9A84C;border:2px solid #0D1117;box-shadow:0 0 8px #C9A84C;"></div>', className: '', iconSize: [14,14], iconAnchor: [7,7] });
  L.marker([a.lat, a.lng], { icon, zIndexOffset: 1000 })
    .bindPopup('<div style="margin-bottom:6px;"><span style="background:#C9A84C30;color:#C9A84C;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">&Acirc;NCORA</span></div>' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + (ANCHOR_EMOJI[a.type] || '📍') + ' ' + escapeHtml(a.name) + '</div>' +
      '<div style="color:#8B949E;font-size:11px;margin-bottom:6px;">' + escapeHtml(a.address) + '</div>' +
      '<div style="font-size:11px;">' + escapeHtml(a.typeLabel) + ' &middot; ' + km(a.distanceToCenterM) + ' do centro</div>' +
      '<div style="font-size:11px;color:#8B949E;">' + a.complementaryWithin300m + ' complementares a 300 m &middot; ' + a.competitorsWithin1km + ' concorrentes a 1 km</div>')
    .addTo(map);
});

complementary.forEach(c => {
  const icon = L.divIcon({ html: '<div style="width:8px;height:8px;border-radius:50%;background:#fff;border:1px solid #0D1117;"></div>', className: '', iconSize: [8,8], iconAnchor: [4,4] });
  L.marker([c.lat, c.lng], { icon, zIndexOffset: 500 })
    .bindPopup('<div style="margin-bottom:6px;"><span style="background:#FFFFFF20;color:#fff;border:1px solid #FFFFFF40;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">POTENCIAL</span></div>' +
      '<div style="font-weight:700;font-size:12px;">' + escapeHtml(c.name) + '</div>' +
      '<div style="color:#8B949E;font-size:11px;margin-top:2px;">' + escapeHtml(c.address) + '</div>' +
      '<div style="margin-top:4px;font-size:11px;">' + escapeHtml(c.typeLabel) + '</div>' +
      '<div style="color:#8B949E;font-size:11px;margin-top:4px;">Pr&oacute;ximo a ' + escapeHtml(c.nearAnchor) + ' (' + c.nearAnchorDist + ' m)</div>')
    .addTo(map);
});

// Concorrentes: pontos sobrepostos no zoom atual viram um ponto com contador — nenhum some.
const competitorLayer = L.layerGroup().addTo(map);
const competitorPopup = (c) => '<div style="font-weight:700;font-size:12px;margin-bottom:4px;">' + escapeHtml(c.name) + '</div>' +
  '<div style="margin-bottom:4px;">' + chargerBadge(c) + '</div>' +
  '<div style="color:#8B949E;font-size:11px;">' + escapeHtml(c.address) + '</div>' +
  '<div style="font-size:11px;margin-top:4px;">' + km(c.distanceToCenterM) + ' do centro</div>';
function renderCompetitors() {
  competitorLayer.clearLayers();
  const clusters = [];
  competitors.forEach(c => {
    const pt = map.latLngToLayerPoint([c.lat, c.lng]);
    const hit = clusters.find(x => x.pt.distanceTo(pt) < COMPETITOR_OVERLAP_PX);
    if (hit) hit.items.push(c); else clusters.push({ pt, items: [c] });
  });
  clusters.forEach(({ items }) => {
    const n = items.length;
    const size = n === 1 ? 12 : 18;
    const icon = L.divIcon({ html: '<div class="cmp-dot' + (n > 1 ? ' cmp-group' : '') + '" data-count="' + n + '">' + (n > 1 ? n : '') + '</div>', className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    // Acima da âncora: eletroposto dentro de posto/shopping não pode sumir sob o ponto dourado.
    L.marker([items[0].lat, items[0].lng], { icon, zIndexOffset: 1500 })
      .bindPopup(items.map(competitorPopup).join('<hr style="border:none;border-top:1px solid #30363D;margin:6px 0;">'))
      .addTo(competitorLayer);
  });
}

const byType = {};
anchors.forEach(a => { (byType[a.type] = byType[a.type] || []).push(a); });
document.getElementById('anchorsList').innerHTML = anchors.length === 0
  ? '<div class="empty">Nenhuma &acirc;ncora no raio.</div>'
  : TYPE_ORDER.filter(t => byType[t]).map(t => {
      const items = byType[t];
      return '<div class="group-head">' + (ANCHOR_EMOJI[t] || '📍') + ' ' + escapeHtml(items[0].typeLabel) + ' (' + items.length + ')</div>' +
        items.map(a => '<button class="item" data-lat="' + a.lat + '" data-lng="' + a.lng + '" data-zoom="16">' +
          '<div class="item-name">' + escapeHtml(a.name) + '</div>' +
          '<div class="item-sub">' + km(a.distanceToCenterM) + ' do centro &middot; ' + escapeHtml(a.address) + '</div></button>').join('');
    }).join('');

document.getElementById('competitorsList').innerHTML = competitors.length === 0
  ? '<div class="empty">0 concorrentes no raio de ' + escapeHtml(${json(radiusText)}) + '.</div>'
  : competitors.map(c => '<button class="item" data-lat="' + c.lat + '" data-lng="' + c.lng + '" data-zoom="17">' +
      '<div class="item-row">' + chargerBadge(c) + '<span class="item-name" style="flex:1;">' + escapeHtml(c.name) + '</span></div>' +
      '<div class="item-sub">' + km(c.distanceToCenterM) + ' do centro &middot; ' + escapeHtml(c.address) + '</div></button>').join('');

const groups = {};
complementary.forEach(cp => { (groups[cp.nearAnchor] = groups[cp.nearAnchor] || []).push(cp); });
const groupNames = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
document.getElementById('complementaryList').innerHTML = groupNames.length === 0
  ? '<div class="empty">Nenhum ponto potencial pr&oacute;ximo a &acirc;ncoras.</div>'
  : groupNames.map(g => '<div class="group-head muted">Pr&oacute;ximos a ' + escapeHtml(g) + ' (' + groups[g].length + ')</div>' +
      groups[g].map(cp => '<button class="item" data-lat="' + cp.lat + '" data-lng="' + cp.lng + '" data-zoom="17">' +
        '<div class="item-name">' + escapeHtml(cp.name) + ' (' + cp.nearAnchorDist + ' m)</div>' +
        '<div class="item-sub">' + escapeHtml(cp.typeLabel) + '</div></button>').join('')).join('');

document.querySelectorAll('.item').forEach(el => {
  el.addEventListener('click', () => map.flyTo([parseFloat(el.dataset.lat), parseFloat(el.dataset.lng)], parseInt(el.dataset.zoom, 10), { duration: 0.8 }));
});

function setupToggle(headId, bodyId, arrowId) {
  document.getElementById(headId).addEventListener('click', () => {
    const open = document.getElementById(bodyId).classList.toggle('open');
    document.getElementById(arrowId).innerHTML = open ? '&#9652;' : '&#9662;';
  });
}
setupToggle('toggleCompetitors', 'competitorsList', 'arrowCompetitors');
setupToggle('toggleComplementary', 'complementaryList', 'arrowComplementary');

// Enquadra o ESCOPO pedido (centro + raio), nunca os pontos.
map.fitBounds([[scope.bounds.south, scope.bounds.west], [scope.bounds.north, scope.bounds.east]], { padding: [20, 20] });
renderCompetitors();
map.on('zoomend', renderCompetitors);
</script>
</body>
</html>`;
}
