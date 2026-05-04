"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line,
} from "recharts";
import CityStateSelect from "@/components/CityStateSelect";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ===================== TYPES =====================

interface Panel1Data {
  city: string; state: string;
  lat: number; lng: number;
  bounds: { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } } | null;
  population: number; gdpPerCapita: number;
  totalVehicles: number; evs: number;
  vendasAno?: number;
  fonteEVs?: string;
  isEstimateEVs?: boolean;
  vendasEstado2025?: number | null;
  stateAbbr?: string;
  abveNacional?: {
    vendas2025: number;
    crescimento2025pct: number;
    marketShareFev2026pct: number;
    projecaoABVE2026: number;
    projecaoMercado2026: number;
    lastUpdate: string;
    fonte: string;
  };
  chargersExisting: number;
  totalCarregadosComBr: number | null;
  ratio: string; marketPhase: string;
  cityScore: number | null;
}

type TypeConfidence = "confirmed" | "estimated" | "unknown";

interface Competitor {
  name: string; lat: number; lng: number; address: string;
  source: string; operator: string; powerKW: number; type: string;
  isFastCharge: boolean;
  typeConfidence: TypeConfidence;
  isOperational: boolean; rating: number; reviews: number;
}

interface Panel2Data {
  competitors: Competitor[];
  total: number; dc: number; ac: number;
  dcConfirmed: number; dcEstimated: number;
  acConfirmed: number; acEstimated: number;
  unknown: number;
  realCompetition: number;
  operators: string[];
}

interface GridCell {
  row: number; col: number; centerLat: number; centerLng: number;
  chargerCount: number; status: "opportunity" | "moderate" | "saturated";
  nearbyPremiumPOIs: string[];
}

interface Panel3Data {
  grid: GridCell[];
  totalCells: number; opportunityCells: number; moderateCells: number; saturatedCells: number;
}

interface PlaceResult { name: string; lat: number; lng: number; address: string; rating: number | null; reviews: number | null; }

interface Panel4Data {
  corridors: PlaceResult[];
  totalCorridorPOIs: number;
}

interface DemandZone {
  category: string; label: string; color: string; radius: number; places: PlaceResult[];
}

interface Panel5Data { demandZones: DemandZone[]; }

interface SocioZone {
  lat: number; lng: number; name: string;
  classification: "Premium" | "Alta" | "Média" | "Popular";
  indicators: string[]; hasCharger: boolean;
}

interface Panel6Data {
  zones: SocioZone[];
  premiumCount: number; altaCount: number; mediaCount: number; premiumWithoutCharger: number;
}

interface ProjectionYear {
  year: number; evs: number; chargersNeeded: number; chargersExisting: number; gap: number;
}

interface Panel7Data { projections: ProjectionYear[]; currentEVs: number; currentChargers: number; }

interface Panel8Data { report: string; cityScore: number; marketPhase: string; }

// ===================== MAP COMPONENT =====================

function LeafletMap({ id, onInit }: { id: string; onInit: (map: any, L: any) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    function loadCSS(href: string) {
      if (document.querySelector(`link[href="${href}"]`)) return;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
    }

    function loadScript(src: string): Promise<void> {
      return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const script = document.createElement("script");
        script.src = src;
        script.onload = () => resolve();
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    loadCSS("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
    loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js").then(() => {
      const L = (window as any).L;
      if (!L || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        center: [-15.78, -47.93],
        zoom: 12,
        zoomControl: true,
      });

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;
      onInit(map, L);
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return <div ref={containerRef} className="h-full w-full rounded-lg" style={{ minHeight: 400, background: "#0D1117" }} />;
}

// ===================== HELPERS =====================

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Returns label, bg, fg for competitor type badge based on confidence. */
function competitorTypeBadge(c: { isFastCharge: boolean; typeConfidence: TypeConfidence }) {
  if (c.typeConfidence === "confirmed") {
    return c.isFastCharge
      ? { label: "DC", bg: "#66BB6A20", fg: "#66BB6A" }
      : { label: "AC", bg: "#8B949E20", fg: "#C9D1D9" };
  }
  if (c.typeConfidence === "estimated") {
    return c.isFastCharge
      ? { label: "DC (est.)", bg: "#FFC10720", fg: "#FFC107" }
      : { label: "AC (est.)", bg: "#FFC10720", fg: "#FFC107" };
  }
  return { label: "N/I", bg: "#8B949E20", fg: "#8B949E" };
}

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];

  function flushList() {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="list-disc pl-6 mb-4 space-y-1 text-[#C9D1D9]">
          {listItems.map((li, i) => <li key={i} dangerouslySetInnerHTML={{ __html: li.replace(/\*\*(.*?)\*\*/g, "<strong class='text-white'>$1</strong>") }} />)}
        </ul>
      );
      listItems = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ")) {
      flushList();
      elements.push(<h2 key={i} className="text-xl font-bold text-[#C9A84C] mt-6 mb-3">{line.slice(3)}</h2>);
    } else if (line.startsWith("### ")) {
      flushList();
      elements.push(<h3 key={i} className="text-lg font-semibold text-white mt-4 mb-2">{line.slice(4)}</h3>);
    } else if (line.match(/^[-*]\s/)) {
      listItems.push(line.replace(/^[-*]\s/, ""));
    } else if (line.match(/^\d+\.\s/)) {
      listItems.push(line.replace(/^\d+\.\s/, ""));
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      elements.push(
        <p key={i} className="text-[#C9D1D9] mb-3 leading-relaxed" dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.*?)\*\*/g, "<strong class='text-white'>$1</strong>") }} />
      );
    }
  }
  flushList();
  return elements;
}

// ===================== MAIN PAGE =====================

export default function MarketIntelligencePage() {
  const [city, setCity] = useState("");
  const [state, setState] = useState("SP");
  const [loading, setLoading] = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");

  const [panel1, setPanel1] = useState<Panel1Data | null>(null);
  const [panel2, setPanel2] = useState<Panel2Data | null>(null);
  const [panel3, setPanel3] = useState<Panel3Data | null>(null);
  const [panel4, setPanel4] = useState<Panel4Data | null>(null);
  const [panel5, setPanel5] = useState<Panel5Data | null>(null);
  const [panel6, setPanel6] = useState<Panel6Data | null>(null);
  const [panel7, setPanel7] = useState<Panel7Data | null>(null);
  const [panel8, setPanel8] = useState<Panel8Data | null>(null);

  const [activePanel, setActivePanel] = useState(1);

  const handleGenerate = useCallback(async () => {
    if (!city.trim()) return;
    setLoading(true);
    setProgressStep(0);
    setProgressLabel("Iniciando análise...");
    setPanel1(null); setPanel2(null); setPanel3(null); setPanel4(null);
    setPanel5(null); setPanel6(null); setPanel7(null); setPanel8(null);
    setActivePanel(1);

    try {
      const res = await fetch("/api/market-intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city: city.trim(), state }),
      });

      if (!res.ok) throw new Error("Erro na requisição");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Sem stream");

      const decoder = new TextDecoder();
      let buffer = "";

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
            if (msg.type === "progress") {
              setProgressStep(msg.step);
              setProgressLabel(msg.label);
            } else if (msg.type === "panel-update") {
              // Silent update — refresh panel data without switching active tab
              switch (msg.panel) {
                case 1: setPanel1(msg.data as Panel1Data); break;
                case 2: setPanel2(msg.data as Panel2Data); break;
                case 3: setPanel3(msg.data as Panel3Data); break;
                case 4: setPanel4(msg.data as Panel4Data); break;
                case 5: setPanel5(msg.data as Panel5Data); break;
                case 6: setPanel6(msg.data as Panel6Data); break;
                case 7: setPanel7(msg.data as Panel7Data); break;
                case 8: setPanel8(msg.data as Panel8Data); break;
              }
            } else if (msg.type === "panel") {
              switch (msg.panel) {
                case 1: setPanel1(msg.data as Panel1Data); setActivePanel(1); break;
                case 2: setPanel2(msg.data as Panel2Data); setActivePanel(2); break;
                case 3: setPanel3(msg.data as Panel3Data); setActivePanel(3); break;
                case 4: setPanel4(msg.data as Panel4Data); setActivePanel(4); break;
                case 5: setPanel5(msg.data as Panel5Data); setActivePanel(5); break;
                case 6: setPanel6(msg.data as Panel6Data); setActivePanel(6); break;
                case 7: setPanel7(msg.data as Panel7Data); setActivePanel(7); break;
                case 8: setPanel8(msg.data as Panel8Data); setActivePanel(8); break;
              }
            } else if (msg.type === "complete") {
              setLoading(false);
            }
          } catch { /* skip malformed lines */ }
        }
      }
    } catch (err) {
      console.error("Error:", err);
      alert("Erro ao gerar relatório. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, [city, state]);

  // ===================== EXPORT HTML =====================

  const handleExportHTML = useCallback(() => {
    if (!panel1) return;
    const p1 = panel1;
    const p2 = panel2;
    const p3 = panel3;
    const p4 = panel4;
    const p5 = panel5;
    const p6 = panel6;
    const p7 = panel7;
    const p8 = panel8;

    const dateStr = new Date().toLocaleDateString("pt-BR");
    const phaseColor = p1.marketPhase === "Início" ? "#66BB6A" : p1.marketPhase === "Crescimento" ? "#FFC107" : "#F44336";

    // Panel 7 - CSS bar chart
    let projectionBars = "";
    let projectionTable = "";
    if (p7) {
      const maxEvs = Math.max(...p7.projections.map((p) => p.evs), 1);
      projectionBars = p7.projections.map((p) => {
        const h = Math.max(4, (p.evs / maxEvs) * 220);
        const lbl = p.evs >= 1000 ? `${(p.evs / 1000).toFixed(1)}k` : String(p.evs);
        return `<div class="bar-col"><div class="bar-value">${lbl}</div><div class="bar" style="height:${h}px"></div><div class="bar-label">${p.year}</div></div>`;
      }).join("");
      projectionTable = p7.projections.map((p) =>
        `<tr><td>${p.year}</td><td>${p.evs.toLocaleString("pt-BR")}</td><td style="color:#66BB6A;">${p.chargersNeeded}</td><td style="color:#F44336;">${p.chargersExisting}</td><td style="color:#F44336;font-weight:bold;">${p.gap}</td></tr>`
      ).join("");
    }

    // Panel 8 - markdown to HTML
    let reportHtml = "";
    if (p8) {
      const lines = p8.report.split("\n");
      const out: string[] = [];
      let inList = false;
      const flush = () => { if (inList) { out.push("</ul>"); inList = false; } };
      for (const raw of lines) {
        const line = raw;
        if (line.startsWith("## ")) {
          flush();
          out.push(`<h2 style="color:#C9A84C;margin-top:24px;border-bottom:1px solid #30363D;padding-bottom:8px;">${escapeHtml(line.slice(3))}</h2>`);
        } else if (line.startsWith("### ")) {
          flush();
          out.push(`<h3 style="color:#fff;margin-top:16px;">${escapeHtml(line.slice(4))}</h3>`);
        } else if (/^[-*]\s/.test(line) || /^\d+\.\s/.test(line)) {
          if (!inList) { out.push('<ul style="padding-left:20px;color:#C9D1D9;">'); inList = true; }
          const content = line.replace(/^[-*]\s/, "").replace(/^\d+\.\s/, "");
          out.push(`<li>${escapeHtml(content).replace(/\*\*(.*?)\*\*/g, "<strong style='color:#fff;'>$1</strong>")}</li>`);
        } else if (line.trim() === "") {
          flush();
        } else {
          flush();
          out.push(`<p style="color:#C9D1D9;margin:8px 0;line-height:1.6;">${escapeHtml(line).replace(/\*\*(.*?)\*\*/g, "<strong style='color:#fff;'>$1</strong>")}</p>`);
        }
      }
      flush();
      reportHtml = out.join("");
    }

    // Panel 2 - competitors list
    const competitorsList = p2 ? p2.competitors.slice(0, 30).map((c) => {
      const badge = competitorTypeBadge(c);
      const typeCell = `<span style="background:${badge.bg};color:${badge.fg};padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;">${badge.label}</span>`;
      const powerCell = c.powerKW > 0 ? `${c.powerKW}kW` : "—";
      return `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.address)}</td><td>${typeCell}</td><td>${powerCell}</td><td>${escapeHtml(c.source)}</td></tr>`;
    }).join("") : "";

    // Data embedded for maps
    const mapData = {
      center: { lat: p1.lat, lng: p1.lng },
      bounds: p1.bounds,
      competitors: p2?.competitors || [],
      gaps: p3?.grid || [],
      corridors: p4?.corridors || [],
      demandZones: p5?.demandZones || [],
      socioZones: p6?.zones || [],
    };

    const scoreColor = p8 ? (p8.cityScore >= 70 ? "#66BB6A" : p8.cityScore >= 40 ? "#FFC107" : "#F44336") : "#C9A84C";

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>BLEV Intelligence | Inteligência de Mercado — ${escapeHtml(p1.city)}/${escapeHtml(p1.state)}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
*{box-sizing:border-box;}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#0D1117;color:#C9D1D9;margin:0;padding:20px;}
.container{max-width:1100px;margin:0 auto;}
.header{text-align:center;border-bottom:2px solid #C9A84C;padding-bottom:24px;margin-bottom:32px;}
.header h1{color:#C9A84C;font-size:26px;margin:0;letter-spacing:0.5px;}
.header .subtitle{color:#C9D1D9;font-size:15px;margin-top:6px;}
.header .date{color:#8B949E;font-size:12px;margin-top:4px;}
.panel{background:#161B22;border:1px solid #30363D;border-radius:12px;padding:24px;margin-bottom:24px;}
.panel-title{color:#C9A84C;font-size:20px;margin:0 0 16px 0;border-bottom:1px solid #30363D;padding-bottom:10px;}
.card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px;}
.card{background:#0D1117;border:1px solid #30363D;border-radius:10px;padding:16px;text-align:center;}
.card .value{font-size:22px;font-weight:bold;color:#C9A84C;}
.card .label{font-size:11px;color:#8B949E;margin-top:4px;}
.phase-box{text-align:center;padding:16px;background:#0D1117;border-radius:10px;border:1px solid #30363D;}
.phase-badge{display:inline-block;padding:8px 20px;border-radius:20px;font-weight:bold;font-size:15px;background:${phaseColor}20;color:${phaseColor};}
.map{height:450px;width:100%;border-radius:8px;background:#0D1117;border:1px solid #30363D;}
.legend{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;margin-top:12px;font-size:12px;color:#8B949E;}
.legend-dot{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:6px;vertical-align:middle;}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px;}
th,td{border:1px solid #30363D;padding:8px 10px;text-align:left;}
th{background:#21262D;color:#C9A84C;font-weight:600;}
.chart{display:flex;align-items:flex-end;justify-content:space-around;gap:8px;height:280px;padding:16px 8px 0;background:#0D1117;border-radius:8px;border:1px solid #30363D;}
.bar-col{display:flex;flex-direction:column;align-items:center;flex:1;height:100%;justify-content:flex-end;}
.bar{width:100%;max-width:60px;background:linear-gradient(180deg,#C9A84C 0%,#8B7335 100%);border-radius:4px 4px 0 0;box-shadow:0 0 10px #C9A84C40;}
.bar-value{font-size:11px;color:#C9A84C;font-weight:600;margin-bottom:4px;}
.bar-label{font-size:11px;color:#8B949E;margin-top:6px;}
.score-circle{display:inline-flex;align-items:center;justify-content:center;width:130px;height:130px;border-radius:50%;border:4px solid ${scoreColor};background:${scoreColor}15;color:${scoreColor};font-size:46px;font-weight:bold;box-shadow:0 0 40px ${scoreColor}30;margin:16px 0;}
.footer{text-align:center;border-top:1px solid #30363D;padding-top:16px;margin-top:32px;color:#8B949E;font-size:12px;}
@media(max-width:640px){
  body{padding:12px;}
  .panel{padding:16px;}
  .header h1{font-size:20px;}
  .map{height:360px;}
  .chart{height:220px;}
  .bar-value,.bar-label{font-size:9px;}
  table{font-size:11px;}
  th,td{padding:5px 6px;}
}
</style>
</head>
<body>
<div class="container">

<div class="header">
<h1>BLEV Intelligence | Inteligência de Mercado — ${escapeHtml(p1.city)}/${escapeHtml(p1.state)}</h1>
<div class="date">Gerado em ${dateStr}</div>
</div>

<!-- PAINEL 1: VISÃO GERAL -->
<div class="panel">
<h2 class="panel-title">1. Visão Geral — ${escapeHtml(p1.city)}/${escapeHtml(p1.state)}</h2>
<div class="card-grid">
<div class="card"><div class="value">${p1.population.toLocaleString("pt-BR")}</div><div class="label">População</div></div>
<div class="card"><div class="value">R$ ${p1.gdpPerCapita.toLocaleString("pt-BR")}</div><div class="label">PIB per Capita</div></div>
<div class="card"><div class="value">${p1.totalVehicles.toLocaleString("pt-BR")}</div><div class="label">Frota Total</div></div>
<div class="card"><div class="value">${p1.evs.toLocaleString("pt-BR")}</div><div class="label">EVs Estimados</div></div>
<div class="card"><div class="value">${p1.chargersExisting}</div><div class="label">Carregadores (Google)</div></div>
${p1.totalCarregadosComBr != null ? `<div class="card"><div class="value">${p1.totalCarregadosComBr}</div><div class="label">Total (carregados.com.br)</div></div>` : ""}
<div class="card"><div class="value">${p1.ratio}</div><div class="label">EVs/Carregador</div></div>
</div>
<div class="phase-box">
<div style="font-size:12px;color:#8B949E;margin-bottom:8px;">Classificação do Mercado</div>
<span class="phase-badge">${escapeHtml(p1.marketPhase)}</span>
</div>
</div>

${p2 ? `<!-- PAINEL 2: CONCORRENTES -->
<div class="panel">
<h2 class="panel-title">2. Mapa de Concorrentes</h2>
<div class="card-grid">
<div class="card"><div class="value" style="color:#F44336;">${p2.total}</div><div class="label">Total Estações</div></div>
<div class="card"><div class="value" style="color:#66BB6A;">${p2.dcConfirmed}<span style="font-size:14px;color:#FFC107;"> +${p2.dcEstimated}</span></div><div class="label">DC (conf. + est.)</div></div>
<div class="card"><div class="value" style="color:#C9D1D9;">${p2.acConfirmed}<span style="font-size:14px;color:#FFC107;"> +${p2.acEstimated}</span></div><div class="label">AC (conf. + est.)</div></div>
<div class="card"><div class="value" style="color:#8B949E;">${p2.unknown}</div><div class="label">Não identificados</div></div>
<div class="card"><div class="value" style="color:#AB47BC;">${p2.operators.length}</div><div class="label">Operadores</div></div>
</div>
<div style="background:#C9A84C10;border:1px solid #C9A84C;border-radius:8px;padding:10px;text-align:center;font-size:12px;color:#C9D1D9;margin-bottom:12px;"><b style="color:#C9A84C;">Concorrência real (DC):</b> ${p2.realCompetition} estações</div>
<div id="map-concorrentes" class="map"></div>
<table><thead><tr><th>Nome</th><th>Endereço</th><th>Tipo</th><th>Potência</th><th>Fonte</th></tr></thead><tbody>${competitorsList}</tbody></table>
</div>` : ""}

${p3 ? `<!-- PAINEL 3: GAPS DE COBERTURA -->
<div class="panel">
<h2 class="panel-title">3. Gaps de Cobertura</h2>
<div class="card-grid">
<div class="card"><div class="value" style="color:#66BB6A;">${p3.opportunityCells}</div><div class="label">Sem Carregador</div></div>
<div class="card"><div class="value" style="color:#FFC107;">${p3.moderateCells}</div><div class="label">Moderado (1-2)</div></div>
<div class="card"><div class="value" style="color:#F44336;">${p3.saturatedCells}</div><div class="label">Saturado (3+)</div></div>
</div>
<div id="map-gaps" class="map"></div>
<div class="legend">
<span><span class="legend-dot" style="background:#66BB6A;"></span>Oportunidade</span>
<span><span class="legend-dot" style="background:#FFC107;"></span>Moderado</span>
<span><span class="legend-dot" style="background:#F44336;"></span>Saturado</span>
</div>
</div>` : ""}

${p4 ? `<!-- PAINEL 4: CORREDORES -->
<div class="panel">
<h2 class="panel-title">4. Corredores de Tráfego</h2>
<div class="card-grid">
<div class="card"><div class="value" style="color:#FF9800;">${p4.totalCorridorPOIs}</div><div class="label">POIs em Vias Principais</div></div>
</div>
<div id="map-corredores" class="map"></div>
</div>` : ""}

${p5 ? `<!-- PAINEL 5: ZONAS DE DEMANDA -->
<div class="panel">
<h2 class="panel-title">5. Zonas de Demanda</h2>
<div class="card-grid">
${p5.demandZones.map((z) => `<div class="card"><div class="value" style="color:${z.color};">${z.places.length}</div><div class="label">${escapeHtml(z.label)}</div></div>`).join("")}
</div>
<div id="map-demanda" class="map"></div>
<div class="legend">
${p5.demandZones.map((z) => `<span><span class="legend-dot" style="background:${z.color};"></span>${escapeHtml(z.label)} (${z.radius}m)</span>`).join("")}
</div>
</div>` : ""}

${p6 ? `<!-- PAINEL 6: SOCIOECONÔMICO -->
<div class="panel">
<h2 class="panel-title">6. Perfil Socioeconômico</h2>
<div class="card-grid">
<div class="card"><div class="value" style="color:#C9A84C;">${p6.premiumCount}</div><div class="label">Zonas Premium</div></div>
<div class="card"><div class="value" style="color:#66BB6A;">${p6.altaCount}</div><div class="label">Alta Renda</div></div>
<div class="card"><div class="value" style="color:#42A5F5;">${p6.mediaCount}</div><div class="label">Média Renda</div></div>
<div class="card"><div class="value" style="color:#F44336;">${p6.premiumWithoutCharger}</div><div class="label">Premium SEM Carregador</div></div>
</div>
<div id="map-socioeconomico" class="map"></div>
<div class="legend">
<span><span class="legend-dot" style="background:#C9A84C;"></span>Premium</span>
<span><span class="legend-dot" style="background:#66BB6A;"></span>Alta</span>
<span><span class="legend-dot" style="background:#42A5F5;"></span>Média</span>
<span><span class="legend-dot" style="background:#8B949E;"></span>Popular</span>
</div>
</div>` : ""}

${p7 ? `<!-- PAINEL 7: PROJEÇÕES -->
<div class="panel">
<h2 class="panel-title">7. Projeção de Demanda</h2>
<h3 style="color:#8B949E;font-size:13px;font-weight:normal;margin:0 0 12px 0;">EVs Estimados por Ano (crescimento 26% a.a. — ABVE 2025)</h3>
<div class="chart">${projectionBars}</div>
<table><thead><tr><th>Ano</th><th>EVs</th><th>Necessários</th><th>Existentes</th><th>Gap</th></tr></thead><tbody>${projectionTable}</tbody></table>
</div>` : ""}

${p8 ? `<!-- PAINEL 8: RELATÓRIO EXECUTIVO -->
<div class="panel" style="text-align:center;">
<h2 class="panel-title" style="text-align:left;">8. Relatório Executivo</h2>
<div style="font-size:12px;color:#8B949E;">Score Geral — ${escapeHtml(p1.city)}/${escapeHtml(p1.state)}</div>
<div class="score-circle">${p8.cityScore}</div>
<div><span class="phase-badge" style="background:${scoreColor}20;color:${scoreColor};">${p8.cityScore >= 70 ? "Alta Oportunidade" : p8.cityScore >= 40 ? "Oportunidade Moderada" : "Baixa Oportunidade"}</span></div>
<div style="text-align:left;margin-top:24px;">${reportHtml}</div>
</div>` : ""}

<div class="footer">BLEV Educação | @guilhermegbbento | Gerado em ${dateStr}</div>

</div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function(){
  var DATA = ${JSON.stringify(mapData)};
  var L = window.L;
  if (!L) return;
  function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
  function makeMap(id, zoom){
    var el = document.getElementById(id);
    if (!el) return null;
    var m = L.map(el, { center:[DATA.center.lat, DATA.center.lng], zoom: zoom||12 });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { maxZoom:19, attribution:"&copy; CARTO" }).addTo(m);
    return m;
  }
  // Concorrentes
  var mC = makeMap("map-concorrentes");
  if (mC) {
    var SRC = {"Google Places":"#4285F4","carregados.com.br":"#26A69A","OpenChargeMap":"#F44336"};
    function badgeFor(c){
      if (c.typeConfidence === "confirmed") {
        return c.isFastCharge
          ? { label:"DC", bg:"#66BB6A20", fg:"#66BB6A" }
          : { label:"AC", bg:"#8B949E20", fg:"#C9D1D9" };
      }
      if (c.typeConfidence === "estimated") {
        return c.isFastCharge
          ? { label:"DC (est.)", bg:"#FFC10720", fg:"#FFC107" }
          : { label:"AC (est.)", bg:"#FFC10720", fg:"#FFC107" };
      }
      return { label:"N/I", bg:"#8B949E20", fg:"#8B949E" };
    }
    DATA.competitors.forEach(function(c){
      var color = SRC[c.source] || "#F44336";
      var b = badgeFor(c);
      var typeLine = "<span style='background:"+b.bg+";color:"+b.fg+";padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;'>"+b.label+"</span>"
        + (c.powerKW > 0 ? " <span style='color:#ccc;font-size:11px;'>"+c.powerKW+"kW</span>" : "");
      L.circleMarker([c.lat, c.lng], { radius:6, color:color, fillColor:color, fillOpacity:0.85, weight:1 })
        .addTo(mC)
        .bindPopup("<b>"+esc(c.name)+"</b><br/><span style='color:#666;font-size:11px;'>"+esc(c.address)+"</span><br/>"+typeLine+"<br/><span style='font-size:10px;color:"+color+";'>"+esc(c.source)+"</span>");
    });
  }
  // Gaps
  var mG = makeMap("map-gaps");
  if (mG) {
    var STATUS = { opportunity:"#66BB6A", moderate:"#FFC107", saturated:"#F44336" };
    DATA.gaps.forEach(function(cell){
      var color = STATUS[cell.status] || "#8B949E";
      var opacity = cell.status==="opportunity" ? 0.35 : (cell.status==="moderate" ? 0.3 : 0.4);
      L.rectangle(
        [[cell.centerLat-0.0045, cell.centerLng-0.006],[cell.centerLat+0.0045, cell.centerLng+0.006]],
        { color:color, weight:0.5, fillColor:color, fillOpacity:opacity }
      ).addTo(mG).bindPopup("<b style='color:"+color+"'>"+(cell.status==="opportunity"?"OPORTUNIDADE":cell.status==="moderate"?"MODERADO":"SATURADO")+"</b><br/>Carregadores: "+cell.chargerCount);
    });
  }
  // Corredores
  var mCo = makeMap("map-corredores");
  if (mCo) {
    DATA.corridors.forEach(function(poi){
      var hasCharger = DATA.competitors.some(function(comp){
        var d = Math.sqrt(Math.pow((comp.lat-poi.lat)*111000,2) + Math.pow((comp.lng-poi.lng)*111000,2));
        return d < 1000;
      });
      var color = hasCharger ? "#F44336" : "#66BB6A";
      L.circleMarker([poi.lat, poi.lng], { radius:5, color:color, fillColor:color, fillOpacity:0.85, weight:1 })
        .addTo(mCo)
        .bindPopup("<b>"+esc(poi.name)+"</b><br/><span style='font-size:11px;color:#666;'>"+esc(poi.address)+"</span><br/><span style='color:"+color+";font-size:11px;'>"+(hasCharger?"Carregador em 1km":"SEM carregador em 1km")+"</span>");
    });
    if (DATA.corridors.length >= 2) {
      var sorted = DATA.corridors.slice().sort(function(a,b){return a.lng-b.lng;});
      L.polyline(sorted.map(function(p){return [p.lat,p.lng];}), { color:"#FF9800", weight:2, opacity:0.4, dashArray:"8 4" }).addTo(mCo);
    }
    DATA.competitors.forEach(function(c){
      L.circleMarker([c.lat, c.lng], { radius:4, color:"#F44336", fillColor:"#F44336", fillOpacity:0.5, weight:1 }).addTo(mCo);
    });
  }
  // Demanda
  var mD = makeMap("map-demanda");
  if (mD) {
    DATA.demandZones.forEach(function(zone){
      zone.places.forEach(function(place){
        L.circle([place.lat, place.lng], { radius:zone.radius, color:zone.color, fillColor:zone.color, fillOpacity:0.12, weight:1.5, opacity:0.4 }).addTo(mD);
        L.circleMarker([place.lat, place.lng], { radius:5, color:zone.color, fillColor:zone.color, fillOpacity:0.85, weight:1 })
          .addTo(mD)
          .bindPopup("<span style='background:"+zone.color+"30;color:"+zone.color+";padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;'>"+esc(zone.label)+"</span><br/><b>"+esc(place.name)+"</b><br/><span style='font-size:11px;color:#666;'>"+esc(place.address)+"</span>");
      });
    });
  }
  // Socioeconomico
  var mS = makeMap("map-socioeconomico");
  if (mS) {
    var CLASS = { "Premium":"#C9A84C", "Alta":"#66BB6A", "Média":"#42A5F5", "Popular":"#8B949E" };
    DATA.socioZones.forEach(function(zone){
      var color = CLASS[zone.classification] || "#8B949E";
      var isOpp = (zone.classification==="Premium" || zone.classification==="Alta") && !zone.hasCharger;
      L.circle([zone.lat, zone.lng], {
        radius:500,
        color: isOpp ? "#C9A84C" : color,
        fillColor: color,
        fillOpacity: isOpp ? 0.35 : 0.2,
        weight: isOpp ? 2.5 : 1
      }).addTo(mS).bindPopup("<b>"+esc(zone.classification)+"</b> — "+esc(zone.name)+"<br/><span style='font-size:11px;color:"+(zone.hasCharger?"#F44336":"#66BB6A")+";'>"+(zone.hasCharger?"TEM CARREGADOR":"SEM CARREGADOR")+"</span>");
    });
  }
})();
</script>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Inteligencia_Mercado_BLEV_${p1.city}_${p1.state}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [panel1, panel2, panel3, panel4, panel5, panel6, panel7, panel8]);

  // ===================== PANELS =====================

  const panelTabs = [
    { id: 1, label: "Visão Geral", ready: !!panel1 },
    { id: 2, label: "Concorrentes", ready: !!panel2 },
    { id: 3, label: "Gaps", ready: !!panel3 },
    { id: 4, label: "Corredores", ready: !!panel4 },
    { id: 5, label: "Demanda", ready: !!panel5 },
    { id: 6, label: "Socioeconômico", ready: !!panel6 },
    { id: 7, label: "Projeções", ready: !!panel7 },
    { id: 8, label: "Executivo", ready: !!panel8 },
  ];

  const hasAnyData = panel1 || panel2 || panel3 || panel4 || panel5 || panel6 || panel7 || panel8;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#C9A84C] mb-2">Inteligência de Mercado</h1>
        <p className="text-[#8B949E]">Raio-X completo do mercado de eletromobilidade da cidade</p>
      </div>

      {/* Form */}
      <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-6 mb-8">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[320px]">
            <CityStateSelect
              initialCity={city}
              initialState={state}
              onSelect={(c, s) => {
                setCity(c);
                setState(s);
              }}
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={loading || !city.trim()}
            className="rounded-lg bg-[#C9A84C] px-8 py-2.5 font-semibold text-[#0D1117] hover:bg-[#B89443] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Gerando..." : "Gerar Relatório"}
          </button>
        </div>

        {/* Progress */}
        {loading && (
          <div className="mt-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="animate-spin h-5 w-5 border-2 border-[#C9A84C] border-t-transparent rounded-full" />
              <span className="text-[#C9A84C] text-sm font-medium">{progressLabel}</span>
            </div>
            <div className="w-full bg-[#21262D] rounded-full h-2">
              <div
                className="bg-[#C9A84C] h-2 rounded-full transition-all duration-500"
                style={{ width: `${(progressStep / 8) * 100}%` }}
              />
            </div>
            <div className="text-[#8B949E] text-xs mt-1">Etapa {progressStep} de 8</div>
          </div>
        )}
      </div>

      {/* Tabs + Content */}
      {hasAnyData && (
        <>
          {/* Panel Tabs */}
          <div className="flex gap-1 mb-6 overflow-x-auto pb-2">
            {panelTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => tab.ready && setActivePanel(tab.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  activePanel === tab.id
                    ? "bg-[#C9A84C] text-[#0D1117]"
                    : tab.ready
                      ? "bg-[#161B22] text-[#8B949E] border border-[#30363D] hover:text-white"
                      : "bg-[#161B22] text-[#30363D] border border-[#21262D] cursor-not-allowed"
                }`}
                disabled={!tab.ready}
              >
                {tab.ready && activePanel !== tab.id && <span className="inline-block w-2 h-2 bg-[#66BB6A] rounded-full mr-2" />}
                {!tab.ready && loading && <span className="inline-block w-2 h-2 bg-[#8B949E] rounded-full mr-2 animate-pulse" />}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Export Buttons */}
          {panel8 && !loading && (
            <div className="flex gap-3 mb-6">
              <button onClick={handleExportHTML} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#C9A84C] text-[#C9A84C] hover:bg-[#C9A84C20] text-sm font-medium transition-colors">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Exportar HTML
              </button>
            </div>
          )}

          {/* Panel Content */}
          <div className="space-y-6">
            {activePanel === 1 && panel1 && <PanelOverview data={panel1} />}
            {activePanel === 2 && panel2 && panel1 && <PanelCompetitors data={panel2} center={{ lat: panel1.lat, lng: panel1.lng }} />}
            {activePanel === 3 && panel3 && panel1 && <PanelGaps data={panel3} center={{ lat: panel1.lat, lng: panel1.lng }} bounds={panel1.bounds} />}
            {activePanel === 4 && panel4 && panel1 && <PanelCorridors data={panel4} center={{ lat: panel1.lat, lng: panel1.lng }} competitors={panel2?.competitors || []} />}
            {activePanel === 5 && panel5 && panel1 && <PanelDemand data={panel5} center={{ lat: panel1.lat, lng: panel1.lng }} />}
            {activePanel === 6 && panel6 && panel1 && <PanelSocio data={panel6} center={{ lat: panel1.lat, lng: panel1.lng }} />}
            {activePanel === 7 && panel7 && panel1 && <PanelProjections data={panel7} city={panel1.city} />}
            {activePanel === 8 && panel8 && panel1 && <PanelExecutive data={panel8} city={panel1.city} state={panel1.state} />}
          </div>
        </>
      )}

      {/* Footer */}
      {hasAnyData && (
        <div className="mt-12 pt-6 border-t border-[#30363D] text-center text-[#8B949E] text-xs">
          BLEV Educação | @guilhermegbbento
        </div>
      )}
    </div>
  );
}

// ===================== PANEL 1: OVERVIEW =====================

function PanelOverview({ data }: { data: Panel1Data }) {
  const phaseColor = data.marketPhase === "Início" ? "#66BB6A" : data.marketPhase === "Crescimento" ? "#FFC107" : "#F44336";
  const scoreColor = data.cityScore == null
    ? "#8B949E"
    : data.cityScore >= 70 ? "#66BB6A"
    : data.cityScore >= 40 ? "#FFC107"
    : "#F44336";

  const cards: { label: string; value: string }[] = [
    { label: "População", value: data.population.toLocaleString("pt-BR") },
    { label: "PIB per Capita", value: `R$ ${data.gdpPerCapita.toLocaleString("pt-BR")}` },
    { label: "Frota Total", value: data.totalVehicles.toLocaleString("pt-BR") },
    {
      label: data.isEstimateEVs ? "EVs Acumulados na Cidade (estimativa)" : "EVs Acumulados na Cidade",
      value: data.evs.toLocaleString("pt-BR"),
    },
    { label: "Carregadores Encontrados (Google)", value: String(data.chargersExisting) },
  ];
  if (data.totalCarregadosComBr != null) {
    cards.push({
      label: "Total Registrado (carregados.com.br)",
      value: String(data.totalCarregadosComBr),
    });
  }
  cards.push({ label: "EVs/Carregador", value: data.ratio });

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-[#C9A84C]">1. Visão Geral — {data.city}/{data.state}</h2>

      {/* Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 text-center">
            <div className="text-2xl font-bold text-[#C9A84C]">{card.value}</div>
            <div className="text-xs text-[#8B949E] mt-1">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Contexto ABVE */}
      {data.abveNacional && (
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-bold text-[#C9A84C]">Contexto Nacional — ABVE</div>
            <div className="text-xs text-[#8B949E]">Atualizado {data.abveNacional.lastUpdate}</div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
            <div>
              <div className="text-lg font-bold text-[#C9D1D9]">
                {data.abveNacional.vendas2025.toLocaleString("pt-BR")}
              </div>
              <div className="text-[10px] text-[#8B949E] mt-1">
                Vendas Brasil 2025 (+{data.abveNacional.crescimento2025pct}%)
              </div>
            </div>
            <div>
              <div className="text-lg font-bold text-[#C9D1D9]">
                {data.abveNacional.marketShareFev2026pct}%
              </div>
              <div className="text-[10px] text-[#8B949E] mt-1">Market Share Nacional (fev/2026)</div>
            </div>
            <div>
              <div className="text-lg font-bold text-[#C9D1D9]">
                {(data.abveNacional.projecaoABVE2026 / 1000).toFixed(0)}–
                {(data.abveNacional.projecaoMercado2026 / 1000).toFixed(0)} mil
              </div>
              <div className="text-[10px] text-[#8B949E] mt-1">Projeção Nacional 2026</div>
            </div>
            <div>
              <div className="text-lg font-bold text-[#C9D1D9]">
                {data.vendasEstado2025
                  ? data.vendasEstado2025.toLocaleString("pt-BR")
                  : "—"}
              </div>
              <div className="text-[10px] text-[#8B949E] mt-1">
                Vendas 2025 {data.stateAbbr ? `no ${data.stateAbbr}` : "no estado"} (ABVE)
              </div>
            </div>
          </div>
          {data.fonteEVs && (
            <div className="text-[10px] text-[#8B949E] mt-3 text-center italic">
              Fonte EVs da cidade: {data.fonteEVs}
            </div>
          )}
          <div className="text-[10px] text-[#8B949E] mt-1 text-center">
            Fonte: {data.abveNacional.fonte}
          </div>
        </div>
      )}

      {/* City Score */}
      {data.cityScore != null && (
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-6 text-center">
          <div className="text-sm text-[#8B949E] mb-2">Score da Cidade</div>
          <div
            className="inline-flex items-center justify-center text-3xl font-bold rounded-full"
            style={{
              width: 96,
              height: 96,
              background: `${scoreColor}15`,
              color: scoreColor,
              border: `3px solid ${scoreColor}`,
            }}
          >
            {data.cityScore}
          </div>
          <div className="mt-3">
            <span
              className="inline-block px-3 py-1 rounded-full text-xs font-bold"
              style={{ background: `${scoreColor}20`, color: scoreColor }}
            >
              {data.cityScore >= 70 ? "Alta Oportunidade" : data.cityScore >= 40 ? "Oportunidade Moderada" : "Baixa Oportunidade"}
            </span>
          </div>
        </div>
      )}

      {/* Market Phase */}
      <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-6 text-center">
        <div className="text-sm text-[#8B949E] mb-2">Classificação do Mercado</div>
        <span className="inline-block px-6 py-2 rounded-full font-bold text-lg" style={{ background: `${phaseColor}20`, color: phaseColor }}>
          {data.marketPhase}
        </span>
        <div className="text-xs text-[#8B949E] mt-3">
          {data.marketPhase === "Início" && "Poucos carregadores, alta oportunidade para primeiros entrantes"}
          {data.marketPhase === "Crescimento" && "Mercado em expansão, ainda há boas oportunidades"}
          {data.marketPhase === "Maduro" && "Mercado competitivo, foque em diferenciação e localização"}
        </div>
      </div>

      {/* Mini Map */}
      <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4" style={{ height: 400 }}>
        <LeafletMap
          id={`overview-${data.city}`}
          onInit={(map, L) => {
            map.setView([data.lat, data.lng], 12);
            if (data.bounds) {
              L.rectangle(
                [[data.bounds.sw.lat, data.bounds.sw.lng], [data.bounds.ne.lat, data.bounds.ne.lng]],
                { color: "#C9A84C", weight: 2, fillOpacity: 0.05, dashArray: "8 4" }
              ).addTo(map);
            }
            L.marker([data.lat, data.lng], {
              icon: L.divIcon({
                html: `<div style="background:#C9A84C;width:16px;height:16px;border-radius:50%;border:3px solid #0D1117;box-shadow:0 0 10px #C9A84C80;"></div>`,
                className: "",
                iconSize: [16, 16],
                iconAnchor: [8, 8],
              }),
            }).addTo(map).bindPopup(`<b>${data.city}/${data.state}</b>`);
          }}
        />
      </div>
    </div>
  );
}

// ===================== PANEL 2: COMPETITORS =====================

function PanelCompetitors({ data, center }: { data: Panel2Data; center: { lat: number; lng: number } }) {
  const [selectedCompetitor, setSelectedCompetitor] = useState<number | null>(null);

  const SOURCE_COLORS: Record<string, string> = {
    "Google Places": "#4285F4",
    "carregados.com.br": "#26A69A",
    "OpenChargeMap": "#F44336",
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-[#C9A84C]">2. Mapa de Concorrentes</h2>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 text-center">
          <div className="text-2xl font-bold text-[#F44336]">{data.total}</div>
          <div className="text-xs text-[#8B949E]">Total Estações</div>
        </div>
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 text-center">
          <div className="text-2xl font-bold text-[#66BB6A]">
            {data.dcConfirmed}
            <span className="text-sm text-[#FFC107]"> +{data.dcEstimated}</span>
          </div>
          <div className="text-xs text-[#8B949E]">DC Rápidos (conf. + est.)</div>
        </div>
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 text-center">
          <div className="text-2xl font-bold text-[#C9D1D9]">
            {data.acConfirmed}
            <span className="text-sm text-[#FFC107]"> +{data.acEstimated}</span>
          </div>
          <div className="text-xs text-[#8B949E]">AC Lentos (conf. + est.)</div>
        </div>
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 text-center">
          <div className="text-2xl font-bold text-[#8B949E]">{data.unknown}</div>
          <div className="text-xs text-[#8B949E]">Não identificados</div>
        </div>
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 text-center">
          <div className="text-2xl font-bold text-[#AB47BC]">{data.operators.length}</div>
          <div className="text-xs text-[#8B949E]">Operadores</div>
        </div>
      </div>

      <div className="rounded-xl border border-[#C9A84C] bg-[#C9A84C10] p-3 text-center text-xs text-[#C9D1D9]">
        <span className="text-[#C9A84C] font-bold">Concorrência real (DC):</span> {data.realCompetition} estações
        — apenas carregadores DC rápidos são contabilizados no score de concorrência.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Map */}
        <div className="lg:col-span-2 rounded-xl border border-[#30363D] bg-[#161B22] p-4" style={{ height: 500 }}>
          <LeafletMap
            id={`competitors-${data.total}`}
            onInit={(map, L) => {
              map.setView([center.lat, center.lng], 12);

              // Heatmap-like circles
              data.competitors.forEach((c) => {
                L.circleMarker([c.lat, c.lng], {
                  radius: 20,
                  color: "transparent",
                  fillColor: "#F44336",
                  fillOpacity: 0.15,
                  interactive: false,
                }).addTo(map);
              });

              // Markers
              data.competitors.forEach((c, idx) => {
                const color = SOURCE_COLORS[c.source] || "#F44336";
                const icon = L.divIcon({
                  html: `<div style="background:${color};width:12px;height:12px;border-radius:50%;border:2px solid #0D1117;box-shadow:0 0 6px ${color}80;"></div>`,
                  className: "",
                  iconSize: [12, 12],
                  iconAnchor: [6, 6],
                });

                const marker = L.marker([c.lat, c.lng], { icon });
                const badge = competitorTypeBadge(c);
                const typeBadge =
                  `<span style="background:${badge.bg};color:${badge.fg};padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;">${badge.label}</span>` +
                  (c.powerKW > 0
                    ? `<span style="background:#21262D;color:#ccc;padding:2px 6px;border-radius:4px;font-size:10px;">${c.powerKW}kW</span>`
                    : "");
                marker.bindPopup(
                  `<div style="font-family:system-ui;min-width:220px;">
                    <div style="font-weight:700;font-size:13px;margin-bottom:4px;">${escapeHtml(c.name)}</div>
                    <div style="color:#666;font-size:11px;margin-bottom:6px;">${escapeHtml(c.address)}</div>
                    <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;">
                      ${typeBadge}
                      <span style="color:${color};font-size:10px;padding:2px 6px;">${escapeHtml(c.source)}</span>
                    </div>
                    ${c.operator !== "Verificar" ? `<div style="color:#8B949E;font-size:10px;margin-top:4px;">Operador: ${escapeHtml(c.operator)}</div>` : ""}
                  </div>`,
                  { maxWidth: 300 }
                );
                marker.on("click", () => setSelectedCompetitor(idx));
                marker.addTo(map);
              });
            }}
          />
        </div>

        {/* Sidebar list */}
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 overflow-y-auto" style={{ maxHeight: 500 }}>
          <h3 className="text-sm font-semibold text-[#C9A84C] mb-3">Lista de Concorrentes ({data.total})</h3>

          {data.operators.length > 0 && (
            <div className="mb-4 pb-3 border-b border-[#30363D]">
              <div className="text-xs text-[#8B949E] mb-2">Operadores identificados:</div>
              <div className="flex flex-wrap gap-1">
                {data.operators.filter(o => o !== "Verificar" && o !== "Desconhecido").map((op) => (
                  <span key={op} className="text-[10px] bg-[#21262D] text-[#C9D1D9] px-2 py-1 rounded">{op}</span>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            {data.competitors.map((c, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedCompetitor === idx
                    ? "border-[#C9A84C] bg-[#C9A84C10]"
                    : "border-[#30363D] hover:border-[#8B949E]"
                }`}
                onClick={() => setSelectedCompetitor(idx)}
              >
                <div className="text-sm font-medium text-white truncate">{c.name}</div>
                <div className="text-xs text-[#8B949E] truncate mt-1">{c.address}</div>
                <div className="flex gap-2 mt-2 flex-wrap items-center">
                  {(() => {
                    const badge = competitorTypeBadge(c);
                    return (
                      <span
                        className="text-[10px] px-2 py-0.5 rounded font-bold"
                        style={{ background: badge.bg, color: badge.fg }}
                      >
                        {badge.label}
                      </span>
                    );
                  })()}
                  {c.powerKW > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[#21262D] text-[#C9D1D9]">
                      {c.powerKW}kW
                    </span>
                  )}
                  <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: `${SOURCE_COLORS[c.source] || "#F44336"}20`, color: SOURCE_COLORS[c.source] || "#F44336" }}>
                    {c.source}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===================== PANEL 3: COVERAGE GAPS =====================

function PanelGaps({ data, center, bounds }: { data: Panel3Data; center: { lat: number; lng: number }; bounds: Panel1Data["bounds"] }) {
  const STATUS_COLORS = {
    opportunity: "#66BB6A",
    moderate: "#FFC107",
    saturated: "#F44336",
  };

  const premiumOpportunities = data.grid.filter((c) => c.status === "opportunity" && c.nearbyPremiumPOIs.length > 0);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-[#C9A84C]">3. Gaps de Cobertura</h2>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 text-center">
          <div className="text-2xl font-bold text-[#66BB6A]">{data.opportunityCells}</div>
          <div className="text-xs text-[#8B949E]">Zonas Sem Carregador</div>
        </div>
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 text-center">
          <div className="text-2xl font-bold text-[#FFC107]">{data.moderateCells}</div>
          <div className="text-xs text-[#8B949E]">Cobertura Moderada (1-2)</div>
        </div>
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 text-center">
          <div className="text-2xl font-bold text-[#F44336]">{data.saturatedCells}</div>
          <div className="text-xs text-[#8B949E]">Saturadas (3+)</div>
        </div>
      </div>

      {premiumOpportunities.length > 0 && (
        <div className="rounded-xl border border-[#C9A84C] bg-[#C9A84C10] p-4">
          <div className="text-sm font-bold text-[#C9A84C] mb-2">
            {premiumOpportunities.length} zonas de oportunidade em bairros premium!
          </div>
          <div className="text-xs text-[#C9D1D9]">
            {premiumOpportunities.slice(0, 5).map((c, i) => (
              <span key={i} className="block">Zona ({c.centerLat.toFixed(3)}, {c.centerLng.toFixed(3)}): {c.nearbyPremiumPOIs.join(", ")}</span>
            ))}
          </div>
        </div>
      )}

      {/* Map */}
      <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4" style={{ height: 500 }}>
        <LeafletMap
          id={`gaps-${data.totalCells}`}
          onInit={(map, L) => {
            map.setView([center.lat, center.lng], 12);

            data.grid.forEach((cell) => {
              const color = STATUS_COLORS[cell.status];
              const opacity = cell.status === "opportunity"
                ? (cell.nearbyPremiumPOIs.length > 0 ? 0.5 : 0.25)
                : cell.status === "moderate" ? 0.3 : 0.4;

              L.rectangle(
                [
                  [cell.centerLat - 0.0045, cell.centerLng - 0.006],
                  [cell.centerLat + 0.0045, cell.centerLng + 0.006],
                ],
                {
                  color,
                  weight: 0.5,
                  fillColor: color,
                  fillOpacity: opacity,
                }
              ).addTo(map).bindPopup(
                `<div style="font-family:system-ui;">
                  <div style="font-weight:700;color:${color};font-size:13px;">${cell.status === "opportunity" ? "OPORTUNIDADE" : cell.status === "moderate" ? "MODERADO" : "SATURADO"}</div>
                  <div style="color:#999;font-size:11px;margin-top:4px;">Carregadores: ${cell.chargerCount}</div>
                  ${cell.nearbyPremiumPOIs.length > 0 ? `<div style="color:#C9A84C;font-size:11px;margin-top:4px;">POIs Premium: ${cell.nearbyPremiumPOIs.join(", ")}</div>` : ""}
                </div>`
              );
            });
          }}
        />
      </div>

      {/* Legend */}
      <div className="flex gap-6 justify-center">
        {[
          { color: "#66BB6A", label: "Sem carregador (Oportunidade)" },
          { color: "#FFC107", label: "1-2 carregadores (Moderado)" },
          { color: "#F44336", label: "3+ carregadores (Saturado)" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ background: item.color }} />
            <span className="text-xs text-[#8B949E]">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===================== PANEL 4: CORRIDORS =====================

function PanelCorridors({ data, center, competitors }: { data: Panel4Data; center: { lat: number; lng: number }; competitors: Competitor[] }) {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-[#C9A84C]">4. Corredores de Tráfego</h2>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 text-center">
          <div className="text-2xl font-bold text-[#FF9800]">{data.totalCorridorPOIs}</div>
          <div className="text-xs text-[#8B949E]">POIs em Vias Principais</div>
        </div>
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 text-center">
          <div className="text-2xl font-bold text-[#66BB6A]">
            {data.corridors.filter((c) => {
              return !competitors.some((comp) => {
                const d = Math.sqrt(Math.pow((comp.lat - c.lat) * 111000, 2) + Math.pow((comp.lng - c.lng) * 111000, 2));
                return d < 1000;
              });
            }).length}
          </div>
          <div className="text-xs text-[#8B949E]">Vias SEM Carregador em 1km</div>
        </div>
      </div>

      <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4" style={{ height: 500 }}>
        <LeafletMap
          id={`corridors-${data.totalCorridorPOIs}`}
          onInit={(map, L) => {
            map.setView([center.lat, center.lng], 12);

            // Draw corridor POIs
            data.corridors.forEach((poi) => {
              const hasNearbyCharger = competitors.some((comp) => {
                const d = Math.sqrt(Math.pow((comp.lat - poi.lat) * 111000, 2) + Math.pow((comp.lng - poi.lng) * 111000, 2));
                return d < 1000;
              });

              const color = hasNearbyCharger ? "#F44336" : "#66BB6A";
              const icon = L.divIcon({
                html: `<div style="background:${color};width:10px;height:10px;border-radius:50%;border:2px solid #0D1117;box-shadow:0 0 6px ${color}80;"></div>`,
                className: "",
                iconSize: [10, 10],
                iconAnchor: [5, 5],
              });

              L.marker([poi.lat, poi.lng], { icon }).addTo(map).bindPopup(
                `<div style="font-family:system-ui;">
                  <div style="font-weight:700;font-size:13px;">${escapeHtml(poi.name)}</div>
                  <div style="color:#666;font-size:11px;margin-top:2px;">${escapeHtml(poi.address)}</div>
                  <div style="color:${color};font-size:11px;margin-top:6px;font-weight:600;">${hasNearbyCharger ? "Carregador em 1km" : "SEM carregador em 1km - OPORTUNIDADE"}</div>
                </div>`
              );
            });

            // Draw lines connecting corridor POIs to show routes
            if (data.corridors.length >= 2) {
              const sorted = [...data.corridors].sort((a, b) => a.lng - b.lng);
              const coords = sorted.map((p) => [p.lat, p.lng]);
              L.polyline(coords, {
                color: "#FF9800",
                weight: 2,
                opacity: 0.4,
                dashArray: "8 4",
              }).addTo(map);
            }

            // Show competitor markers as reference
            competitors.forEach((c) => {
              L.circleMarker([c.lat, c.lng], {
                radius: 5,
                color: "#F44336",
                fillColor: "#F44336",
                fillOpacity: 0.6,
                weight: 1,
              }).addTo(map);
            });
          }}
        />
      </div>

      {/* POI List */}
      {data.corridors.length > 0 && (
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4">
          <h3 className="text-sm font-semibold text-[#C9A84C] mb-3">POIs em Corredores</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {data.corridors.slice(0, 20).map((poi, i) => {
              const hasCharger = competitors.some((comp) => {
                const d = Math.sqrt(Math.pow((comp.lat - poi.lat) * 111000, 2) + Math.pow((comp.lng - poi.lng) * 111000, 2));
                return d < 1000;
              });
              return (
                <div key={i} className="flex items-center gap-3 p-2 rounded border border-[#30363D]">
                  <div className={`w-2 h-2 rounded-full ${hasCharger ? "bg-[#F44336]" : "bg-[#66BB6A]"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{poi.name}</div>
                    <div className="text-[10px] text-[#8B949E] truncate">{poi.address}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ===================== PANEL 5: DEMAND ZONES =====================

function PanelDemand({ data, center }: { data: Panel5Data; center: { lat: number; lng: number } }) {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-[#C9A84C]">5. Zonas de Demanda</h2>

      {/* Category stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {data.demandZones.map((zone) => (
          <div key={zone.category} className="rounded-xl border border-[#30363D] bg-[#161B22] p-3 text-center">
            <div className="text-xl font-bold" style={{ color: zone.color }}>{zone.places.length}</div>
            <div className="text-[10px] text-[#8B949E] mt-1">{zone.label}</div>
          </div>
        ))}
      </div>

      {/* Map */}
      <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4" style={{ height: 500 }}>
        <LeafletMap
          id={`demand-${data.demandZones.length}`}
          onInit={(map, L) => {
            map.setView([center.lat, center.lng], 12);

            const overlaps: Map<string, number> = new Map();

            data.demandZones.forEach((zone) => {
              zone.places.forEach((place) => {
                // Draw influence circle
                L.circle([place.lat, place.lng], {
                  radius: zone.radius,
                  color: zone.color,
                  fillColor: zone.color,
                  fillOpacity: 0.12,
                  weight: 1.5,
                  opacity: 0.4,
                }).addTo(map);

                // Center dot
                L.circleMarker([place.lat, place.lng], {
                  radius: 5,
                  color: zone.color,
                  fillColor: zone.color,
                  fillOpacity: 0.8,
                  weight: 1,
                }).addTo(map).bindPopup(
                  `<div style="font-family:system-ui;">
                    <span style="background:${zone.color}30;color:${zone.color};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">${zone.label}</span>
                    <div style="font-weight:700;font-size:13px;margin-top:6px;">${escapeHtml(place.name)}</div>
                    <div style="color:#666;font-size:11px;margin-top:2px;">${escapeHtml(place.address)}</div>
                    <div style="color:${zone.color};font-size:11px;margin-top:4px;">Raio de influência: ${zone.radius}m</div>
                  </div>`
                );

                // Track overlaps
                const key = `${Math.round(place.lat * 100)},${Math.round(place.lng * 100)}`;
                overlaps.set(key, (overlaps.get(key) || 0) + 1);
              });
            });

            // Highlight overlap zones (multiple demand sources)
            overlaps.forEach((count, key) => {
              if (count >= 2) {
                const [latStr, lngStr] = key.split(",");
                const lat = parseInt(latStr) / 100;
                const lng = parseInt(lngStr) / 100;
                L.circleMarker([lat, lng], {
                  radius: 15,
                  color: "#C9A84C",
                  fillColor: "#C9A84C",
                  fillOpacity: 0.25,
                  weight: 2,
                  dashArray: "4 4",
                }).addTo(map).bindPopup(
                  `<div style="font-family:system-ui;color:#C9A84C;font-weight:700;">ZONA QUENTE: ${count} fontes de demanda sobrepostas</div>`
                );
              }
            });
          }}
        />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 justify-center">
        {data.demandZones.map((zone) => (
          <div key={zone.category} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ background: zone.color }} />
            <span className="text-xs text-[#8B949E]">{zone.label} ({zone.radius}m)</span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full border-2 border-dashed border-[#C9A84C]" />
          <span className="text-xs text-[#C9A84C]">Zona Quente (sobreposição)</span>
        </div>
      </div>
    </div>
  );
}

// ===================== PANEL 6: SOCIOECONOMIC =====================

function PanelSocio({ data, center }: { data: Panel6Data; center: { lat: number; lng: number } }) {
  const CLASS_COLORS: Record<string, string> = {
    Premium: "#C9A84C",
    Alta: "#66BB6A",
    Média: "#42A5F5",
    Popular: "#8B949E",
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-[#C9A84C]">6. Perfil Socioeconômico</h2>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 text-center">
          <div className="text-2xl font-bold text-[#C9A84C]">{data.premiumCount}</div>
          <div className="text-xs text-[#8B949E]">Zonas Premium</div>
        </div>
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 text-center">
          <div className="text-2xl font-bold text-[#66BB6A]">{data.altaCount}</div>
          <div className="text-xs text-[#8B949E]">Zonas Alta Renda</div>
        </div>
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 text-center">
          <div className="text-2xl font-bold text-[#42A5F5]">{data.mediaCount}</div>
          <div className="text-xs text-[#8B949E]">Zonas Média Renda</div>
        </div>
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 text-center">
          <div className="text-2xl font-bold text-[#F44336]">{data.premiumWithoutCharger}</div>
          <div className="text-xs text-[#8B949E]">Premium SEM Carregador</div>
        </div>
      </div>

      {data.premiumWithoutCharger > 0 && (
        <div className="rounded-xl border border-[#C9A84C] bg-[#C9A84C10] p-4">
          <div className="text-sm font-bold text-[#C9A84C]">
            OPORTUNIDADE MÁXIMA: {data.premiumWithoutCharger} bairros premium/alta renda SEM carregador!
          </div>
        </div>
      )}

      {/* Map */}
      <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4" style={{ height: 500 }}>
        <LeafletMap
          id={`socio-${data.zones.length}`}
          onInit={(map, L) => {
            map.setView([center.lat, center.lng], 12);

            data.zones.forEach((zone) => {
              const color = CLASS_COLORS[zone.classification] || "#8B949E";
              const isOpportunity = (zone.classification === "Premium" || zone.classification === "Alta") && !zone.hasCharger;

              L.circle([zone.lat, zone.lng], {
                radius: 500,
                color: isOpportunity ? "#C9A84C" : color,
                fillColor: color,
                fillOpacity: isOpportunity ? 0.35 : 0.2,
                weight: isOpportunity ? 2.5 : 1,
                dashArray: isOpportunity ? undefined : "4 4",
              }).addTo(map).bindPopup(
                `<div style="font-family:system-ui;">
                  <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
                    <span style="background:${color}30;color:${color};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">${zone.classification}</span>
                    ${!zone.hasCharger ? '<span style="background:#66BB6A30;color:#66BB6A;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">SEM CARREGADOR</span>' : '<span style="background:#F4433630;color:#F44336;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">TEM CARREGADOR</span>'}
                  </div>
                  <div style="font-weight:700;font-size:13px;margin-bottom:4px;">${escapeHtml(zone.name)}</div>
                  <div style="font-size:11px;color:#ccc;">
                    ${zone.indicators.map((i) => `<div>- ${escapeHtml(i)}</div>`).join("")}
                  </div>
                  ${isOpportunity ? '<div style="color:#C9A84C;font-weight:700;font-size:12px;margin-top:8px;">OPORTUNIDADE MÁXIMA</div>' : ""}
                </div>`
              );
            });
          }}
        />
      </div>

      {/* Legend */}
      <div className="flex gap-6 justify-center">
        {Object.entries(CLASS_COLORS).map(([label, color]) => (
          <div key={label} className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full" style={{ background: color }} />
            <span className="text-xs text-[#8B949E]">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===================== PANEL 7: PROJECTIONS =====================

function PanelProjections({ data, city }: { data: Panel7Data; city: string }) {
  // Destaque: último ano da projeção
  const highlight = data.projections[data.projections.length - 1];

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-[#C9A84C]">7. Projeção de Demanda</h2>

      {highlight && (
        <div className="rounded-xl border border-[#C9A84C] bg-[#C9A84C10] p-6 text-center">
          <div className="text-sm text-[#8B949E] mb-2">Projeção para {highlight.year}</div>
          <div className="text-lg text-white">
            Em {highlight.year}, <span className="text-[#C9A84C] font-bold">{city}</span> terá{" "}
            <span className="text-[#C9A84C] font-bold">{highlight.evs.toLocaleString("pt-BR")}</span> EVs
            e precisará de <span className="text-[#66BB6A] font-bold">{highlight.chargersNeeded}</span> carregadores.
            Hoje tem <span className="text-[#F44336] font-bold">{data.currentChargers}</span>.
            Gap de <span className="text-[#F44336] font-bold">{highlight.gap}</span> carregadores.
          </div>
        </div>
      )}

      {/* EV Growth Chart */}
      <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-6">
        <h3 className="text-sm font-semibold text-[#8B949E] mb-4">EVs Estimados por Ano (crescimento 26% a.a. — ABVE 2025)</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data.projections}>
            <CartesianGrid strokeDasharray="3 3" stroke="#30363D" />
            <XAxis dataKey="year" stroke="#8B949E" />
            <YAxis stroke="#8B949E" tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
            <Tooltip
              contentStyle={{ background: "#161B22", border: "1px solid #30363D", borderRadius: 8 }}
              labelStyle={{ color: "#C9A84C" }}
              formatter={(value) => [Number(value).toLocaleString("pt-BR"), ""]}
            />
            <Bar dataKey="evs" fill="#C9A84C" name="EVs" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Chargers Gap Chart */}
      <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-6">
        <h3 className="text-sm font-semibold text-[#8B949E] mb-4">Carregadores Necessários vs Existentes</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data.projections}>
            <CartesianGrid strokeDasharray="3 3" stroke="#30363D" />
            <XAxis dataKey="year" stroke="#8B949E" />
            <YAxis stroke="#8B949E" />
            <Tooltip
              contentStyle={{ background: "#161B22", border: "1px solid #30363D", borderRadius: 8 }}
              labelStyle={{ color: "#C9A84C" }}
            />
            <Legend wrapperStyle={{ color: "#8B949E" }} />
            <Line type="monotone" dataKey="chargersNeeded" name="Necessários" stroke="#66BB6A" strokeWidth={2} dot={{ r: 4 }} />
            <Line type="monotone" dataKey="chargersExisting" name="Existentes" stroke="#F44336" strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#30363D]">
              <th className="py-2 px-3 text-left text-[#C9A84C]">Ano</th>
              <th className="py-2 px-3 text-right text-[#C9A84C]">EVs</th>
              <th className="py-2 px-3 text-right text-[#C9A84C]">Carregadores Necessários</th>
              <th className="py-2 px-3 text-right text-[#C9A84C]">Carregadores Existentes</th>
              <th className="py-2 px-3 text-right text-[#C9A84C]">Gap</th>
            </tr>
          </thead>
          <tbody>
            {data.projections.map((p) => (
              <tr key={p.year} className="border-b border-[#21262D]">
                <td className="py-2 px-3 text-white font-medium">{p.year}</td>
                <td className="py-2 px-3 text-right text-[#C9D1D9]">{p.evs.toLocaleString("pt-BR")}</td>
                <td className="py-2 px-3 text-right text-[#66BB6A]">{p.chargersNeeded}</td>
                <td className="py-2 px-3 text-right text-[#F44336]">{p.chargersExisting}</td>
                <td className="py-2 px-3 text-right font-bold text-[#F44336]">{p.gap}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ===================== PANEL 8: EXECUTIVE =====================

function PanelExecutive({ data, city, state }: { data: Panel8Data; city: string; state: string }) {
  const scoreColor = data.cityScore >= 70 ? "#66BB6A" : data.cityScore >= 40 ? "#FFC107" : "#F44336";

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-[#C9A84C]">8. Relatório Executivo</h2>

      {/* Score */}
      <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-8 text-center">
        <div className="text-sm text-[#8B949E] mb-3">Score Geral — {city}/{state}</div>
        <div
          className="inline-flex items-center justify-center text-5xl font-bold rounded-full"
          style={{
            width: 140,
            height: 140,
            background: `${scoreColor}15`,
            color: scoreColor,
            border: `4px solid ${scoreColor}`,
            boxShadow: `0 0 40px ${scoreColor}30`,
          }}
        >
          {data.cityScore}
        </div>
        <div className="mt-4">
          <span className="inline-block px-4 py-1.5 rounded-full text-sm font-bold" style={{ background: `${scoreColor}20`, color: scoreColor }}>
            {data.cityScore >= 70 ? "Alta Oportunidade" : data.cityScore >= 40 ? "Oportunidade Moderada" : "Baixa Oportunidade"}
          </span>
        </div>
      </div>

      {/* Report */}
      <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-8">
        {renderMarkdown(data.report)}
      </div>
    </div>
  );
}
