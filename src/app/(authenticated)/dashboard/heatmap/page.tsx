"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";

const ADMIN_EMAIL = "guilherme@bfranca.com";

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
  "Calculando grid 300x300m e scores...",
];

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
  const [showAllPoints, setShowAllPoints] = useState(false);
  const [allPointsTab, setAllPointsTab] = useState<
    "anchors" | "complementary" | "competitors"
  >("anchors");
  const [isAdmin, setIsAdmin] = useState(false);

  // Detect admin
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!cancelled && user?.email === ADMIN_EMAIL) setIsAdmin(true);
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
          body: JSON.stringify({ city: city.trim(), state: state.trim() }),
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
    [city, state]
  );

  const handleReset = () => {
    setResult(null);
    setError("");
    setCity("");
    setState("");
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
  .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 10px; border-bottom: 1px solid #30363D; }
  .stat-card { background: #0D1117; border: 1px solid #30363D; border-radius: 6px; padding: 6px; text-align: center; }
  .stat-card .label { font-size: 9px; color: #8B949E; text-transform: uppercase; }
  .stat-card .value { font-size: 16px; font-weight: 700; margin-top: 2px; color: #E6EDF3; }
  .section-title { padding: 10px 12px 6px; font-size: 11px; color: #C9A84C; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
  .region-list { flex: 1; overflow-y: auto; }
  .region-list::-webkit-scrollbar { width: 6px; }
  .region-list::-webkit-scrollbar-track { background: #161B22; }
  .region-list::-webkit-scrollbar-thumb { background: #30363D; border-radius: 3px; }
  .region-card { padding: 10px 12px; border-bottom: 1px solid #30363D; cursor: pointer; transition: background 0.15s; }
  .region-card:hover { background: #21262D; }
  .region-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .region-rank { font-size: 12px; font-weight: 700; color: #C9A84C; }
  .region-score { background: #FF880020; color: #FF8800; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; }
  .region-name { font-size: 13px; color: #E6EDF3; font-weight: 600; }
  .region-detail { font-size: 11px; color: #8B949E; margin-top: 4px; line-height: 1.4; }
  .legend { position: absolute; bottom: 12px; right: 12px; background: rgba(22,27,34,0.95); border: 1px solid #30363D; border-radius: 8px; padding: 10px 12px; font-size: 11px; backdrop-filter: blur(6px); z-index: 400; }
  .legend-row { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; border: 2px solid #0D1117; }
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
      <div style="font-weight:700;color:#fff;margin-bottom:4px;">Legenda</div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <span style="display:inline-block;width:36px;height:8px;border-radius:2px;background:linear-gradient(90deg,#0000ff,#00ff00,#ffff00,#ff8800,#ff0000);"></span>
        <span style="color:#8B949E;font-size:10px;">azul → vermelho</span>
      </div>
      <div class="legend-row"><span class="legend-dot" style="background:#C9A84C;box-shadow:0 0 4px #C9A84C;"></span> &Acirc;ncora</div>
      <div class="legend-row"><span class="legend-dot" style="background:#fff;width:6px;height:6px;border:1px solid #0D1117;"></span> Complementar</div>
      <div class="legend-row"><span class="legend-dot" style="background:#F44336;"></span> Concorrente</div>
    </div>
  </div>
  <div class="sidebar">
    <div class="stats-grid">
      <div class="stat-card"><div class="label">Pop.</div><div class="value">${result.cityData.population ? result.cityData.population.toLocaleString("pt-BR") : "—"}</div></div>
      <div class="stat-card"><div class="label">PIB/cap</div><div class="value">${result.cityData.gdpPerCapita ? "R$ " + Math.round(result.cityData.gdpPerCapita / 1000) + "k" : "—"}</div></div>
      <div class="stat-card"><div class="label">EVs</div><div class="value">${result.cityData.evs.toLocaleString("pt-BR")}</div></div>
      <div class="stat-card"><div class="label">DC</div><div class="value">${result.cityData.dcChargers}</div></div>
      <div class="stat-card"><div class="label">EVs/DC</div><div class="value">${result.cityData.ratioEVperDC || "—"}</div></div>
      <div class="stat-card"><div class="label">Regi&otilde;es</div><div class="value">${result.stats.totalCells}</div></div>
    </div>
    <div class="section-title">Top 10 Regi&otilde;es</div>
    <div class="region-list" id="regionList"></div>
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
const topRegions = ${JSON.stringify(result.topRegions)};
const center = ${JSON.stringify(result.center)};
const maxScore = ${result.stats.maxScore};

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
  const icon = L.divIcon({
    html: '<div style="width:14px;height:14px;border-radius:50%;background:#C9A84C;border:2px solid #0D1117;box-shadow:0 0 8px #C9A84C;"></div>',
    className: '', iconSize: [14,14], iconAnchor:[7,7]
  });
  L.marker([a.lat, a.lng], { icon, zIndexOffset: 1000 })
    .bindPopup('<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + escapeHtml(a.name) + '</div>' +
               '<div style="color:#8B949E;font-size:11px;margin-bottom:4px;">' + escapeHtml(a.address) + '</div>' +
               '<span style="background:#C9A84C20;color:#C9A84C;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">' + escapeHtml(a.typeLabel) + '</span> ' +
               '<span style="background:#FF880020;color:#FF8800;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">Score região: ' + a.cellScore + '</span>')
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
  const typeLabel = c.charger_type === 'DC' ? '<span style="background:#FF980030;color:#FF9800;padding:2px 8px;border-radius:4px;font-size:11px;">DC</span>' : c.charger_type === 'AC' ? '<span style="background:#42A5F530;color:#42A5F5;padding:2px 8px;border-radius:4px;font-size:11px;">AC</span>' : '';
  L.marker([c.lat, c.lng], { icon, zIndexOffset: 800 })
    .bindPopup('<span style="background:#F4433630;color:#F44336;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">CONCORRENTE</span> ' + typeLabel +
               '<div style="font-weight:700;font-size:12px;margin-top:6px;">' + escapeHtml(c.name) + '</div>' +
               '<div style="color:#8B949E;font-size:11px;margin-top:2px;">' + escapeHtml(c.address) + '</div>')
    .addTo(map);
});

const regionList = document.getElementById('regionList');
regionList.innerHTML = topRegions.map((r, i) =>
  '<div class="region-card" data-lat="' + r.lat + '" data-lng="' + r.lng + '">' +
    '<div class="region-head"><span class="region-rank">#' + (i+1) + ' ' + escapeHtml(r.region) + '</span><span class="region-score">Score ' + r.score + '</span></div>' +
    '<div class="region-detail">' +
      '<b>Âncoras:</b> ' + (Object.entries(r.anchorsByType).map(([k,v]) => v + ' ' + k.toLowerCase()).join(', ') || 'nenhuma') + '<br/>' +
      '<b>Compl.:</b> ' + (Object.entries(r.complementaryByType).map(([k,v]) => v + ' ' + k.toLowerCase()).join(', ') || 'nenhuma') + '<br/>' +
      '<b>Concorrentes:</b> ' + r.competitorsDC + ' DC, ' + r.competitorsAC + ' AC' +
    '</div>' +
  '</div>'
).join('');
regionList.querySelectorAll('.region-card').forEach(el => {
  el.addEventListener('click', () => {
    map.flyTo([parseFloat(el.dataset.lat), parseFloat(el.dataset.lng)], 16, { duration: 0.8 });
  });
});

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

  const competitorsByType = useMemo(() => {
    if (!result) return { DC: [] as Competitor[], AC: [] as Competitor[], unknown: [] as Competitor[] };
    return {
      DC: result.competitors.filter((c) => c.charger_type === "DC"),
      AC: result.competitors.filter((c) => c.charger_type === "AC"),
      unknown: result.competitors.filter((c) => c.charger_type === "unknown"),
    };
  }, [result]);

  // ========== Initial form ==========
  if (!result && !loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white">Mapa de Calor</h1>
        <p className="mt-1 text-[#8B949E]">
          Score por região da cidade baseado em densidade de estabelecimentos. Sem IA — cálculo determinístico.
        </p>

        <div className="mt-8 flex items-center justify-center">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-lg rounded-xl border border-[#30363D] bg-[#161B22] p-8"
          >
            <h2 className="mb-6 text-lg font-semibold text-white">Gerar Mapa</h2>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-[#8B949E]">
                  Cidade
                </label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Ex: São Paulo"
                  required
                  className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-3 text-white placeholder-[#484F58] outline-none transition-colors focus:border-[#C9A84C]"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-[#8B949E]">
                  Estado (sigla)
                </label>
                <input
                  type="text"
                  value={state}
                  onChange={(e) => setState(e.target.value.toUpperCase())}
                  placeholder="Ex: SP"
                  maxLength={2}
                  required
                  className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-3 text-white placeholder-[#484F58] outline-none transition-colors focus:border-[#C9A84C]"
                />
              </div>
            </div>

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
  const { cityData, stats, topRegions } = result;

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
            {stats.totalAnchors} âncoras · {stats.totalComplementary} complementares · {stats.totalCompetitors} concorrentes · {stats.totalCells} regiões com score
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
      <div className="mt-4 grid grid-cols-6 gap-2">
        {[
          { label: "População", value: formatNumber(cityData.population), color: "text-white" },
          { label: "PIB per capita", value: formatCurrency(cityData.gdpPerCapita), color: "text-white" },
          { label: "EVs na cidade", value: formatNumber(cityData.evs), color: "text-[#66BB6A]" },
          { label: "Carregadores DC", value: formatNumber(cityData.dcChargers), color: "text-[#FF8800]" },
          { label: "EVs / DC", value: cityData.ratioEVperDC > 0 ? formatNumber(cityData.ratioEVperDC) : "—", color: "text-[#C9A84C]" },
          { label: "Regiões analisadas", value: formatNumber(stats.totalCells), color: "text-[#2196F3]" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-[#30363D] bg-[#161B22] px-2 py-3 text-center"
          >
            <p className="text-[10px] text-[#8B949E]">{s.label}</p>
            <p className={`mt-1 text-lg font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

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
          {/* TOP 10 Regiões */}
          <div className="border-b border-[#30363D] px-3 py-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[#C9A84C]">
              Top 10 Regiões
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            {topRegions.length === 0 ? (
              <p className="p-4 text-center text-sm text-[#8B949E]">
                Nenhuma região com score positivo encontrada.
              </p>
            ) : (
              topRegions.map((r, i) => (
                <div
                  key={`${r.lat}-${r.lng}`}
                  className="border-b border-[#30363D] px-3 py-3"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-bold text-[#C9A84C]">
                        #{i + 1}
                      </span>
                      <span className="ml-2 text-sm font-medium text-white">
                        📍 {r.region}
                      </span>
                    </div>
                    <span className="rounded bg-[#FF880020] px-2 py-0.5 text-xs font-bold text-[#FF8800]">
                      Score {r.score}
                    </span>
                  </div>
                  <div className="mt-2 space-y-0.5 text-xs text-[#8B949E]">
                    <div>
                      <span className="text-[#C9A84C]">Âncoras:</span>{" "}
                      {Object.entries(r.anchorsByType)
                        .map(([k, v]) => `${v} ${k.toLowerCase()}`)
                        .join(", ") || "—"}
                    </div>
                    <div>
                      <span className="text-white">Complementares:</span>{" "}
                      {Object.entries(r.complementaryByType)
                        .map(([k, v]) => `${v} ${k.toLowerCase()}`)
                        .join(", ") || "—"}
                    </div>
                    <div>
                      <span className="text-[#F44336]">Concorrentes:</span>{" "}
                      {r.competitorsDC} DC, {r.competitorsAC} AC
                    </div>
                  </div>
                  <button
                    onClick={() => setFlyTo({ lat: r.lat, lng: r.lng, zoom: 16 })}
                    className="mt-2 w-full rounded-md border border-[#30363D] px-2 py-1 text-xs text-[#8B949E] transition-colors hover:border-[#C9A84C] hover:text-[#C9A84C]"
                  >
                    Ver no mapa
                  </button>
                </div>
              ))
            )}
          </div>

          {/* All points (collapsible) */}
          <div className="border-t border-[#30363D]">
            <button
              onClick={() => setShowAllPoints((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-xs font-bold uppercase tracking-wide text-[#8B949E] transition-colors hover:text-white"
            >
              <span>Todos os pontos</span>
              <span>{showAllPoints ? "▴" : "▾"}</span>
            </button>
            {showAllPoints && (
              <>
                <div className="flex border-t border-[#30363D]">
                  <button
                    onClick={() => setAllPointsTab("anchors")}
                    className={`flex-1 px-2 py-2 text-[11px] font-medium transition-colors ${
                      allPointsTab === "anchors"
                        ? "border-b-2 border-[#C9A84C] text-[#C9A84C]"
                        : "text-[#8B949E] hover:text-white"
                    }`}
                  >
                    Âncoras ({result.anchors.length})
                  </button>
                  <button
                    onClick={() => setAllPointsTab("complementary")}
                    className={`flex-1 px-2 py-2 text-[11px] font-medium transition-colors ${
                      allPointsTab === "complementary"
                        ? "border-b-2 border-white text-white"
                        : "text-[#8B949E] hover:text-white"
                    }`}
                  >
                    Compl. ({result.complementary.length})
                  </button>
                  <button
                    onClick={() => setAllPointsTab("competitors")}
                    className={`flex-1 px-2 py-2 text-[11px] font-medium transition-colors ${
                      allPointsTab === "competitors"
                        ? "border-b-2 border-[#F44336] text-[#F44336]"
                        : "text-[#8B949E] hover:text-white"
                    }`}
                  >
                    Concorrentes ({result.competitors.length})
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {allPointsTab === "anchors" &&
                    Object.entries(anchorsByType).map(([typeLabel, items]) => (
                      <div key={typeLabel}>
                        <div className="bg-[#0D1117] px-3 py-1 text-[10px] font-bold uppercase text-[#C9A84C]">
                          {typeLabel} ({items.length})
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
                              {a.address} · score {a.cellScore}
                            </p>
                          </button>
                        ))}
                      </div>
                    ))}
                  {allPointsTab === "complementary" &&
                    result.complementary.map((cp) => (
                      <button
                        key={`${cp.lat}-${cp.lng}-${cp.name}`}
                        onClick={() => setFlyTo({ lat: cp.lat, lng: cp.lng, zoom: 17 })}
                        className="block w-full border-b border-[#30363D] px-3 py-2 text-left transition-colors hover:bg-[#21262D]"
                      >
                        <p className="truncate text-xs font-medium text-white">
                          {cp.name}
                        </p>
                        <p className="truncate text-[10px] text-[#8B949E]">
                          {cp.typeLabel}
                          {cp.nearAnchor
                            ? ` · próx. ${cp.nearAnchor} (${cp.nearAnchorDist}m)`
                            : ""}
                        </p>
                      </button>
                    ))}
                  {allPointsTab === "competitors" && (
                    <>
                      {(["DC", "AC", "unknown"] as const).map((t) =>
                        competitorsByType[t].length > 0 ? (
                          <div key={t}>
                            <div className="bg-[#0D1117] px-3 py-1 text-[10px] font-bold uppercase text-[#F44336]">
                              {t === "unknown" ? "Tipo desconhecido" : t} ({competitorsByType[t].length})
                            </div>
                            {competitorsByType[t].map((c) => (
                              <button
                                key={`${c.lat}-${c.lng}-${c.name}`}
                                onClick={() => setFlyTo({ lat: c.lat, lng: c.lng, zoom: 17 })}
                                className="block w-full border-b border-[#30363D] px-3 py-2 text-left transition-colors hover:bg-[#21262D]"
                              >
                                <p className="truncate text-xs font-medium text-white">
                                  {c.name}
                                </p>
                                <p className="truncate text-[10px] text-[#8B949E]">
                                  {c.address}
                                </p>
                              </button>
                            ))}
                          </div>
                        ) : null
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
