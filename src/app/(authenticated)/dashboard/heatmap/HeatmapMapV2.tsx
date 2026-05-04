"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface GridCell {
  lat: number;
  lng: number;
  score: number;
  anchorCount?: number;
  compCount?: number;
  competitorCount?: number;
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

interface HeatmapMapV2Props {
  center: { lat: number; lng: number };
  grid: GridCell[];
  gridStep?: { lat: number; lng: number };
  anchors: Anchor[];
  complementary: Complementary[];
  competitors: Competitor[];
  maxScore: number;
  flyTo: { lat: number; lng: number; zoom?: number } | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function loadCSS(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function escapeHtml(str: string): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getGridColor(normalizedScore: number): string {
  if (normalizedScore >= 0.8) return "#FF0000";
  if (normalizedScore >= 0.65) return "#FF4400";
  if (normalizedScore >= 0.5) return "#FF8800";
  if (normalizedScore >= 0.4) return "#FFBB00";
  if (normalizedScore >= 0.3) return "#FFFF00";
  if (normalizedScore >= 0.2) return "#88FF00";
  if (normalizedScore >= 0.1) return "#00CC00";
  return "#0066FF";
}

const ANCHOR_ICONS: Record<string, string> = {
  gas_station: "⛽",
  bus_station: "🚌",
  airport: "✈️",
  shopping_mall: "🏬",
};

export default function HeatmapMapV2({
  center,
  grid,
  gridStep,
  anchors,
  complementary,
  competitors,
  maxScore,
  flyTo,
}: HeatmapMapV2Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const gridLayerRef = useRef<any>(null);
  const anchorsLayerRef = useRef<any>(null);
  const compLayerRef = useRef<any>(null);
  const competitorsLayerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const initMap = useCallback(async () => {
    if (!containerRef.current) return;

    loadCSS("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
    await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");

    const L = (window as any).L;
    if (!L || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom: 12,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;
    setMapReady(true);
  }, [center.lat, center.lng]);

  useEffect(() => {
    initMap();
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        setMapReady(false);
      }
    };
  }, [initMap]);

  // Grid de quadrados coloridos
  useEffect(() => {
    if (!mapReady) return;
    const L = (window as any).L;
    if (!L || !mapRef.current) return;

    if (gridLayerRef.current) {
      mapRef.current.removeLayer(gridLayerRef.current);
      gridLayerRef.current = null;
    }
    if (grid.length === 0 || maxScore <= 0) return;

    const latStep = gridStep?.lat ?? 0.0045;
    const lngStep =
      gridStep?.lng ?? 0.0045 / Math.cos((center.lat * Math.PI) / 180);

    const group = L.layerGroup();

    grid.forEach((cell) => {
      const normalized = cell.score / maxScore;
      const color = getGridColor(normalized);
      const sw: [number, number] = [
        cell.lat - latStep / 2,
        cell.lng - lngStep / 2,
      ];
      const ne: [number, number] = [
        cell.lat + latStep / 2,
        cell.lng + lngStep / 2,
      ];
      const rect = L.rectangle([sw, ne], {
        color: "transparent",
        fillColor: color,
        fillOpacity: 0.35,
        weight: 0,
      });
      const aCount = cell.anchorCount ?? 0;
      const cCount = cell.compCount ?? 0;
      const xCount = cell.competitorCount ?? 0;
      rect.bindPopup(
        `<div style="font-family:system-ui;min-width:200px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:4px;">Região: ${cell.score} pontos</div>
          <div style="font-size:11px;color:#C9D1D9;">Âncoras: ${aCount} | Potenciais: ${cCount} | Concorrentes: ${xCount}</div>
        </div>`,
        { maxWidth: 260 }
      );
      group.addLayer(rect);
    });

    group.addTo(mapRef.current);
    gridLayerRef.current = group;
  }, [grid, gridStep, maxScore, mapReady, center.lat]);

  // Anchor markers (gold) → ÂNCORA
  useEffect(() => {
    if (!mapReady) return;
    const L = (window as any).L;
    if (!L || !mapRef.current) return;

    if (anchorsLayerRef.current) {
      mapRef.current.removeLayer(anchorsLayerRef.current);
    }
    const group = L.layerGroup();

    anchors.forEach((a) => {
      const emoji = ANCHOR_ICONS[a.type] || "📍";
      const icon = L.divIcon({
        html: `<div style="width:14px;height:14px;border-radius:50%;background:#C9A84C;border:2px solid #0D1117;box-shadow:0 0 8px #C9A84C;"></div>`,
        className: "",
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      const marker = L.marker([a.lat, a.lng], { icon, zIndexOffset: 1000 });
      marker.bindPopup(
        `<div style="font-family:system-ui;min-width:220px;">
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
            <span style="background:#C9A84C30;color:#C9A84C;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">ÂNCORA</span>
          </div>
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">${emoji} ${escapeHtml(a.name)}</div>
          <div style="color:#666;font-size:12px;margin-bottom:6px;">${escapeHtml(a.address)}</div>
          <span style="background:#C9A84C20;color:#C9A84C;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">${escapeHtml(a.typeLabel)}</span>
        </div>`,
        { maxWidth: 300 }
      );
      group.addLayer(marker);
    });

    group.addTo(mapRef.current);
    anchorsLayerRef.current = group;
  }, [anchors, mapReady]);

  // Complementary markers (white) → POTENCIAL
  useEffect(() => {
    if (!mapReady) return;
    const L = (window as any).L;
    if (!L || !mapRef.current) return;

    if (compLayerRef.current) {
      mapRef.current.removeLayer(compLayerRef.current);
    }
    const group = L.layerGroup();

    complementary.forEach((cp) => {
      const icon = L.divIcon({
        html: `<div style="width:8px;height:8px;border-radius:50%;background:#ffffff;border:1px solid #0D1117;box-shadow:0 0 4px #ffffff80;"></div>`,
        className: "",
        iconSize: [8, 8],
        iconAnchor: [4, 4],
      });
      const marker = L.marker([cp.lat, cp.lng], { icon, zIndexOffset: 500 });
      const distHtml =
        cp.nearAnchor && cp.nearAnchorDist
          ? `<div style="color:#8B949E;font-size:11px;margin-top:4px;">Próximo a ${escapeHtml(cp.nearAnchor)} (${cp.nearAnchorDist}m)</div>`
          : "";
      marker.bindPopup(
        `<div style="font-family:system-ui;min-width:220px;">
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
            <span style="background:#FFFFFF20;color:#FFFFFF;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;border:1px solid #FFFFFF40;">POTENCIAL</span>
          </div>
          <div style="font-weight:700;font-size:13px;">${escapeHtml(cp.name)}</div>
          <div style="color:#666;font-size:12px;margin-top:2px;">${escapeHtml(cp.address)}</div>
          <div style="margin-top:6px;">
            <span style="background:#21262D;color:#C9D1D9;padding:2px 8px;border-radius:4px;font-size:11px;">${escapeHtml(cp.typeLabel)}</span>
          </div>
          ${distHtml}
        </div>`,
        { maxWidth: 280 }
      );
      group.addLayer(marker);
    });

    group.addTo(mapRef.current);
    compLayerRef.current = group;
  }, [complementary, mapReady]);

  // Competitor markers (red)
  useEffect(() => {
    if (!mapReady) return;
    const L = (window as any).L;
    if (!L || !mapRef.current) return;

    if (competitorsLayerRef.current) {
      mapRef.current.removeLayer(competitorsLayerRef.current);
    }
    const group = L.layerGroup();

    const dcByNameKeywords = [
      "rápido",
      "rapido",
      "fast",
      "supercharger",
      "ultra",
      "ccs",
      "chademo",
      "shell recharge",
      "zletric",
      "ezvolt",
      "tupinamba",
      "tupinambá",
      "voltbras",
      "neocharge",
    ];
    const dcByNamePower = /\b(50|60|80|100|120|150|180|200|240|300|350)\s*kw\b/i;

    competitors.forEach((cm) => {
      const icon = L.divIcon({
        html: `<div style="width:12px;height:12px;border-radius:50%;background:#F44336;border:2px solid #0D1117;box-shadow:0 0 6px #F4433680;"></div>`,
        className: "",
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });
      const marker = L.marker([cm.lat, cm.lng], { icon, zIndexOffset: 800 });

      let displayType: "DC" | "AC" | "unknown" = cm.charger_type;
      if (displayType === "unknown") {
        const lower = (cm.name || "").toLowerCase();
        if (
          dcByNameKeywords.some((k) => lower.includes(k)) ||
          dcByNamePower.test(cm.name || "") ||
          / dc(\b|[\s\-/(])/i.test(` ${cm.name || ""}`)
        ) {
          displayType = "DC";
        }
      }

      const typeBadge =
        displayType === "DC"
          ? `<span style="background:#FF980030;color:#FF9800;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">DC</span>`
          : displayType === "AC"
            ? `<span style="background:#42A5F530;color:#42A5F5;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">AC</span>`
            : `<span style="background:#21262D;color:#8B949E;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">Tipo não confirmado</span>`;
      marker.bindPopup(
        `<div style="font-family:system-ui;min-width:220px;">
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
            <span style="background:#F4433630;color:#F44336;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">CONCORRENTE</span>
            ${typeBadge}
          </div>
          <div style="font-weight:700;font-size:13px;">${escapeHtml(cm.name)}</div>
          <div style="color:#666;font-size:12px;margin-top:2px;">${escapeHtml(cm.address)}</div>
        </div>`,
        { maxWidth: 280 }
      );
      group.addLayer(marker);
    });

    group.addTo(mapRef.current);
    competitorsLayerRef.current = group;
  }, [competitors, mapReady]);

  // Fit bounds on first render
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const L = (window as any).L;
    if (!L) return;
    const all: [number, number][] = [
      ...grid.map((c) => [c.lat, c.lng] as [number, number]),
      ...anchors.map((a) => [a.lat, a.lng] as [number, number]),
      ...competitors.map((c) => [c.lat, c.lng] as [number, number]),
    ];
    if (all.length > 0) {
      mapRef.current.fitBounds(all, { padding: [40, 40] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // Fly to
  useEffect(() => {
    if (!mapReady || !flyTo || !mapRef.current) return;
    mapRef.current.flyTo([flyTo.lat, flyTo.lng], flyTo.zoom ?? 16, {
      duration: 0.8,
    });
  }, [flyTo, mapReady]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ background: "#0D1117" }}
      />

      {/* Legend */}
      <div className="absolute bottom-3 right-3 z-[400] rounded-lg border border-[#30363D] bg-[#161B22]/95 p-3 text-xs text-[#C9D1D9] shadow-xl backdrop-blur">
        <div className="mb-2 flex items-center gap-2 font-semibold text-white">
          <span>Legenda</span>
          <button
            type="button"
            onClick={() => setShowHelp(true)}
            aria-label="Ajuda da legenda"
            className="flex h-4 w-4 items-center justify-center rounded-full border border-[#C9A84C] text-[10px] font-bold text-[#C9A84C] transition-colors hover:bg-[#C9A84C] hover:text-[#0D1117]"
          >
            ?
          </button>
        </div>
        <div className="mb-1.5">
          <div
            className="h-2 w-40 rounded-sm"
            style={{
              background:
                "linear-gradient(90deg,#0066FF,#00CC00,#FFFF00,#FF8800,#FF0000)",
            }}
          />
          <div className="mt-1 flex justify-between text-[9px] text-[#8B949E]">
            <span>Mínima</span>
            <span>Melhor região</span>
          </div>
        </div>
        <div className="space-y-1 text-[11px]">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{
                background: "#C9A84C",
                border: "2px solid #0D1117",
                boxShadow: "0 0 4px #C9A84C",
              }}
            />
            Ponto Âncora
          </div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: "#fff", border: "1px solid #0D1117" }}
            />
            Ponto Potencial
          </div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: "#F44336", border: "2px solid #0D1117" }}
            />
            Concorrente existente
          </div>
        </div>
      </div>

      {/* Help modal */}
      {showHelp && (
        <>
          <div
            className="absolute inset-0 z-[1000]"
            onClick={() => setShowHelp(false)}
          />
          <div
            className="absolute bottom-3 right-3 z-[1001] max-w-[350px] rounded-lg border text-white shadow-2xl"
            style={{
              background: "#161B22",
              borderColor: "#C9A84C",
              padding: 16,
            }}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-[#C9A84C]">
                Sobre a legenda
              </span>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                aria-label="Fechar"
                className="text-lg leading-none text-[#8B949E] transition-colors hover:text-white"
              >
                ×
              </button>
            </div>
            <div className="space-y-2 text-[12px] leading-relaxed text-white">
              <p>
                <strong className="text-[#C9A84C]">Ponto Âncora:</strong> Ponto
                de grande potencial para instalação de eletroposto.
              </p>
              <p>
                <strong className="text-white">Ponto Potencial:</strong> Ponto
                com potencial de instalação, próximo a um ponto âncora.
              </p>
              <p>
                <strong className="text-[#F44336]">Concorrente:</strong>{" "}
                Carregador existente.
              </p>
              <p className="border-t border-[#30363D] pt-2 text-[11px] text-[#C9D1D9]">
                Outros locais não apresentados no mapa podem e devem ser
                considerados. Entre em contato com a equipe da Blev Educação
                para estudar o ponto.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
