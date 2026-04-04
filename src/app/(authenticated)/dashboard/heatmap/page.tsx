"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";

// ---------- Types ----------
interface PointData {
  name: string;
  lat: number;
  lng: number;
  address: string;
  category: string;
  subcategory: string;
  score: number;
  classification: string;
  justification: string;
  operacao_24h: boolean;
  tempo_permanencia: string;
  pontos_fortes: string[];
  pontos_atencao: string[];
  region?: string;
  chargers_in_2km?: number;
}

interface ChargerData {
  name: string;
  lat: number;
  lng: number;
  address: string;
  operator: string;
  powerKW: number;
  connectionType: string;
  isFastCharge: boolean;
  isOperational: boolean;
  totalConnections: number;
  usageCost: string;
  levelName: string;
  source?: string;
  type?: string;
  rating?: number;
  reviews?: number;
}

interface MobilityZoneData {
  name: string;
  lat: number;
  lng: number;
  address: string;
  type: string;
  typeLabel: string;
}

interface AnalysisResult {
  city: string;
  state: string;
  population: number | null;
  points: PointData[];
  chargers: ChargerData[];
  mobilityZones: MobilityZoneData[];
}

// ---------- Constants ----------
const CLASSIFICATION_COLORS: Record<string, string> = {
  PREMIUM: "#C9A84C",
  ESTRATEGICO: "#2196F3",
  VIAVEL: "#FFC107",
  MARGINAL: "#FF9800",
  REJEITADO: "#F44336",
};

const CATEGORY_LABELS: Record<string, string> = {
  posto_24h: "Posto 24h",
  posto_combustivel: "Posto",
  shopping: "Shopping",
  hospital_24h: "Hospital 24h",
  farmacia_24h: "Farmácia 24h",
  rodoviaria: "Rodoviária",
  aeroporto: "Aeroporto",
  universidade: "Universidade",
  supermercado: "Supermercado",
  atacadao: "Atacadão",
  hotel: "Hotel",
  academia: "Academia",
  estacionamento: "Estacionamento",
  concessionaria: "Concessionária",
  centro_comercial: "Centro Comercial",
  terreno: "Terreno",
  restaurante: "Restaurante",
  outro: "Outro",
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  PREMIUM: "Premium",
  ESTRATEGICO: "Estratégico",
  VIAVEL: "Viável",
  MARGINAL: "Marginal",
  REJEITADO: "Rejeitado",
};

const MOBILITY_TYPE_COLORS: Record<string, string> = {
  taxi: "#42A5F5",
  aeroporto: "#5C6BC0",
  rodoviaria: "#7E57C2",
  shopping: "#EC407A",
  hospital: "#EF5350",
  universidade: "#66BB6A",
  logistica: "#FFA726",
  gnv: "#26A69A",
};

// ---------- Helpers ----------
function getScoreColor(score: number): string {
  if (score >= 85) return "#C9A84C";
  if (score >= 70) return "#2196F3";
  if (score >= 55) return "#FFC107";
  if (score >= 40) return "#FF9800";
  return "#F44336";
}

// ---------- Map component (client-only via dynamic import) ----------
const HeatmapMap = dynamic(() => import("./HeatmapMap"), { ssr: false });

// ---------- Main Page ----------
export default function HeatmapPage() {
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zone, setZone] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [loadingRegion, setLoadingRegion] = useState("");
  const [loadingRegionIdx, setLoadingRegionIdx] = useState(0);
  const [totalRegions, setTotalRegions] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [regionFilter, setRegionFilter] = useState<string | null>(null);
  const [selectedPointIdx, setSelectedPointIdx] = useState<number | null>(null);
  const [showChargers, setShowChargers] = useState(true);
  const [showMobility, setShowMobility] = useState(true);
  const [loadingChargers, setLoadingChargers] = useState(false);
  const [loadingMobility, setLoadingMobility] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<
    "pontos" | "concorrentes" | "mobilidade"
  >("pontos");
  const abortRef = useRef<AbortController | null>(null);

  // Fetch chargers in background after map renders
  const fetchChargersBackground = useCallback(
    async (cityName: string, stateName: string) => {
      setLoadingChargers(true);
      try {
        const res = await fetch("/api/analyze-city/chargers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ city: cityName, state: stateName }),
        });
        const data = await res.json();
        if (res.ok && data.chargers) {
          setResult((prev) =>
            prev ? { ...prev, chargers: data.chargers } : prev
          );
        }
      } catch (err) {
        console.error("Erro ao buscar concorrentes:", err);
      } finally {
        setLoadingChargers(false);
      }
    },
    []
  );

  // Fetch mobility zones in background after map renders
  const fetchMobilityBackground = useCallback(
    async (cityName: string, stateName: string) => {
      setLoadingMobility(true);
      try {
        const res = await fetch("/api/analyze-city/mobility", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ city: cityName, state: stateName }),
        });
        const data = await res.json();
        if (res.ok && data.mobilityZones) {
          setResult((prev) =>
            prev ? { ...prev, mobilityZones: data.mobilityZones } : prev
          );
        }
      } catch (err) {
        console.error("Erro ao buscar zonas de mobilidade:", err);
      } finally {
        setLoadingMobility(false);
      }
    },
    []
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!city.trim() || !state.trim()) return;
      setError("");
      setResult(null);
      setLoading(true);
      setLoadingMessage("Buscando dados da cidade no IBGE e OpenChargeMap...");
      setLoadingRegion("");
      setLoadingRegionIdx(0);
      setTotalRegions(0);
      setCategoryFilter(null);
      setRegionFilter(null);
      setSelectedPointIdx(null);
      setSidebarTab("pontos");
      setShowChargers(true);
      setShowMobility(true);

      const trimmedCity = city.trim();
      const trimmedState = state.trim();
      const trimmedZone = zone.trim();

      abortRef.current = new AbortController();

      try {
        const res = await fetch("/api/analyze-city", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            city: trimmedCity,
            state: trimmedState,
            zone: trimmedZone || undefined,
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Erro desconhecido");
        }

        // Consumir stream linha a linha
        const reader = res.body?.getReader();
        if (!reader) throw new Error("Stream indisponível");

        const decoder = new TextDecoder();
        let buffer = "";
        let completedRegions = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);

              if (msg.type === "meta") {
                setTotalRegions(msg.totalRegions);
                setLoadingMessage(
                  `Analisando ${msg.city}-${msg.state} (${msg.totalRegions} ${msg.totalRegions === 1 ? "região" : "regiões"})...`
                );
              } else if (msg.type === "progress") {
                setLoadingRegionIdx(msg.regionIndex);
                setLoadingRegion(msg.region);
                setLoadingMessage(
                  `Analisando ${msg.region}... (${msg.regionIndex + 1}/${msg.totalRegions})`
                );
              } else if (msg.type === "region_complete") {
                completedRegions++;
                setLoadingMessage(
                  `Analisando regiões... (${completedRegions} concluída${completedRegions > 1 ? "s" : ""})`
                );
              } else if (msg.type === "region_error") {
                completedRegions++;
                console.error(`Erro na região ${msg.region}: ${msg.error}`);
              } else if (msg.type === "complete") {
                // Mostrar tudo de uma vez: pontos + concorrentes
                setResult({
                  city: msg.city,
                  state: msg.state,
                  population: msg.population,
                  points: msg.points,
                  chargers: msg.competitors || [],
                  mobilityZones: [],
                });
                setLoading(false);
                setLoadingRegion("");

                // Buscar mobilidade em background (concorrentes já vieram inline)
                fetchMobilityBackground(trimmedCity, trimmedState);

                // Se OpenChargeMap retornou 0, tentar buscar via endpoint separado (fallback)
                if (!msg.competitors || msg.competitors.length === 0) {
                  console.log('OpenChargeMap retornou 0 concorrentes, tentando fallback...');
                  fetchChargersBackground(trimmedCity, trimmedState);
                }
              }
            } catch {
              // linha não é JSON válido, ignorar
            }
          }
        }

        // Garantir que loading terminou
        setLoading(false);
        setLoadingRegion("");
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : "Erro ao analisar cidade"
        );
        setLoading(false);
      }
    },
    [city, state, zone, fetchChargersBackground, fetchMobilityBackground]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Filtered points
  const filteredPoints = result
    ? result.points.filter((p) => {
        if (categoryFilter && p.category !== categoryFilter) return false;
        if (regionFilter && p.region !== regionFilter) return false;
        return true;
      })
    : [];

  // Stats
  const stats = result
    ? {
        total: result.points.length,
        premium: result.points.filter((p) => p.classification === "PREMIUM")
          .length,
        strategic: result.points.filter(
          (p) => p.classification === "ESTRATEGICO"
        ).length,
        viable: result.points.filter((p) => p.classification === "VIAVEL")
          .length,
        avgScore:
          result.points.length > 0
            ? Math.round(
                result.points.reduce((sum, p) => sum + p.score, 0) /
                  result.points.length
              )
            : 0,
        chargers: result.chargers.length,
        mobilityZones: result.mobilityZones.length,
      }
    : null;

  // Available categories
  const categories = result
    ? [...new Set(result.points.map((p) => p.category))].sort()
    : [];

  // Available regions
  const regions = result
    ? [...new Set(result.points.map((p) => p.region).filter(Boolean))]
    : [];

  // Mobility zone type counts
  const mobilityTypeCounts = result
    ? result.mobilityZones.reduce(
        (acc, z) => {
          acc[z.typeLabel] = (acc[z.typeLabel] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      )
    : {};

  // ========== EXPORT HTML ==========
  const handleExportHTML = useCallback(() => {
    if (!result) return;

    const points = result.points.map((p) => ({
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      address: p.address,
      category: p.category,
      categoryLabel: CATEGORY_LABELS[p.category] || p.category,
      score: p.score,
      classification: p.classification,
      classificationLabel: CLASSIFICATION_LABELS[p.classification] || p.classification,
      classColor: CLASSIFICATION_COLORS[p.classification] || "#8B949E",
      operacao_24h: p.operacao_24h,
      tempo_permanencia: p.tempo_permanencia,
      pontos_fortes: p.pontos_fortes,
      pontos_atencao: p.pontos_atencao,
      region: p.region || "",
      chargers_in_2km: p.chargers_in_2km || 0,
    }));

    const competitors = result.chargers.map((c) => ({
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      address: c.address,
      operator: c.operator,
      powerKW: c.powerKW,
      isFastCharge: c.isFastCharge,
      isOperational: c.isOperational,
      source: c.source || "Google Places",
    }));

    const statsData = {
      total: result.points.length,
      premium: result.points.filter((p) => p.classification === "PREMIUM").length,
      strategic: result.points.filter((p) => p.classification === "ESTRATEGICO").length,
      viable: result.points.filter((p) => p.classification === "VIAVEL").length,
      marginal: result.points.filter((p) => p.classification === "MARGINAL").length,
      rejected: result.points.filter((p) => p.classification === "REJEITADO").length,
      avgScore: result.points.length > 0 ? Math.round(result.points.reduce((s, p) => s + p.score, 0) / result.points.length) : 0,
      chargers: result.chargers.length,
      population: result.population,
    };

    const categoriesData = [...new Set(result.points.map((p) => p.category))].sort();

    const now = new Date();
    const dateStr = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

    const centerLat = points.length > 0 ? points.reduce((s, p) => s + p.lat, 0) / points.length : -15.78;
    const centerLng = points.length > 0 ? points.reduce((s, p) => s + p.lng, 0) / points.length : -47.93;

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mapa de Calor BLEV - ${result.city}, ${result.state}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0D1117; color: #C9D1D9; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
  a { color: #C9A84C; }

  .header { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; background: #161B22; border-bottom: 1px solid #30363D; }
  .header h1 { font-size: 18px; color: #C9A84C; font-weight: 700; }
  .header h1 span { color: #8B949E; font-weight: 400; font-size: 14px; margin-left: 8px; }
  .header-right { font-size: 12px; color: #8B949E; }

  .main { display: flex; flex: 1; overflow: hidden; }

  .sidebar { width: 30%; min-width: 300px; max-width: 420px; display: flex; flex-direction: column; background: #161B22; border-right: 1px solid #30363D; overflow: hidden; }

  .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 12px; border-bottom: 1px solid #30363D; }
  .stat-card { background: #0D1117; border: 1px solid #30363D; border-radius: 8px; padding: 8px; text-align: center; }
  .stat-card .label { font-size: 9px; color: #8B949E; text-transform: uppercase; letter-spacing: 0.5px; }
  .stat-card .value { font-size: 20px; font-weight: 700; margin-top: 2px; }

  .filters { padding: 10px 12px; border-bottom: 1px solid #30363D; }
  .filters-title { font-size: 10px; color: #8B949E; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  .filter-pills { display: flex; flex-wrap: wrap; gap: 4px; }
  .pill { padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer; border: none; transition: all 0.2s; }
  .pill.active { background: #C9A84C; color: #0D1117; }
  .pill:not(.active) { background: #21262D; color: #8B949E; }
  .pill:not(.active):hover { color: #C9D1D9; }

  .point-list { flex: 1; overflow-y: auto; }
  .point-list::-webkit-scrollbar { width: 6px; }
  .point-list::-webkit-scrollbar-track { background: #161B22; }
  .point-list::-webkit-scrollbar-thumb { background: #30363D; border-radius: 3px; }

  .point-item { padding: 10px 12px; border-bottom: 1px solid #30363D; cursor: pointer; transition: background 0.15s; display: flex; align-items: flex-start; gap: 10px; }
  .point-item:hover { background: #21262D; }
  .point-item.selected { background: #21262D; border-left: 3px solid #C9A84C; }
  .point-info { flex: 1; min-width: 0; }
  .point-name { font-size: 13px; font-weight: 600; color: #E6EDF3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .point-addr { font-size: 11px; color: #8B949E; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .point-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .tag { padding: 1px 6px; border-radius: 3px; font-size: 9px; font-weight: 700; }
  .score-box { text-align: center; padding: 4px 8px; border-radius: 8px; flex-shrink: 0; }
  .score-val { font-size: 18px; font-weight: 800; line-height: 1; }
  .score-label { font-size: 8px; color: #8B949E; }

  .map-container { flex: 1; position: relative; }
  #map { width: 100%; height: 100%; }

  .footer { display: flex; align-items: center; justify-content: space-between; padding: 8px 20px; background: #161B22; border-top: 1px solid #30363D; font-size: 11px; color: #8B949E; }

  .leaflet-popup-content-wrapper { background: #161B22; color: #C9D1D9; border: 1px solid #30363D; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
  .leaflet-popup-tip { background: #161B22; border: 1px solid #30363D; }
  .leaflet-popup-content { margin: 10px 12px; font-size: 12px; line-height: 1.5; }
  .popup-name { font-weight: 700; font-size: 13px; color: #E6EDF3; }
  .popup-addr { color: #8B949E; font-size: 11px; }
  .popup-score { font-weight: 800; font-size: 16px; }
  .popup-class { font-weight: 700; font-size: 11px; padding: 1px 6px; border-radius: 3px; display: inline-block; margin-top: 4px; }

  @media (max-width: 768px) {
    .main { flex-direction: column; }
    .sidebar { width: 100%; max-width: none; min-width: 0; max-height: 45vh; }
    .map-container { min-height: 45vh; }
    .stats-grid { grid-template-columns: repeat(3, 1fr); }
  }
</style>
</head>
<body>
<div class="header">
  <h1>BLEV Intelligence<span>${result.city}, ${result.state}${statsData.population ? ' | Pop: ' + statsData.population.toLocaleString('pt-BR') + ' hab.' : ''}</span></h1>
  <div class="header-right">Mapa de Calor</div>
</div>

<div class="main">
  <div class="sidebar">
    <div class="stats-grid">
      <div class="stat-card"><div class="label">Pontos</div><div class="value" style="color:#E6EDF3">${statsData.total}</div></div>
      <div class="stat-card"><div class="label">Premium</div><div class="value" style="color:#C9A84C">${statsData.premium}</div></div>
      <div class="stat-card"><div class="label">Estrat&eacute;gicos</div><div class="value" style="color:#2196F3">${statsData.strategic}</div></div>
      <div class="stat-card"><div class="label">Vi&aacute;veis</div><div class="value" style="color:#FFC107">${statsData.viable}</div></div>
      <div class="stat-card"><div class="label">Score M&eacute;dio</div><div class="value" style="color:#C9A84C">${statsData.avgScore}</div></div>
      <div class="stat-card"><div class="label">Concorrentes</div><div class="value" style="color:#F44336">${statsData.chargers}</div></div>
    </div>

    <div class="filters">
      <div class="filters-title">Filtrar por categoria</div>
      <div class="filter-pills" id="filterPills"></div>
    </div>

    <div class="point-list" id="pointList"></div>
  </div>

  <div class="map-container">
    <div id="map"></div>
  </div>
</div>

<div class="footer">
  <div>BLEV Educa&ccedil;&atilde;o | @guilhermegbbento</div>
  <div>Gerado em ${dateStr}</div>
</div>

<script>
const points = ${JSON.stringify(points)};
const competitors = ${JSON.stringify(competitors)};
const categories = ${JSON.stringify(categoriesData)};
const CATEGORY_LABELS = ${JSON.stringify(CATEGORY_LABELS)};

function getScoreColor(score) {
  if (score >= 85) return '#C9A84C';
  if (score >= 70) return '#2196F3';
  if (score >= 55) return '#FFC107';
  if (score >= 40) return '#FF9800';
  return '#F44336';
}

// State
let activeFilter = null;
let selectedIdx = null;

// Map
const map = L.map('map', { zoomControl: true }).setView([${centerLat}, ${centerLng}], 12);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; CartoDB',
  maxZoom: 19
}).addTo(map);

// Markers
const pointMarkers = [];
const competitorMarkers = [];

function createCircleIcon(color, size) {
  return L.divIcon({
    className: '',
    html: '<div style="width:'+size+'px;height:'+size+'px;border-radius:50%;background:'+color+';border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.5);"></div>',
    iconSize: [size, size],
    iconAnchor: [size/2, size/2],
    popupAnchor: [0, -size/2]
  });
}

function renderPoints() {
  // Clear existing
  pointMarkers.forEach(m => map.removeLayer(m));
  pointMarkers.length = 0;

  const filtered = activeFilter ? points.filter(p => p.category === activeFilter) : points;

  filtered.forEach((p, i) => {
    const globalIdx = points.indexOf(p);
    const color = p.classColor;
    const size = p.score >= 85 ? 16 : p.score >= 70 ? 14 : 12;
    const marker = L.marker([p.lat, p.lng], { icon: createCircleIcon(color, size) })
      .bindPopup(
        '<div class="popup-name">' + p.name + '</div>' +
        '<div class="popup-addr">' + p.address + '</div>' +
        '<div style="margin-top:6px"><span class="popup-score" style="color:' + getScoreColor(p.score) + '">' + p.score + '</span> <span style="color:#8B949E;font-size:11px">/ 100</span></div>' +
        '<span class="popup-class" style="background:' + color + '20;color:' + color + '">' + p.classificationLabel + '</span>' +
        '<span class="tag" style="background:#21262D;color:#8B949E;margin-left:4px">' + p.categoryLabel + '</span>' +
        (p.operacao_24h ? '<span class="tag" style="background:#C9A84C20;color:#C9A84C;margin-left:4px">24H</span>' : '') +
        (p.chargers_in_2km > 0 ? '<span class="tag" style="background:#F4433620;color:#F44336;margin-left:4px">' + p.chargers_in_2km + ' DC 2km</span>' : '') +
        (p.pontos_fortes && p.pontos_fortes.length ? '<div style="margin-top:6px;font-size:10px;color:#66BB6A">+ ' + p.pontos_fortes.join('<br>+ ') + '</div>' : '')
      )
      .addTo(map);
    marker._globalIdx = globalIdx;
    pointMarkers.push(marker);
  });

  // Competitors
  competitorMarkers.forEach(m => map.removeLayer(m));
  competitorMarkers.length = 0;
  competitors.forEach(c => {
    const marker = L.marker([c.lat, c.lng], {
      icon: createCircleIcon('#F44336', 10)
    })
    .bindPopup(
      '<div class="popup-name" style="color:#F44336">' + c.name + '</div>' +
      '<div class="popup-addr">' + c.address + '</div>' +
      '<div style="margin-top:4px">' +
        '<span class="tag" style="background:#F4433620;color:#F44336">CONCORRENTE</span> ' +
        '<span class="tag" style="background:' + (c.isFastCharge ? '#FF980020;color:#FF9800' : '#42A5F520;color:#42A5F5') + '">' + (c.isFastCharge ? 'DC' : 'AC') + '</span> ' +
        (c.powerKW > 0 ? '<span class="tag" style="background:#21262D;color:#8B949E">' + c.powerKW + 'kW</span> ' : '') +
        (c.operator && c.operator !== 'Verificar' && c.operator !== 'Desconhecido' ? '<span class="tag" style="background:#21262D;color:#8B949E">' + c.operator + '</span>' : '') +
      '</div>'
    )
    .addTo(map);
    competitorMarkers.push(marker);
  });
}

function renderList() {
  const list = document.getElementById('pointList');
  const filtered = activeFilter ? points.filter(p => p.category === activeFilter) : points;

  list.innerHTML = filtered.map((p, i) => {
    const globalIdx = points.indexOf(p);
    const scoreColor = getScoreColor(p.score);
    return '<div class="point-item' + (selectedIdx === globalIdx ? ' selected' : '') + '" data-idx="' + globalIdx + '">' +
      '<div class="point-info">' +
        '<div class="point-name">' + p.name + '</div>' +
        '<div class="point-addr">' + p.address + '</div>' +
        '<div class="point-tags">' +
          '<span class="tag" style="background:#21262D;color:#8B949E">' + p.categoryLabel + '</span>' +
          '<span class="tag" style="background:' + p.classColor + '20;color:' + p.classColor + '">' + p.classificationLabel + '</span>' +
          (p.operacao_24h ? '<span class="tag" style="background:#C9A84C20;color:#C9A84C">24H</span>' : '') +
          (p.chargers_in_2km > 0 ? '<span class="tag" style="background:#F4433620;color:#F44336">' + p.chargers_in_2km + ' DC 2km</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="score-box" style="background:' + scoreColor + '15">' +
        '<div class="score-val" style="color:' + scoreColor + '">' + p.score + '</div>' +
        '<div class="score-label">score</div>' +
      '</div>' +
    '</div>';
  }).join('');

  // Click handlers
  list.querySelectorAll('.point-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx);
      selectedIdx = idx;
      const p = points[idx];
      map.setView([p.lat, p.lng], 16);
      // Open popup
      const marker = pointMarkers.find(m => m._globalIdx === idx);
      if (marker) marker.openPopup();
      renderList();
    });
  });
}

function renderFilters() {
  const container = document.getElementById('filterPills');
  let html = '<button class="pill' + (!activeFilter ? ' active' : '') + '" data-cat="">Todos (' + points.length + ')</button>';
  categories.forEach(cat => {
    const count = points.filter(p => p.category === cat).length;
    html += '<button class="pill' + (activeFilter === cat ? ' active' : '') + '" data-cat="' + cat + '">' + (CATEGORY_LABELS[cat] || cat) + ' (' + count + ')</button>';
  });
  container.innerHTML = html;
  container.querySelectorAll('.pill').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.cat || null;
      selectedIdx = null;
      renderFilters();
      renderPoints();
      renderList();
    });
  });
}

// Initial render
renderFilters();
renderPoints();
renderList();

// Fit bounds
if (points.length > 0) {
  const allCoords = points.map(p => [p.lat, p.lng]).concat(competitors.map(c => [c.lat, c.lng]));
  map.fitBounds(allCoords, { padding: [30, 30] });
}
<\/script>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Mapa_Calor_BLEV_${result.city}_${result.state}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result]);

  // ========== RENDER ==========

  // Initial form state
  if (!result && !loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white">Mapa de Calor</h1>
        <p className="mt-1 text-[#8B949E]">
          Descubra os melhores pontos para instalação de eletropostos na cidade.
        </p>

        <div className="mt-8 flex items-center justify-center">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-lg rounded-xl border border-[#30363D] bg-[#161B22] p-8"
          >
            <h2 className="mb-6 text-lg font-semibold text-white">
              Analisar Cidade
            </h2>

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
              <div>
                <label className="mb-2 block text-sm font-medium text-[#8B949E]">
                  Região específica (opcional)
                </label>
                <input
                  type="text"
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                  placeholder="Ex: Zona Sul de SP, Batel Curitiba, Entorno do DF"
                  className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-3 text-white placeholder-[#484F58] outline-none transition-colors focus:border-[#C9A84C]"
                />
                <p className="mt-1 text-xs text-[#484F58]">
                  Se preenchido, faz análise focada com 50 pontos só nessa
                  região
                </p>
              </div>
            </div>

            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              className="mt-6 w-full rounded-lg bg-[#C9A84C] px-4 py-3 font-semibold text-[#0D1117] transition-colors hover:bg-[#B89443]"
            >
              Analisar Cidade
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Loading state (shown until ALL regions complete)
  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white">Mapa de Calor</h1>
        <p className="mt-1 text-[#8B949E]">
          Analisando {city} - {state}
          {zone ? ` (${zone})` : ""}...
        </p>

        <div className="mt-16 flex flex-col items-center justify-center gap-8">
          <div className="relative h-20 w-20">
            <div className="absolute inset-0 rounded-full border-4 border-[#30363D]" />
            <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-[#C9A84C]" />
          </div>

          <div className="space-y-3 text-center">
            <p className="text-sm font-medium text-[#C9A84C]">
              {loadingMessage}
            </p>
            {totalRegions > 1 && (
              <div className="mx-auto mt-4 w-64">
                <div className="mb-2 flex justify-between text-xs text-[#8B949E]">
                  <span>
                    Região {loadingRegionIdx + 1} de {totalRegions}
                  </span>
                  <span>
                    {Math.round(((loadingRegionIdx + 1) / totalRegions) * 100)}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-[#30363D]">
                  <div
                    className="h-full rounded-full bg-[#C9A84C] transition-all duration-500"
                    style={{
                      width: `${((loadingRegionIdx + 1) / totalRegions) * 100}%`,
                    }}
                  />
                </div>
                {loadingRegion && (
                  <p className="mt-2 text-xs text-[#8B949E]">
                    {loadingRegion}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Results (may still be loading more regions)
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Mapa de Calor — {result!.city}, {result!.state}
          </h1>
          <p className="mt-1 text-[#8B949E]">
            {result!.population
              ? `Pop: ${result!.population.toLocaleString("pt-BR")} hab. | `
              : ""}
            {result!.points.length} pontos sugeridos
            {loadingChargers
              ? " | Buscando concorrentes..."
              : result!.chargers.length > 0
                ? ` | ${result!.chargers.length} concorrentes`
                : ""}
            {loadingMobility
              ? " | Buscando zonas de mobilidade..."
              : result!.mobilityZones.length > 0
                ? ` | ${result!.mobilityZones.length} zonas de mobilidade`
                : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExportHTML}
            className="rounded-lg border border-[#C9A84C] px-4 py-2 text-sm font-medium text-[#C9A84C] transition-colors hover:bg-[#C9A84C] hover:text-[#0D1117]"
          >
            Exportar HTML
          </button>
          <button
            onClick={() => {
              abortRef.current?.abort();
              setResult(null);
              setCity("");
              setState("");
              setZone("");
              setLoading(false);
            }}
            className="rounded-lg border border-[#30363D] px-4 py-2 text-sm text-[#8B949E] transition-colors hover:border-[#C9A84C] hover:text-white"
          >
            Nova Análise
          </button>
        </div>
      </div>

      {/* Progressive loading banner */}
      {loading && loadingRegion && (
        <div className="mt-2 flex items-center gap-3 rounded-lg border border-[#C9A84C30] bg-[#C9A84C10] px-4 py-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#C9A84C30] border-t-[#C9A84C]" />
          <span className="text-sm text-[#C9A84C]">
            {loadingMessage}
          </span>
          <div className="ml-auto h-1.5 w-32 rounded-full bg-[#30363D]">
            <div
              className="h-full rounded-full bg-[#C9A84C] transition-all duration-500"
              style={{
                width: `${totalRegions > 0 ? ((loadingRegionIdx + 1) / totalRegions) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Stats Bar */}
      {stats && (
        <div className="mt-4 grid grid-cols-7 gap-2">
          {[
            { label: "Pontos", value: stats.total, color: "text-white" },
            {
              label: "Premium",
              value: stats.premium,
              color: "text-[#C9A84C]",
            },
            {
              label: "Estratégicos",
              value: stats.strategic,
              color: "text-[#2196F3]",
            },
            { label: "Viáveis", value: stats.viable, color: "text-[#FFC107]" },
            {
              label: "Score Médio",
              value: stats.avgScore,
              color: "text-[#C9A84C]",
            },
            {
              label: "Concorrentes",
              value: loadingChargers ? "..." : stats.chargers,
              color: "text-[#F44336]",
            },
            {
              label: "Zonas Mob.",
              value: loadingMobility ? "..." : stats.mobilityZones,
              color: "text-[#42A5F5]",
            },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-lg border border-[#30363D] bg-[#161B22] px-2 py-3 text-center"
            >
              <p className="text-[10px] text-[#8B949E]">{s.label}</p>
              <p className={`mt-1 text-xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Main content: sidebar + map */}
      <div className="mt-4 flex flex-1 gap-4 overflow-hidden">
        {/* Sidebar */}
        <div className="flex w-80 shrink-0 flex-col rounded-xl border border-[#30363D] bg-[#161B22]">
          {/* Sidebar Tabs */}
          <div className="flex border-b border-[#30363D]">
            <button
              onClick={() => setSidebarTab("pontos")}
              className={`flex-1 px-2 py-2.5 text-[11px] font-medium transition-colors ${
                sidebarTab === "pontos"
                  ? "border-b-2 border-[#C9A84C] text-[#C9A84C]"
                  : "text-[#8B949E] hover:text-white"
              }`}
            >
              Pontos ({result?.points.length})
            </button>
            <button
              onClick={() => setSidebarTab("concorrentes")}
              className={`flex-1 px-2 py-2.5 text-[11px] font-medium transition-colors ${
                sidebarTab === "concorrentes"
                  ? "border-b-2 border-[#F44336] text-[#F44336]"
                  : "text-[#8B949E] hover:text-white"
              }`}
            >
              Concorrentes (
              {loadingChargers ? "..." : result?.chargers.length})
            </button>
            <button
              onClick={() => setSidebarTab("mobilidade")}
              className={`flex-1 px-2 py-2.5 text-[11px] font-medium transition-colors ${
                sidebarTab === "mobilidade"
                  ? "border-b-2 border-[#42A5F5] text-[#42A5F5]"
                  : "text-[#8B949E] hover:text-white"
              }`}
            >
              Mobilidade (
              {loadingMobility ? "..." : result?.mobilityZones.length})
            </button>
          </div>

          {/* ===== TAB: Pontos ===== */}
          {sidebarTab === "pontos" && (
            <>
              <div className="border-b border-[#30363D] p-3">
                {/* Region filter */}
                {regions.length > 1 && (
                  <div className="mb-3">
                    <p className="mb-1.5 text-xs font-medium text-[#8B949E] uppercase tracking-wide">
                      Filtrar por região
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => setRegionFilter(null)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          regionFilter === null
                            ? "bg-[#2196F3] text-white"
                            : "bg-[#21262D] text-[#8B949E] hover:text-white"
                        }`}
                      >
                        Todas
                      </button>
                      {regions.map((r) => {
                        const count = result!.points.filter(
                          (p) => p.region === r
                        ).length;
                        // Mostrar nome curto (sem "de CidadeName")
                        const shortName =
                          r?.replace(/ de .+$/, "") || r || "?";
                        return (
                          <button
                            key={r}
                            onClick={() =>
                              setRegionFilter(regionFilter === r ? null : r!)
                            }
                            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                              regionFilter === r
                                ? "bg-[#2196F3] text-white"
                                : "bg-[#21262D] text-[#8B949E] hover:text-white"
                            }`}
                          >
                            {shortName} ({count})
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Category filter */}
                <p className="mb-1.5 text-xs font-medium text-[#8B949E] uppercase tracking-wide">
                  Filtrar por categoria
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setCategoryFilter(null)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      categoryFilter === null
                        ? "bg-[#C9A84C] text-[#0D1117]"
                        : "bg-[#21262D] text-[#8B949E] hover:text-white"
                    }`}
                  >
                    Todos ({result?.points.length})
                  </button>
                  {categories.map((cat) => {
                    const count = result!.points.filter(
                      (p) => p.category === cat
                    ).length;
                    return (
                      <button
                        key={cat}
                        onClick={() =>
                          setCategoryFilter(
                            categoryFilter === cat ? null : cat
                          )
                        }
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          categoryFilter === cat
                            ? "bg-[#C9A84C] text-[#0D1117]"
                            : "bg-[#21262D] text-[#8B949E] hover:text-white"
                        }`}
                      >
                        {CATEGORY_LABELS[cat] || cat} ({count})
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {filteredPoints.map((point, idx) => {
                  const globalIdx = result!.points.indexOf(point);
                  const scoreColor = getScoreColor(point.score);
                  const classColor =
                    CLASSIFICATION_COLORS[point.classification] || "#8B949E";
                  return (
                    <button
                      key={`${point.lat}-${point.lng}-${idx}`}
                      onClick={() => setSelectedPointIdx(globalIdx)}
                      className={`w-full border-b border-[#30363D] p-3 text-left transition-colors hover:bg-[#21262D] ${
                        selectedPointIdx === globalIdx
                          ? "bg-[#21262D] border-l-2 border-l-[#C9A84C]"
                          : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white">
                            {point.name}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-[#8B949E]">
                            {point.address}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-[#21262D] px-1.5 py-0.5 text-[10px] font-medium text-[#8B949E]">
                              {CATEGORY_LABELS[point.category] ||
                                point.category}
                            </span>
                            <span
                              className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                              style={{
                                backgroundColor: classColor + "20",
                                color: classColor,
                              }}
                            >
                              {CLASSIFICATION_LABELS[point.classification] ||
                                point.classification}
                            </span>
                            {point.operacao_24h && (
                              <span className="rounded bg-[#C9A84C20] px-1.5 py-0.5 text-[10px] font-bold text-[#C9A84C]">
                                24H
                              </span>
                            )}
                            {typeof point.chargers_in_2km === "number" &&
                              point.chargers_in_2km > 0 && (
                                <span className="rounded bg-[#F4433620] px-1.5 py-0.5 text-[10px] font-bold text-[#F44336]">
                                  {point.chargers_in_2km} DC 2km
                                </span>
                              )}
                          </div>
                        </div>
                        <div
                          className="flex shrink-0 flex-col items-center rounded-lg px-2 py-1"
                          style={{ backgroundColor: scoreColor + "15" }}
                        >
                          <span
                            className="text-lg font-bold leading-tight"
                            style={{ color: scoreColor }}
                          >
                            {point.score}
                          </span>
                          <span className="text-[9px] text-[#8B949E]">
                            score
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* ===== TAB: Concorrentes ===== */}
          {sidebarTab === "concorrentes" && (
            <>
              <div className="border-b border-[#30363D] p-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showChargers}
                    onChange={(e) => setShowChargers(e.target.checked)}
                    className="h-4 w-4 rounded border-[#30363D] bg-[#0D1117] accent-[#F44336]"
                  />
                  <span className="text-xs text-[#8B949E]">
                    Mostrar no mapa
                  </span>
                </label>
                <p className="mt-2 text-xs text-[#8B949E]">
                  {loadingChargers
                    ? "Buscando carregadores existentes..."
                    : `${result!.chargers.length} carregadores encontrados via OpenChargeMap`}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto">
                {loadingChargers ? (
                  <div className="flex items-center justify-center p-8">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#30363D] border-t-[#F44336]" />
                    <span className="ml-3 text-sm text-[#8B949E]">
                      Carregando...
                    </span>
                  </div>
                ) : result!.chargers.length === 0 ? (
                  <div className="p-4 text-center text-sm text-[#8B949E]">
                    Nenhum carregador existente encontrado na cidade.
                  </div>
                ) : (
                  result!.chargers.map((charger, idx) => (
                    <div
                      key={`charger-${charger.lat}-${charger.lng}-${idx}`}
                      className="border-b border-[#30363D] p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white">
                            {charger.name}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-[#8B949E]">
                            {charger.address}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-[#F4433620] px-1.5 py-0.5 text-[10px] font-bold text-[#F44336]">
                              CONCORRENTE
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${charger.isFastCharge ? "bg-[#FF980020] text-[#FF9800]" : "bg-[#42A5F520] text-[#42A5F5]"}`}
                            >
                              {charger.isFastCharge ? "DC" : "AC"}
                            </span>
                            {charger.operator &&
                              charger.operator !== "Desconhecido" && (
                                <span className="rounded bg-[#21262D] px-1.5 py-0.5 text-[10px] text-[#8B949E]">
                                  {charger.operator}
                                </span>
                              )}
                            {!charger.isOperational && (
                              <span className="rounded bg-[#F4433620] px-1.5 py-0.5 text-[10px] text-[#F44336]">
                                Inativo
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-center rounded-lg bg-[#FF980015] px-2 py-1">
                          <span className="text-lg font-bold leading-tight text-[#FF9800]">
                            {charger.powerKW > 0 ? charger.powerKW : "?"}
                          </span>
                          <span className="text-[9px] text-[#8B949E]">kW</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {/* ===== TAB: Mobilidade ===== */}
          {sidebarTab === "mobilidade" && (
            <>
              <div className="border-b border-[#30363D] p-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showMobility}
                    onChange={(e) => setShowMobility(e.target.checked)}
                    className="h-4 w-4 rounded border-[#30363D] bg-[#0D1117] accent-[#42A5F5]"
                  />
                  <span className="text-xs text-[#8B949E]">
                    Mostrar zonas no mapa
                  </span>
                </label>
                <p className="mt-2 text-xs text-[#8B949E]">
                  {loadingMobility
                    ? "Buscando zonas de mobilidade profissional..."
                    : `${result!.mobilityZones.length} pontos de mobilidade profissional mapeados via Google Places`}
                </p>
                {/* Type summary pills */}
                {!loadingMobility && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(mobilityTypeCounts).map(
                      ([label, count]) => (
                        <span
                          key={label}
                          className="rounded bg-[#21262D] px-1.5 py-0.5 text-[10px] text-[#8B949E]"
                        >
                          {label}: {count}
                        </span>
                      )
                    )}
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto">
                {loadingMobility ? (
                  <div className="flex items-center justify-center p-8">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#30363D] border-t-[#42A5F5]" />
                    <span className="ml-3 text-sm text-[#8B949E]">
                      Carregando...
                    </span>
                  </div>
                ) : result!.mobilityZones.length === 0 ? (
                  <div className="p-4 text-center text-sm text-[#8B949E]">
                    Nenhuma zona de mobilidade encontrada.
                  </div>
                ) : (
                  result!.mobilityZones.map((zone, idx) => (
                    <div
                      key={`zone-${zone.lat}-${zone.lng}-${idx}`}
                      className="border-b border-[#30363D] p-3"
                    >
                      <div className="flex items-start gap-2">
                        {/* Color dot */}
                        <div
                          className="mt-1 h-3 w-3 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              MOBILITY_TYPE_COLORS[zone.type] || "#42A5F5",
                            boxShadow: `0 0 6px ${MOBILITY_TYPE_COLORS[zone.type] || "#42A5F5"}80`,
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white">
                            {zone.name}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-[#8B949E]">
                            {zone.address}
                          </p>
                          <span
                            className="mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold"
                            style={{
                              backgroundColor: `${MOBILITY_TYPE_COLORS[zone.type] || "#42A5F5"}20`,
                              color:
                                MOBILITY_TYPE_COLORS[zone.type] || "#42A5F5",
                            }}
                          >
                            {zone.typeLabel}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Map */}
        <div className="flex-1 overflow-hidden rounded-xl border border-[#30363D]">
          <HeatmapMap
            points={filteredPoints}
            allPoints={result!.points}
            chargers={showChargers ? result!.chargers : []}
            mobilityZones={showMobility ? result!.mobilityZones : []}
            selectedPointIdx={selectedPointIdx}
            onSelectPoint={setSelectedPointIdx}
          />
        </div>
      </div>
    </div>
  );
}
