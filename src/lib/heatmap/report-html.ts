/**
 * HTML exportável do Mapa de Calor. Função pura (roda no browser e no script
 * de regressão). O QA gate roda ANTES de montar o HTML: payload reprovado não
 * vira relatório.
 *
 * REGRA PERMANENTE (ver README): o arquivo é autocontido. Nenhum <script src>,
 * <link rel="stylesheet"> ou recurso externo bloqueante — o Leaflet vai
 * embutido. Os tiles são a única requisição de rede, e a falta deles degrada
 * com aviso. Listas e contadores saem prontos no HTML: o documento se sustenta
 * sem JavaScript e sem mapa; o mapa é uma camada visual por cima.
 */

import { exportDarkTiles, TILE_ATTRIBUTION } from "../basemap";
import {
  COMPETITOR_OVERLAP_PX,
  COMPETITOR_ZONE_RADIUS_M,
  INFLUENCE_RULES,
  PLACE_TYPE_SPECS,
  specByKey,
  specsForLayer,
} from "./config";
import { LEAFLET_CSS, LEAFLET_JS } from "./leaflet-vendor";
import { assertQaGate } from "./qa-gate";
import { escapeHtml, fmtInt, fmtKm, radiusCapWarnings, reportStamp } from "./report-format";
import type { AnchorOut, CompetitorOut, ComplementaryOut, HeatmapPayload } from "./types";

export {
  fmtKm,
  formatGeneratedAt,
  heatmapFileName,
  radiusCapWarnings,
  radiusLabel,
  reportStamp,
} from "./report-format";

/** Sem nenhum tile carregado nesse prazo, o aviso de base cartográfica aparece (cobre firewall pendurado). */
export const BASEMAP_WARNING_TIMEOUT_MS = 8000;

export const BASEMAP_WARNING_TEXT =
  "Base cartográfica não carregou (sem internet ou bloqueio de rede). Pontos, raios e contagens continuam válidos.";

export const MAP_FALLBACK_TEXT =
  "Mapa interativo indisponível neste navegador. Todas as contagens e listas ao lado continuam válidas.";

const APP_SCRIPT_ID = "pluggon-map";

/** JSON seguro dentro de <script>. */
const json = (x: unknown) => JSON.stringify(x).replace(/</g, "\\u003c");

/** Só o script do mapa do PLUGGON (sem o Leaflet embutido) — para testes e invariantes. */
export function appScriptOf(html: string): string {
  const m = html.match(new RegExp(`<script id="${APP_SCRIPT_ID}">([\\s\\S]*?)</script>`));
  return m ? m[1] : "";
}

const chargerBadge = (c: CompetitorOut) =>
  c.charger_type === "DC"
    ? `<span class="badge dc">DC${c.chargerMaxKw ? ` ${c.chargerMaxKw} kW` : ""}</span>`
    : c.charger_type === "AC"
      ? `<span class="badge ac">AC${c.chargerMaxKw ? ` ${c.chargerMaxKw} kW` : ""}</span>`
      : '<span class="badge unk">n&atilde;o informado</span>';

const itemAttrs = (p: { lat: number; lng: number }, zoom: number, layer: "anchor" | "competitor" | "complementary") =>
  `class="item" type="button" data-layer="${layer}" data-lat="${p.lat}" data-lng="${p.lng}" data-zoom="${zoom}"`;

function anchorsListHtml(anchors: AnchorOut[], emoji: Record<string, string>): string {
  if (anchors.length === 0) return '<div class="empty">Nenhuma &acirc;ncora no raio.</div>';
  return PLACE_TYPE_SPECS.map((s) => s.key)
    .map((t) => anchors.filter((a) => a.type === t))
    .filter((items) => items.length > 0)
    .map(
      (items) =>
        `<div class="group-head">${emoji[items[0].type] || "📍"} ${escapeHtml(items[0].typeLabel)} (${items.length})</div>` +
        items
          .map(
            (a) =>
              `<button ${itemAttrs(a, 16, "anchor")}><div class="item-name">${escapeHtml(a.name)}</div>` +
              `<div class="item-sub">${fmtKm(a.distanceToCenterM)} do centro &middot; ${escapeHtml(a.address)}</div></button>`
          )
          .join("")
    )
    .join("");
}

function competitorsListHtml(competitors: CompetitorOut[], radiusText: string): string {
  if (competitors.length === 0) return `<div class="empty">0 concorrentes no raio de ${escapeHtml(radiusText)}.</div>`;
  return competitors
    .map(
      (c) =>
        `<button ${itemAttrs(c, 17, "competitor")}><div class="item-row">${chargerBadge(c)}<span class="item-name" style="flex:1;">${escapeHtml(c.name)}</span></div>` +
        `<div class="item-sub">${fmtKm(c.distanceToCenterM)} do centro &middot; ${escapeHtml(c.address)}</div></button>`
    )
    .join("");
}

function complementaryListHtml(complementary: ComplementaryOut[]): string {
  const groups = new Map<string, ComplementaryOut[]>();
  for (const cp of complementary) {
    if (!groups.has(cp.nearAnchor)) groups.set(cp.nearAnchor, []);
    groups.get(cp.nearAnchor)!.push(cp);
  }
  if (groups.size === 0) return '<div class="empty">Nenhum ponto potencial pr&oacute;ximo a &acirc;ncoras.</div>';
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(
      ([name, items]) =>
        `<div class="group-head muted">Pr&oacute;ximos a ${escapeHtml(name)} (${items.length})</div>` +
        items
          .map(
            (cp) =>
              `<button ${itemAttrs(cp, 17, "complementary")}><div class="item-name">${escapeHtml(cp.name)} (${cp.nearAnchorDist} m)</div>` +
              `<div class="item-sub">${escapeHtml(cp.typeLabel)}</div></button>`
          )
          .join("")
    )
    .join("");
}

export function renderHeatmapHtml(payload: HeatmapPayload, opts: { tileUrl?: string } = {}): string {
  assertQaGate(payload);
  // Chave de exportação (nunca restrita). Sem ela, lança — não cai na chave do app.
  const tileUrl = opts.tileUrl ?? exportDarkTiles();

  const { scope, counters, municipal } = payload;
  const radiusText = scope.areas.map((a) => fmtKm(a.radiusM)).join(" / ");
  // Camadas obrigatórias no teto nem chegam aqui (o gate aborta); só as de apoio podem aparecer.
  const truncated = payload.searches.filter(
    (s) => s.truncated && specByKey(s.typeKey)?.completeness !== "obrigatoria"
  );
  const capWarnings = radiusCapWarnings(scope);
  const anchorEmoji = Object.fromEntries(specsForLayer("anchor").map((s) => [s.key, s.emoji]));
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
<style>${LEAFLET_CSS}</style>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0D1117; color: #C9D1D9; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
  .header { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; background: #161B22; border-bottom: 1px solid #30363D; }
  .header h1 { font-size: 18px; color: #C9A84C; font-weight: 700; }
  .header h1 span { color: #E6EDF3; font-weight: 600; font-size: 15px; margin-left: 8px; }
  .header-right { font-size: 12px; color: #8B949E; text-align: right; }
  .main { display: flex; flex: 1; overflow: hidden; }
  .sidebar { width: 30%; min-width: 300px; max-width: 440px; display: flex; flex-direction: column; background: #161B22; border-left: 1px solid #30363D; overflow-y: auto; order: 2; }
  .sidebar > * { flex-shrink: 0; }
  .map-container { flex: 1; position: relative; order: 1; display: flex; flex-direction: column; min-width: 0; background: #0D1117; }
  #map { flex: 1; min-height: 0; width: 100%; background: #0D1117; }
  .map-fallback { position: absolute; inset: 0; z-index: 1100; display: flex; align-items: center; justify-content: center; padding: 24px; background: #0D1117; }
  .map-fallback div { max-width: 420px; padding: 16px 20px; border: 1px solid #30363D; border-radius: 8px; background: #161B22; color: #E6EDF3; font-size: 14px; line-height: 1.5; text-align: center; }
  /* Faixa no topo do painel do mapa (não flutua por cima: não pode esconder ponto nenhum). */
  .basemap-warning { flex-shrink: 0; padding: 12px 18px; background: #FFC107; color: #0D1117; font-size: 15px; font-weight: 700; line-height: 1.4; text-align: center; border-bottom: 2px solid #E0A800; }
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
  .section-head.toggle { cursor: pointer; user-select: none; border-top: 1px solid #30363D; list-style: none; }
  .section-head.toggle::-webkit-details-marker { display: none; }
  .section-head.toggle:hover { color: #fff; }
  .section-head.toggle .arrow::after { content: "\\25BE"; }
  details[open] > .section-head.toggle .arrow::after { content: "\\25B4"; }
  .section-head.red { color: #F44336; }
  .section-head.gray { color: #8B949E; }
  .group-head { background: #0D1117; padding: 6px 12px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #C9A84C; }
  .group-head.muted { color: #8B949E; }
  .item { display: block; width: 100%; text-align: left; padding: 8px 12px; border: none; background: transparent; color: inherit; font: inherit; cursor: pointer; border-bottom: 1px solid #30363D; transition: background 0.15s; }
  .item:hover { background: #21262D; }
  .item-name { font-size: 12px; font-weight: 600; color: #E6EDF3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-sub { font-size: 10px; color: #8B949E; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-row { display: flex; align-items: center; gap: 6px; }
  .badge { padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700; white-space: nowrap; }
  .badge.dc { background: #FF980030; color: #FF9800; }
  .badge.ac { background: #42A5F530; color: #42A5F5; }
  .badge.unk { background: #21262D; color: #8B949E; }
  .collapse-body { max-height: 260px; overflow-y: auto; border-top: 1px solid #30363D; }
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
    <div class="basemap-warning" id="basemapWarning" role="status" hidden>&#9888; ${escapeHtml(BASEMAP_WARNING_TEXT)}</div>
    <div id="map"></div>
    <div class="map-fallback" id="mapFallback"><div>${escapeHtml(MAP_FALLBACK_TEXT)}</div></div>
    <div class="legend" id="legend" hidden>
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
      <div class="stat-card"><div class="label">N&atilde;o informado</div><div class="value" id="cntUnknown">${counters.competitorsUnknown}</div></div>
    </div>
    ${competitorSummary}
    ${truncatedNotice}
    ${municipalGrid}
    <div class="section-head gold">Pontos &Acirc;ncora (${counters.anchors})</div>
    <div id="anchorsList">${anchorsListHtml(payload.anchors, anchorEmoji)}</div>
    <details id="competitorsSection">
      <summary class="section-head toggle red" id="toggleCompetitors"><span>Concorrentes no raio (${counters.competitors})</span><span class="arrow"></span></summary>
      <div class="collapse-body" id="competitorsList">${competitorsListHtml(payload.competitors, radiusText)}</div>
    </details>
    <details id="complementarySection">
      <summary class="section-head toggle gray" id="toggleComplementary"><span>Pontos Potenciais (${counters.complementary})</span><span class="arrow"></span></summary>
      <div class="collapse-body" id="complementaryList">${complementaryListHtml(payload.complementary)}</div>
    </details>
    <div class="sources">Fontes: ${payload.sources
      .map((s) => `<span class="${s.status === "ok" ? "" : "bad"}">${escapeHtml(s.name)}: ${escapeHtml(s.status === "ok" ? "ok" : s.status)}${s.status === "ok" ? "" : " — " + escapeHtml(s.detail)}</span>`)
      .join(" · ")}</div>
  </div>
</div>
<div class="footer">
  <div>PLUGGON by BLEV Educa&ccedil;&atilde;o</div>
  <div class="stamp">${escapeHtml(stamp)}</div>
</div>
<script>${LEAFLET_JS}</script>
<script id="${APP_SCRIPT_ID}">
const scope = ${json(scope)};
const anchors = ${json(payload.anchors)};
const complementary = ${json(payload.complementary)};
const competitors = ${json(payload.competitors)};
const ANCHOR_EMOJI = ${json(anchorEmoji)};
const OUTER_RINGS = ${json(INFLUENCE_RULES.outerRings)};
const INNER_OPACITY = ${INFLUENCE_RULES.innerOpacity};
const COMPETITOR_ZONE_M = ${COMPETITOR_ZONE_RADIUS_M};
const COMPETITOR_OVERLAP_PX = ${COMPETITOR_OVERLAP_PX};
const BASEMAP_WARNING_TIMEOUT_MS = ${BASEMAP_WARNING_TIMEOUT_MS};
let map = null;

const escapeHtml = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const km = (m) => (m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' km';
const chargerBadge = (c) => c.charger_type === 'DC'
  ? '<span class="badge dc">DC' + (c.chargerMaxKw ? ' ' + c.chargerMaxKw + ' kW' : '') + '</span>'
  : c.charger_type === 'AC'
    ? '<span class="badge ac">AC' + (c.chargerMaxKw ? ' ' + c.chargerMaxKw + ' kW' : '') + '</span>'
    : '<span class="badge unk">n&atilde;o informado</span>';
const competitorPopup = (c) => '<div style="font-weight:700;font-size:12px;margin-bottom:4px;">' + escapeHtml(c.name) + '</div>' +
  '<div style="margin-bottom:4px;">' + chargerBadge(c) + '</div>' +
  '<div style="color:#8B949E;font-size:11px;">' + escapeHtml(c.address) + '</div>' +
  '<div style="font-size:11px;margin-top:4px;">' + km(c.distanceToCenterM) + ' do centro</div>';

// Concorrentes: pontos sobrepostos no zoom atual viram um ponto com contador — nenhum some.
let competitorLayer = null;
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

// Enquadra o ESCOPO pedido (centro + raio), nunca os pontos. A legenda e o
// controle de zoom flutuam sobre o mapa: o espaço deles é RESERVADO no
// enquadramento, senão um ponto (inclusive concorrente) fica escondido embaixo.
let userInteracted = false;
function fitScope() {
  const pad = 24;
  const box = (el) => (el && !el.hidden ? el.getBoundingClientRect() : { width: 0, height: 0 });
  const zoomCtl = box(document.querySelector('.leaflet-control-zoom'));
  const legend = box(document.getElementById('legend'));
  map.fitBounds([[scope.bounds.south, scope.bounds.west], [scope.bounds.north, scope.bounds.east]], {
    paddingTopLeft: [Math.round(zoomCtl.width) + pad, Math.round(zoomCtl.height) + pad],
    paddingBottomRight: [Math.round(legend.width) + pad, Math.round(legend.height) + pad],
  });
}

// A faixa de aviso ocupa espaço no painel: o mapa encolhe e, se o cliente ainda
// não mexeu nele, volta a enquadrar o escopo inteiro.
function setBasemapWarning(show) {
  const el = document.getElementById('basemapWarning');
  if (el.hidden === !show) return;
  el.hidden = !show;
  if (!map) return;
  map.invalidateSize({ pan: false });
  if (!userInteracted) fitScope();
}

// O documento (listas, contadores, carimbo) já está pronto acima. Daqui pra baixo
// é só a camada visual do mapa: se falhar, fica a mensagem e o resto continua legível.
try {
  if (typeof L === 'undefined') throw new Error('Leaflet indisponível');
  map = L.map('map');
  ['mousedown', 'wheel', 'touchstart', 'keydown'].forEach(ev =>
    document.getElementById('map').addEventListener(ev, () => { userInteracted = true; }, { passive: true }));

  // Base cartográfica: sem nenhum tile no prazo (ou só erros), aviso visível no painel do mapa.
  let tilesLoaded = 0;
  const tiles = L.tileLayer(${json(tileUrl)}, { attribution: ${json(TILE_ATTRIBUTION)}, maxZoom: 19 });
  tiles.on('tileload', () => { tilesLoaded++; setBasemapWarning(false); });
  tiles.on('tileerror', () => { if (tilesLoaded === 0) setBasemapWarning(true); });
  tiles.addTo(map);
  setTimeout(() => { if (tilesLoaded === 0) setBasemapWarning(true); }, BASEMAP_WARNING_TIMEOUT_MS);

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

  competitorLayer = L.layerGroup().addTo(map);

  // Legenda visível ANTES de enquadrar: o tamanho dela entra no espaço reservado.
  document.getElementById('mapFallback').hidden = true;
  document.getElementById('legend').hidden = false;

  fitScope();
  renderCompetitors();
  map.on('zoomend', renderCompetitors);

  document.querySelectorAll('.item').forEach(el => {
    el.addEventListener('click', () => {
      userInteracted = true;
      map.flyTo([parseFloat(el.dataset.lat), parseFloat(el.dataset.lng)], parseInt(el.dataset.zoom, 10), { duration: 0.8 });
    });
  });
} catch (err) {
  map = null;
  document.getElementById('mapFallback').hidden = false;
  document.getElementById('legend').hidden = true;
  document.getElementById('basemapWarning').hidden = true;
  if (window.console) console.error('[PLUGGON] mapa indisponível:', err);
}
</script>
</body>
</html>`;
}
