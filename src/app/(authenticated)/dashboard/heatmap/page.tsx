"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import CityStateSelect from "@/components/CityStateSelect";

const ADMIN_EMAILS = ['guilhermegbbento@gmail.com', 'marco@bleveducacao.com.br'];

// ---------- Types ----------

interface GridCell {
  lat: number;
  lng: number;
  score: number;
}

interface Anchor {
  name: string;
  lat: number;
  lng: number;
  type: string;
  typeLabel: string;
  address: string;
  cellScore: number;
}

interface Complementary {
  name: string;
  lat: number;
  lng: number;
  type: string;
  typeLabel: string;
  address: string;
  nearAnchor: string;
  nearAnchorDist: number;
}

interface Competitor {
  name: string;
  lat: number;
  lng: number;
  charger_type: "DC" | "AC" | "unknown";
  address: string;
}

interface CityData {
  population: number | null;
  gdpPerCapita: number | null;
  evs: number;
  dcChargers: number;
  totalChargers: number;
  ratioEVperDC: number;
  source?: string;
}

interface TopRegion {
  lat: number;
  lng: number;
  score: number;
  region: string;
  anchors: string[];
  anchorsByType: Record<string, number>;
  complementary: string[];
  complementaryByType: Record<string, number>;
  competitorsDC: number;
  competitorsAC: number;
}

interface HeatmapV2Result {
  city: string;
  state: string;
  center: { lat: number; lng: number };
  grid: GridCell[];
  anchors: Anchor[];
  complementary: Complementary[];
  competitors: Competitor[];
  cityData: CityData;
  stats: {
    totalAnchors: number;
    totalComplementary: number;
    totalCompetitors: number;
    totalCells: number;
    maxScore: number;
    googleQueries: number;
  };
  topRegions: TopRegion[];
  fromCache?: boolean;
}

const HeatmapMapV2 = dynamic(() => import("./HeatmapMapV2"), { ssr: false });

const LOADING_STEPS = [
  "Geocodificando cidade...",
  "Buscando estabelecimentos no Google Places...",
  "Deduplicando e classificando POIs...",
  "Buscando concorrentes existentes...",
  "Renderizando mapa de calor...",
];

const ANCHOR_EMOJI: Record<string, string> = {
  gas_station: "⛽",
  bus_station: "🚌",
  airport: "✈️",
  shopping_mall: "🏬",
};

function formatNumber(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("pt-BR");
}
function formatCurrency(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

export default function HeatmapPage() {
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<HeatmapV2Result | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);
  const [showCompetitors, setShowCompetitors] = useState(false);
  const [showComplementary, setShowComplementary] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [forceRefresh, setForceRefresh] = useState(false);

  // Detect admin
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!cancelled && user?.email && ADMIN_EMAILS.includes(user.email)) setIsAdmin(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Cycle loading steps
  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      setLoadingStep((s) => (s < LOADING_STEPS.length - 1 ? s + 1 : s));
    }, 4000);
    return () => clearInterval(interval);
  }, [loading]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!city.trim() || !state.trim()) return;
      setError("");
      setResult(null);
      setLoading(true);
      setLoadingStep(0);

      try {
        const res = await fetch("/api/heatmap-v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            city: city.trim(),
            state: state.trim(),
            ...(forceRefresh ? { forceRefresh: true } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Erro ao gerar mapa");
        }
        setResult(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro desconhecido");
      } finally {
        setLoading(false);
      }
    },
    [city, state, forceRefresh]
  );

  const handleReset = () => {
    setResult(null);
    setError("");
    setCity("");
    setState("");
    setForceRefresh(false);
  };

  const exportHTML = useCallback(() => {
    if (!result) return;

    const dateStr = new Date().toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PLUGGON — Mapa de Calor — ${result.city}/${result.state}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<script src="https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0D1117; color: #C9D1D9; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
  .header { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; background: #161B22; border-bottom: 1px solid #30363D; }
  .header h1 { font-size: 18px; color: #C9A84C; font-weight: 700; }
  .header h1 span { color: #8B949E; font-weight: 400; font-size: 14px; margin-left: 8px; }
  .header-right { font-size: 12px; color: #8B949E; }
  .main { display: flex; flex: 1; overflow: hidden; }
  .sidebar { width: 30%; min-width: 300px; max-width: 420px; display: flex; flex-direction: column; background: #161B22; border-left: 1px solid #30363D; overflow: hidden; order: 2; }
  .map-container { flex: 1; position: relative; order: 1; }
  #map { width: 100%; height: 100%; }
  .stats-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; padding: 10px; border-bottom: 1px solid #30363D; }
  .stat-card { background: #0D1117; border: 1px solid #30363D; border-radius: 6px; padding: 6px; text-align: center; }
  .stat-card .label { font-size: 9px; color: #8B949E; text-transform: uppercase; }
  .stat-card .value { font-size: 14px; font-weight: 700; margin-top: 2px; color: #E6EDF3; }
  .section-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
  .section-head.gold { color: #C9A84C; border-bottom: 1px solid #30363D; }
  .section-head.toggle { cursor: pointer; user-select: none; border-top: 1px solid #30363D; }
  .section-head.toggle:hover { color: #fff; }
  .section-head.red { color: #F44336; }
  .section-head.gray { color: #8B949E; }
  .scroll-list { overflow-y: auto; }
  .scroll-list::-webkit-scrollbar { width: 6px; }
  .scroll-list::-webkit-scrollbar-track { background: #161B22; }
  .scroll-list::-webkit-scrollbar-thumb { background: #30363D; border-radius: 3px; }
  .anchors-list { flex: 1; }
  .group-head { background: #0D1117; padding: 6px 12px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #C9A84C; }
  .group-head.muted { color: #8B949E; }
  .item { display: block; width: 100%; text-align: left; padding: 8px 12px; border: none; background: transparent; color: inherit; cursor: pointer; border-bottom: 1px solid #30363D; transition: background 0.15s; }
  .item:hover { background: #21262D; }
  .item-name { font-size: 12px; font-weight: 600; color: #E6EDF3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-sub { font-size: 10px; color: #8B949E; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-row { display: flex; align-items: center; gap: 6px; }
  .badge { padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700; }
  .badge.dc { background: #FF980030; color: #FF9800; }
  .badge.ac { background: #42A5F530; color: #42A5F5; }
  .badge.unk { background: #21262D; color: #8B949E; }
  .collapse-body { max-height: 240px; overflow-y: auto; border-top: 1px solid #30363D; display: none; }
  .collapse-body.open { display: block; }
  .legend { position: absolute; bottom: 12px; right: 12px; background: rgba(22,27,34,0.95); border: 1px solid #30363D; border-radius: 8px; padding: 10px 12px; font-size: 11px; backdrop-filter: blur(6px); z-index: 400; }
  .legend-row { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; border: 2px solid #0D1117; }
  .gradient-bar { width: 160px; height: 8px; border-radius: 2px; background: linear-gradient(90deg,#0000ff,#00ff00,#ffff00,#ff8800,#ff0000); }
  .gradient-labels { display: flex; justify-content: space-between; font-size: 9px; color: #8B949E; margin-top: 2px; }
  .footer { display: flex; align-items: center; justify-content: space-between; padding: 8px 20px; background: #161B22; border-top: 1px solid #30363D; font-size: 11px; color: #8B949E; }
  .leaflet-popup-content-wrapper { background: #161B22; color: #C9D1D9; border: 1px solid #30363D; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
  .leaflet-popup-tip { background: #161B22; border: 1px solid #30363D; }
  .leaflet-popup-content { margin: 10px 12px; font-size: 12px; line-height: 1.5; }
</style>
</head>
<body>
<div class="header">
  <h1>PLUGGON by BLEV Educa&ccedil;&atilde;o<span>Mapa de Calor — ${result.city}/${result.state}</span></h1>
  <div class="header-right">${result.cityData.population ? "Pop: " + result.cityData.population.toLocaleString("pt-BR") + " hab." : ""}</div>
</div>
<div class="main">
  <div class="map-container">
    <div id="map"></div>
    <div class="legend">
      <div style="font-weight:700;color:#fff;margin-bottom:6px;">Legenda</div>
      <div class="gradient-bar"></div>
      <div class="gradient-labels"><span>Menor</span><span>Maior concentra&ccedil;&atilde;o</span></div>
      <div style="margin-top:8px;">
        <div class="legend-row"><span class="legend-dot" style="background:#C9A84C;box-shadow:0 0 4px #C9A84C;"></span> Ponto potencial</div>
        <div class="legend-row"><span class="legend-dot" style="background:#fff;width:6px;height:6px;border:1px solid #0D1117;"></span> Estabelecimento complementar</div>
        <div class="legend-row"><span class="legend-dot" style="background:#F44336;"></span> Concorrente existente</div>
      </div>
    </div>
  </div>
  <div class="sidebar">
    <div class="stats-grid">
      <div class="stat-card"><div class="label">Pop.</div><div class="value">${result.cityData.population ? result.cityData.population.toLocaleString("pt-BR") : "—"}</div></div>
      <div class="stat-card"><div class="label">PIB/cap</div><div class="value">${result.cityData.gdpPerCapita ? "R$ " + Math.round(result.cityData.gdpPerCapita / 1000) + "k" : "—"}</div></div>
      <div class="stat-card"><div class="label">EVs</div><div class="value">${result.cityData.evs.toLocaleString("pt-BR")}</div></div>
      <div class="stat-card"><div class="label">DC</div><div class="value">${result.cityData.dcChargers}</div></div>
      <div class="stat-card"><div class="label">EVs/DC</div><div class="value">${result.cityData.ratioEVperDC || "—"}</div></div>
    </div>
    <div class="section-head gold">Pontos Potenciais (${result.anchors.length})</div>
    <div class="anchors-list scroll-list" id="anchorsList"></div>
    <div class="section-head toggle red" id="toggleCompetitors">
      <span>Concorrentes (${result.competitors.length})</span><span id="arrowCompetitors">&#9662;</span>
    </div>
    <div class="collapse-body" id="competitorsList"></div>
    <div class="section-head toggle gray" id="toggleComplementary">
      <span>Complementares Pr&oacute;ximos (${result.complementary.length})</span><span id="arrowComplementary">&#9662;</span>
    </div>
    <div class="collapse-body" id="complementaryList"></div>
  </div>
</div>
<div class="footer">
  <div>PLUGGON by BLEV Educa&ccedil;&atilde;o</div>
  <div>Gerado em ${dateStr}</div>
</div>
<script>
const grid = ${JSON.stringify(result.grid)};
const anchors = ${JSON.stringify(result.anchors)};
const complementary = ${JSON.stringify(result.complementary)};
const competitors = ${JSON.stringify(result.competitors)};
const center = ${JSON.stringify(result.center)};
const maxScore = ${result.stats.maxScore};
const ANCHOR_EMOJI = { gas_station: '⛽', bus_station: '🚌', airport: '✈️', shopping_mall: '🏬' };

const map = L.map('map').setView([center.lat, center.lng], 12);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO', maxZoom: 19 }).addTo(map);

if (grid.length && maxScore > 0) {
  const heatData = grid.map(c => [c.lat, c.lng, c.score / maxScore]);
  L.heatLayer(heatData, {
    radius: 25, blur: 20, maxZoom: 17,
    gradient: { 0.2: '#0000ff', 0.4: '#00ff00', 0.6: '#ffff00', 0.8: '#ff8800', 1.0: '#ff0000' }
  }).addTo(map);
}

const escapeHtml = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

anchors.forEach(a => {
  const emoji = ANCHOR_EMOJI[a.type] || '📍';
  const icon = L.divIcon({
    html: '<div style="width:14px;height:14px;border-radius:50%;background:#C9A84C;border:2px solid #0D1117;box-shadow:0 0 8px #C9A84C;"></div>',
    className: '', iconSize: [14,14], iconAnchor:[7,7]
  });
  L.marker([a.lat, a.lng], { icon, zIndexOffset: 1000 })
    .bindPopup('<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + emoji + ' ' + escapeHtml(a.name) + '</div>' +
               '<div style="color:#8B949E;font-size:11px;margin-bottom:6px;">' + escapeHtml(a.address) + '</div>' +
               '<span style="background:#C9A84C20;color:#C9A84C;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">' + escapeHtml(a.typeLabel) + '</span>')
    .addTo(map);
});

complementary.forEach(c => {
  const icon = L.divIcon({
    html: '<div style="width:8px;height:8px;border-radius:50%;background:#fff;border:1px solid #0D1117;"></div>',
    className: '', iconSize:[8,8], iconAnchor:[4,4]
  });
  L.marker([c.lat, c.lng], { icon, zIndexOffset: 500 })
    .bindPopup('<div style="font-weight:700;font-size:12px;">' + escapeHtml(c.name) + '</div>' +
               '<div style="color:#8B949E;font-size:11px;margin-top:2px;">' + escapeHtml(c.address) + '</div>' +
               '<div style="margin-top:4px;font-size:11px;color:#C9D1D9;">' + escapeHtml(c.typeLabel) + '</div>' +
               (c.nearAnchor ? '<div style="color:#8B949E;font-size:11px;margin-top:4px;">Próximo a: ' + escapeHtml(c.nearAnchor) + ' (' + c.nearAnchorDist + 'm)</div>' : ''))
    .addTo(map);
});

competitors.forEach(c => {
  const icon = L.divIcon({
    html: '<div style="width:12px;height:12px;border-radius:50%;background:#F44336;border:2px solid #0D1117;"></div>',
    className: '', iconSize:[12,12], iconAnchor:[6,6]
  });
  const typeLabel = c.charger_type === 'DC' ? '<span style="background:#FF980030;color:#FF9800;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">DC</span>' : c.charger_type === 'AC' ? '<span style="background:#42A5F530;color:#42A5F5;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">AC</span>' : '';
  L.marker([c.lat, c.lng], { icon, zIndexOffset: 800 })
    .bindPopup('<div style="font-weight:700;font-size:12px;margin-bottom:4px;">' + escapeHtml(c.name) + '</div>' +
               '<div style="margin-bottom:4px;">' + typeLabel + '</div>' +
               '<div style="color:#8B949E;font-size:11px;">' + escapeHtml(c.address) + '</div>')
    .addTo(map);
});

// Anchors grouped by type
const byType = {};
anchors.forEach(a => {
  if (!byType[a.typeLabel]) byType[a.typeLabel] = [];
  byType[a.typeLabel].push(a);
});
const anchorsList = document.getElementById('anchorsList');
anchorsList.innerHTML = Object.keys(byType).map(label => {
  const items = byType[label];
  const emoji = ANCHOR_EMOJI[items[0].type] || '📍';
  return '<div class="group-head">' + emoji + ' ' + escapeHtml(label) + ' (' + items.length + ')</div>' +
    items.map(a =>
      '<button class="item" data-lat="' + a.lat + '" data-lng="' + a.lng + '" data-zoom="16">' +
        '<div class="item-name">' + escapeHtml(a.name) + '</div>' +
        '<div class="item-sub">' + escapeHtml(a.address) + '</div>' +
      '</button>'
    ).join('');
}).join('');

// Competitors list
const competitorsList = document.getElementById('competitorsList');
competitorsList.innerHTML = competitors.length === 0
  ? '<div style="padding:12px;text-align:center;font-size:11px;color:#8B949E;">Nenhum concorrente encontrado.</div>'
  : competitors.map(c => {
      const cls = c.charger_type === 'DC' ? 'dc' : c.charger_type === 'AC' ? 'ac' : 'unk';
      const tag = c.charger_type === 'unknown' ? '?' : c.charger_type;
      return '<button class="item" data-lat="' + c.lat + '" data-lng="' + c.lng + '" data-zoom="17">' +
        '<div class="item-row"><span class="badge ' + cls + '">' + tag + '</span><span class="item-name" style="flex:1;">' + escapeHtml(c.name) + '</span></div>' +
        '<div class="item-sub">' + escapeHtml(c.address) + '</div>' +
      '</button>';
    }).join('');

// Complementary grouped by nearest anchor
const compGroups = {};
complementary.forEach(cp => {
  const key = cp.nearAnchor || 'Sem âncora próxima';
  if (!compGroups[key]) compGroups[key] = [];
  compGroups[key].push(cp);
});
const compEntries = Object.keys(compGroups)
  .map(k => ({ name: k, items: compGroups[k].slice().sort((a,b) => a.nearAnchorDist - b.nearAnchorDist) }))
  .sort((a,b) => b.items.length - a.items.length);
const complementaryList = document.getElementById('complementaryList');
complementaryList.innerHTML = compEntries.length === 0
  ? '<div style="padding:12px;text-align:center;font-size:11px;color:#8B949E;">Nenhum complementar encontrado.</div>'
  : compEntries.map(g =>
      '<div class="group-head muted">Pr&oacute;ximos a ' + escapeHtml(g.name) + ' (' + g.items.length + ')</div>' +
      g.items.map(cp =>
        '<button class="item" data-lat="' + cp.lat + '" data-lng="' + cp.lng + '" data-zoom="17">' +
          '<div class="item-name">' + escapeHtml(cp.name) + (cp.nearAnchorDist ? ' (' + cp.nearAnchorDist + 'm)' : '') + '</div>' +
          '<div class="item-sub">' + escapeHtml(cp.typeLabel) + '</div>' +
        '</button>'
      ).join('')
    ).join('');

document.querySelectorAll('.item').forEach(el => {
  el.addEventListener('click', () => {
    map.flyTo([parseFloat(el.dataset.lat), parseFloat(el.dataset.lng)], parseInt(el.dataset.zoom, 10), { duration: 0.8 });
  });
});

function setupToggle(headId, bodyId, arrowId) {
  document.getElementById(headId).addEventListener('click', () => {
    const body = document.getElementById(bodyId);
    const open = body.classList.toggle('open');
    document.getElementById(arrowId).innerHTML = open ? '&#9652;' : '&#9662;';
  });
}
setupToggle('toggleCompetitors', 'competitorsList', 'arrowCompetitors');
setupToggle('toggleComplementary', 'complementaryList', 'arrowComplementary');

const allCoords = [].concat(grid.map(c => [c.lat, c.lng]), anchors.map(a => [a.lat, a.lng]), competitors.map(c => [c.lat, c.lng]));
if (allCoords.length) map.fitBounds(allCoords, { padding: [40,40] });
<\/script>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Mapa_Calor_PLUGGON_${result.city}_${result.state}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result]);

  // Group anchors by type for sidebar
  const anchorsByType = useMemo(() => {
    if (!result) return {} as Record<string, Anchor[]>;
    const map: Record<string, Anchor[]> = {};
    for (const a of result.anchors) {
      if (!map[a.typeLabel]) map[a.typeLabel] = [];
      map[a.typeLabel].push(a);
    }
    return map;
  }, [result]);

  // Group complementary by nearest anchor (sidebar)
  const complementaryByAnchor = useMemo(() => {
    if (!result) return [] as { anchorName: string; items: Complementary[] }[];
    const groups = new Map<string, Complementary[]>();
    for (const cp of result.complementary) {
      const key = cp.nearAnchor || "Sem âncora próxima";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(cp);
    }
    return Array.from(groups.entries())
      .map(([anchorName, items]) => ({
        anchorName,
        items: items.sort((a, b) => a.nearAnchorDist - b.nearAnchorDist),
      }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [result]);

  // ========== Initial form ==========
  if (!result && !loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white">Mapa de Calor</h1>
        <p className="mt-1 text-[#8B949E]">
          Mapa de calor mostrando pontos potenciais e concentração de estabelecimentos. Sem IA — cálculo determinístico.
        </p>

        <div className="mt-8 flex items-center justify-center">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-lg rounded-xl border border-[#30363D] bg-[#161B22] p-8"
          >
            <h2 className="mb-6 text-lg font-semibold text-white">Gerar Mapa</h2>

            <div className="space-y-4">
              <CityStateSelect
                initialCity={city}
                initialState={state}
                onSelect={(c, s) => {
                  setCity(c);
                  setState(s);
                }}
              />
            </div>

            {isAdmin && (
              <label className="mt-4 flex cursor-pointer items-center gap-2 rounded-lg border border-[#30363D] bg-[#0D1117] px-3 py-2 text-xs text-[#C9A84C]">
                <input
                  type="checkbox"
                  checked={forceRefresh}
                  onChange={(e) => setForceRefresh(e.target.checked)}
                  className="h-3.5 w-3.5 cursor-pointer accent-[#C9A84C]"
                />
                <span className="font-medium">[ADMIN]</span>
                <span className="text-[#8B949E]">
                  Forçar nova análise (ignorar cache)
                </span>
              </label>
            )}

            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              className="mt-6 w-full rounded-lg bg-[#C9A84C] px-4 py-3 font-semibold text-[#0D1117] transition-colors hover:bg-[#B89443]"
            >
              Gerar Mapa
            </button>

            <p className="mt-3 text-center text-xs text-[#484F58]">
              ~11 queries Google Places · ~R$ 1,50 por cidade · Cache 7 dias
            </p>
          </form>
        </div>
      </div>
    );
  }

  // ========== Loading ==========
  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white">Mapa de Calor</h1>
        <p className="mt-1 text-[#8B949E]">
          Gerando mapa de {city}/{state}...
        </p>

        <div className="mt-16 flex flex-col items-center gap-8">
          <div className="relative h-20 w-20">
            <div className="absolute inset-0 rounded-full border-4 border-[#30363D]" />
            <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-[#C9A84C]" />
          </div>
          <div className="space-y-2 text-center">
            {LOADING_STEPS.map((step, i) => (
              <p
                key={i}
                className={`text-sm transition-colors ${
                  i < loadingStep
                    ? "text-[#66BB6A]"
                    : i === loadingStep
                      ? "text-[#C9A84C] font-medium"
                      : "text-[#484F58]"
                }`}
              >
                {i < loadingStep ? "✓ " : i === loadingStep ? "→ " : "  "}
                {step}
              </p>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!result) return null;

  // ========== Results ==========
  const { cityData, stats } = result;

  // Estimated cost
  const googleCost = stats.googleQueries * 0.032; // USD
  const totalCostUsd = googleCost;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Mapa de Calor — {result.city}/{result.state}
          </h1>
          <p className="mt-1 text-sm text-[#8B949E]">
            {stats.totalAnchors} pontos potenciais · {stats.totalComplementary} complementares · {stats.totalCompetitors} concorrentes
            {result.fromCache && (
              <span className="ml-2 rounded bg-[#2196F320] px-2 py-0.5 text-xs text-[#2196F3]">cache</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportHTML}
            className="rounded-lg border border-[#C9A84C] px-4 py-2 text-sm font-medium text-[#C9A84C] transition-colors hover:bg-[#C9A84C] hover:text-[#0D1117]"
          >
            Exportar HTML
          </button>
          <button
            onClick={handleReset}
            className="rounded-lg border border-[#30363D] px-4 py-2 text-sm text-[#8B949E] transition-colors hover:border-[#C9A84C] hover:text-white"
          >
            Nova Análise
          </button>
        </div>
      </div>

      {/* City data cards */}
      <div className="mt-4 grid grid-cols-5 gap-2">
        {[
          { label: "População", value: formatNumber(cityData.population), color: "text-white", available: cityData.population !== null },
          { label: "PIB per capita", value: formatCurrency(cityData.gdpPerCapita), color: "text-white", available: cityData.gdpPerCapita !== null },
          { label: "EVs na cidade", value: formatNumber(cityData.evs), color: "text-[#66BB6A]", available: cityData.evs > 0 },
          { label: "Carregadores DC", value: formatNumber(cityData.dcChargers), color: "text-[#FF8800]", available: cityData.dcChargers > 0 },
          { label: "EVs / DC", value: formatNumber(cityData.ratioEVperDC), color: "text-[#C9A84C]", available: cityData.ratioEVperDC > 0 },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-[#30363D] bg-[#161B22] px-2 py-3 text-center"
          >
            <p className="text-[10px] text-[#8B949E]">{s.label}</p>
            {s.available ? (
              <p className={`mt-1 text-lg font-bold ${s.color}`}>{s.value}</p>
            ) : (
              <p className="mt-1 text-xs text-[#8B949E]">Dados não disponíveis</p>
            )}
          </div>
        ))}
      </div>
      {cityData.source && (cityData.evs > 0 || cityData.dcChargers > 0) && (
        <p className="mt-1 text-right text-[10px] italic text-[#8B949E]">
          Fonte: {cityData.source}
        </p>
      )}

      {/* Admin cost card */}
      {isAdmin && (
        <div className="mt-2 rounded-lg border border-[#30363D] bg-[#161B22] px-3 py-2 text-xs text-[#8B949E]">
          <span className="font-medium text-[#C9A84C]">[ADMIN]</span>
          {" "}Google Places: {stats.googleQueries} queries = ~US$ {googleCost.toFixed(2)} · Claude: 0 · Total: ~US$ {totalCostUsd.toFixed(2)}
          {result.fromCache && " (cache hit — 0 queries cobradas)"}
        </div>
      )}

      {/* Main: map + sidebar */}
      <div className="mt-4 flex flex-1 gap-4 overflow-hidden">
        {/* Map (70%) */}
        <div className="flex-1 overflow-hidden rounded-xl border border-[#30363D]">
          <HeatmapMapV2
            center={result.center}
            grid={result.grid}
            anchors={result.anchors}
            complementary={result.complementary}
            competitors={result.competitors}
            maxScore={stats.maxScore}
            flyTo={flyTo}
          />
        </div>

        {/* Sidebar (30%) */}
        <div className="flex w-[28rem] shrink-0 flex-col rounded-xl border border-[#30363D] bg-[#161B22]">
          {/* PONTOS POTENCIAIS */}
          <div className="border-b border-[#30363D] px-3 py-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[#C9A84C]">
              Pontos Potenciais ({result.anchors.length})
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            {result.anchors.length === 0 ? (
              <p className="p-4 text-center text-sm text-[#8B949E]">
                Nenhum ponto potencial encontrado.
              </p>
            ) : (
              Object.entries(anchorsByType).map(([typeLabel, items]) => (
                <div key={typeLabel}>
                  <div className="bg-[#0D1117] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[#C9A84C]">
                    {ANCHOR_EMOJI[items[0].type] || "📍"} {typeLabel} ({items.length})
                  </div>
                  {items.map((a) => (
                    <button
                      key={`${a.lat}-${a.lng}-${a.name}`}
                      onClick={() => setFlyTo({ lat: a.lat, lng: a.lng, zoom: 16 })}
                      className="block w-full border-b border-[#30363D] px-3 py-2 text-left transition-colors hover:bg-[#21262D]"
                    >
                      <p className="truncate text-xs font-medium text-white">
                        {a.name}
                      </p>
                      <p className="truncate text-[10px] text-[#8B949E]">
                        {a.address}
                      </p>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>

          {/* CONCORRENTES (collapsible) */}
          <div className="border-t border-[#30363D]">
            <button
              onClick={() => setShowCompetitors((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-xs font-bold uppercase tracking-wide text-[#F44336] transition-colors hover:text-white"
            >
              <span>Concorrentes ({result.competitors.length})</span>
              <span>{showCompetitors ? "▴" : "▾"}</span>
            </button>
            {showCompetitors && (
              <div className="max-h-60 overflow-y-auto border-t border-[#30363D]">
                {result.competitors.length === 0 ? (
                  <p className="p-3 text-center text-xs text-[#8B949E]">
                    Nenhum concorrente encontrado.
                  </p>
                ) : (
                  result.competitors.map((c) => (
                    <button
                      key={`${c.lat}-${c.lng}-${c.name}`}
                      onClick={() => setFlyTo({ lat: c.lat, lng: c.lng, zoom: 17 })}
                      className="block w-full border-b border-[#30363D] px-3 py-2 text-left transition-colors hover:bg-[#21262D]"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                            c.charger_type === "DC"
                              ? "bg-[#FF980030] text-[#FF9800]"
                              : c.charger_type === "AC"
                                ? "bg-[#42A5F530] text-[#42A5F5]"
                                : "bg-[#21262D] text-[#8B949E]"
                          }`}
                        >
                          {c.charger_type === "unknown" ? "?" : c.charger_type}
                        </span>
                        <p className="flex-1 truncate text-xs font-medium text-white">
                          {c.name}
                        </p>
                      </div>
                      <p className="mt-0.5 truncate text-[10px] text-[#8B949E]">
                        {c.address}
                      </p>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* COMPLEMENTARES PRÓXIMOS (collapsible) */}
          <div className="border-t border-[#30363D]">
            <button
              onClick={() => setShowComplementary((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-xs font-bold uppercase tracking-wide text-[#8B949E] transition-colors hover:text-white"
            >
              <span>Complementares Próximos ({result.complementary.length})</span>
              <span>{showComplementary ? "▴" : "▾"}</span>
            </button>
            {showComplementary && (
              <div className="max-h-60 overflow-y-auto border-t border-[#30363D]">
                {complementaryByAnchor.length === 0 ? (
                  <p className="p-3 text-center text-xs text-[#8B949E]">
                    Nenhum complementar encontrado.
                  </p>
                ) : (
                  complementaryByAnchor.map((g) => (
                    <div key={g.anchorName}>
                      <div className="bg-[#0D1117] px-3 py-1.5 text-[10px] font-bold uppercase text-[#8B949E]">
                        Próximos a {g.anchorName} ({g.items.length})
                      </div>
                      {g.items.map((cp) => (
                        <button
                          key={`${cp.lat}-${cp.lng}-${cp.name}`}
                          onClick={() => setFlyTo({ lat: cp.lat, lng: cp.lng, zoom: 17 })}
                          className="block w-full border-b border-[#30363D] px-3 py-2 text-left transition-colors hover:bg-[#21262D]"
                        >
                          <p className="truncate text-xs font-medium text-white">
                            {cp.name}{cp.nearAnchorDist ? ` (${cp.nearAnchorDist}m)` : ""}
                          </p>
                          <p className="truncate text-[10px] text-[#8B949E]">
                            {cp.typeLabel}
                          </p>
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
