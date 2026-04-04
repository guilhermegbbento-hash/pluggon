"use client";

import { useEffect, useRef, useCallback, useState } from "react";

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

interface HeatmapMapProps {
  points: PointData[];
  allPoints: PointData[];
  chargers: ChargerData[];
  mobilityZones: MobilityZoneData[];
  selectedPointIdx: number | null;
  onSelectPoint: (idx: number) => void;
}

const CLASSIFICATION_COLORS: Record<string, string> = {
  PREMIUM: "#C9A84C",
  ESTRATEGICO: "#2196F3",
  VIAVEL: "#FFC107",
  MARGINAL: "#FF9800",
  REJEITADO: "#F44336",
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  PREMIUM: "Premium",
  ESTRATEGICO: "Estratégico",
  VIAVEL: "Viável",
  MARGINAL: "Marginal",
  REJEITADO: "Rejeitado",
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
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default function HeatmapMap({
  points,
  allPoints,
  chargers,
  mobilityZones,
  selectedPointIdx,
  onSelectPoint,
}: HeatmapMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any>(null);
  const chargersLayerRef = useRef<any>(null);
  const mobilityLayerRef = useRef<any>(null);
  const heatLayerRef = useRef<any>(null);
  const markerMapRef = useRef<Map<number, any>>(new Map());
  const controlRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  const initMap = useCallback(async () => {
    if (!containerRef.current) return;

    loadCSS("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");

    await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");

    const L = (window as any).L;
    if (!L || mapRef.current) return;

    const avgLat = allPoints.reduce((s, p) => s + p.lat, 0) / allPoints.length;
    const avgLng = allPoints.reduce((s, p) => s + p.lng, 0) / allPoints.length;

    const map = L.map(containerRef.current, {
      center: [avgLat, avgLng],
      zoom: 13,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;
    setMapReady(true);
  }, [allPoints]);

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

  // Rebuild layer control whenever any overlay changes
  const rebuildControl = useCallback(() => {
    const L = (window as any).L;
    if (!L || !mapRef.current) return;

    if (controlRef.current) mapRef.current.removeControl(controlRef.current);

    const overlays: Record<string, any> = {};
    if (heatLayerRef.current) {
      overlays[`<span style="color:#FFC107;">&#9632;</span> Mapa de Calor`] =
        heatLayerRef.current;
    }
    if (markersRef.current) {
      overlays[`<span style="color:#C9A84C;">&#9679;</span> Pontos Sugeridos`] =
        markersRef.current;
    }
    if (chargersLayerRef.current) {
      overlays[
        `<span style="color:#F44336;">&#9889;</span> Concorrentes (${chargers.length})`
      ] = chargersLayerRef.current;
    }
    if (mobilityLayerRef.current) {
      overlays[
        `<span style="color:#42A5F5;">&#9673;</span> Zonas de Mobilidade (${mobilityZones.length})`
      ] = mobilityLayerRef.current;
    }

    if (Object.keys(overlays).length > 0) {
      controlRef.current = L.control
        .layers(null, overlays, { collapsed: true, position: "topright" })
        .addTo(mapRef.current);
    }
  }, [chargers.length, mobilityZones.length]);

  // Update suggested-point markers and heatmap
  useEffect(() => {
    if (!mapReady) return;
    const L = (window as any).L;
    if (!L || !mapRef.current) return;
    const map = mapRef.current;

    if (markersRef.current) map.removeLayer(markersRef.current);
    if (heatLayerRef.current) map.removeLayer(heatLayerRef.current);
    markerMapRef.current.clear();

    // Heatmap-like layer: semi-transparent colored circles for all points
    const heatGroup = L.layerGroup();
    allPoints.forEach((p) => {
      const opacity = 0.15 + (p.score / 100) * 0.25;
      const heatColor = CLASSIFICATION_COLORS[p.classification] || "#FFC107";
      L.circleMarker([p.lat, p.lng], {
        radius: 22,
        color: "transparent",
        fillColor: heatColor,
        fillOpacity: opacity,
        interactive: false,
      }).addTo(heatGroup);
    });
    heatGroup.addTo(map);
    heatLayerRef.current = heatGroup;

    // Suggested-point markers (simple layerGroup, no clustering)
    const markerGroup = L.layerGroup();

    points.forEach((point) => {
      const globalIdx = allPoints.indexOf(point);
      const color = CLASSIFICATION_COLORS[point.classification] || "#8B949E";
      const classLabel =
        CLASSIFICATION_LABELS[point.classification] || point.classification;
      const catLabel = CATEGORY_LABELS[point.category] || point.category;

      const icon = L.divIcon({
        html: `<div style="background:${color};width:14px;height:14px;border-radius:50%;border:2px solid #0D1117;box-shadow:0 0 6px ${color}80;"></div>`,
        className: "",
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      const marker = L.marker([point.lat, point.lng], { icon });

      const pontosFortes = (point.pontos_fortes || [])
        .map((p) => `<li style="color:#C9A84C;">${escapeHtml(p)}</li>`)
        .join("");
      const pontosAtencao = (point.pontos_atencao || [])
        .map((p) => `<li style="color:#FF9800;">${escapeHtml(p)}</li>`)
        .join("");
      const badge24h = point.operacao_24h
        ? `<span style="background:#C9A84C20;color:#C9A84C;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700;">24H</span>`
        : "";

      const chargersIn2km = typeof point.chargers_in_2km === "number" ? point.chargers_in_2km : 0;
      const chargerBadge = chargersIn2km > 0
        ? `<span style="background:#F4433620;color:#F44336;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;">${chargersIn2km} DC em 2km</span>`
        : `<span style="background:#66BB6A20;color:#66BB6A;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;">0 DC em 2km</span>`;

      const encodedAddr = encodeURIComponent(point.address || point.name);
      const scoreLink = `/dashboard/score?address=${encodedAddr}&type=${point.category}&name=${encodeURIComponent(point.name)}`;
      const bpLink = `/dashboard/business-plan?address=${encodedAddr}&type=${point.category}&name=${encodeURIComponent(point.name)}`;

      marker.bindPopup(
        `<div style="font-family:system-ui;min-width:260px;max-width:340px;">
          <div style="font-weight:700;font-size:14px;margin-bottom:2px;">${escapeHtml(point.name)}</div>
          ${point.subcategory ? `<div style="color:#8B949E;font-size:11px;margin-bottom:4px;">${escapeHtml(point.subcategory)}</div>` : ""}
          <div style="color:#666;font-size:12px;margin-bottom:8px;">${escapeHtml(point.address)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
            <span style="background:${color}20;color:${color};padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;">${classLabel}</span>
            <span style="background:#f0f0f020;color:#ccc;padding:2px 8px;border-radius:4px;font-size:12px;">${catLabel}</span>
            ${badge24h}
            ${chargerBadge}
            ${point.tempo_permanencia ? `<span style="background:#f0f0f020;color:#999;padding:2px 8px;border-radius:4px;font-size:11px;">${escapeHtml(point.tempo_permanencia)}</span>` : ""}
          </div>
          <div style="font-size:16px;font-weight:700;color:${color};margin-bottom:6px;">Score: ${point.score}/100</div>
          <div style="color:#ccc;font-size:11px;line-height:1.5;margin-bottom:8px;">${escapeHtml(point.justification)}</div>
          ${pontosFortes ? `<div style="margin-bottom:4px;font-size:11px;font-weight:600;color:#C9A84C;">Pontos Fortes:</div><ul style="margin:0 0 6px 16px;padding:0;font-size:11px;line-height:1.6;">${pontosFortes}</ul>` : ""}
          ${pontosAtencao ? `<div style="margin-bottom:4px;font-size:11px;font-weight:600;color:#FF9800;">Atenção:</div><ul style="margin:0 0 8px 16px;padding:0;font-size:11px;line-height:1.6;">${pontosAtencao}</ul>` : ""}
          <div style="display:flex;gap:8px;margin-top:8px;border-top:1px solid #30363D;padding-top:8px;">
            <a href="${scoreLink}" style="flex:1;text-align:center;background:#2196F320;color:#2196F3;padding:6px 8px;border-radius:6px;font-size:11px;font-weight:600;text-decoration:none;">Analisar Ponto</a>
            <a href="${bpLink}" style="flex:1;text-align:center;background:#C9A84C20;color:#C9A84C;padding:6px 8px;border-radius:6px;font-size:11px;font-weight:600;text-decoration:none;">Gerar BP</a>
          </div>
        </div>`,
        { maxWidth: 360 }
      );

      marker.on("click", () => onSelectPoint(globalIdx));

      markerGroup.addLayer(marker);
      markerMapRef.current.set(globalIdx, marker);
    });

    markerGroup.addTo(map);
    markersRef.current = markerGroup;

    rebuildControl();
  }, [points, allPoints, onSelectPoint, rebuildControl, mapReady]);

  // Update charger markers
  useEffect(() => {
    if (!mapReady) return;
    const L = (window as any).L;
    if (!L || !mapRef.current) return;
    const map = mapRef.current;

    if (chargersLayerRef.current) map.removeLayer(chargersLayerRef.current);
    chargersLayerRef.current = null;

    if (chargers.length === 0) {
      rebuildControl();
      return;
    }

    const chargerGroup = L.layerGroup();

    chargers.forEach((charger) => {
      const chargerColor = charger.isFastCharge ? "#FF9800" : "#F44336";
      const icon = L.divIcon({
        html: `<div style="position:relative;width:22px;height:22px;">
          <div style="background:${chargerColor};width:22px;height:22px;border-radius:50%;border:2px solid #0D1117;display:flex;align-items:center;justify-content:center;box-shadow:0 0 8px ${chargerColor}80;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          </div>
        </div>`,
        className: "",
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });

      const marker = L.marker([charger.lat, charger.lng], { icon });

      const statusBadge = charger.isOperational
        ? `<span style="background:#66BB6A30;color:#66BB6A;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;">Operacional</span>`
        : `<span style="background:#F4433630;color:#F44336;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;">Inativo</span>`;

      const typeBadge = charger.isFastCharge
        ? `<span style="background:#FF980030;color:#FF9800;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;">DC Rápido</span>`
        : `<span style="background:#42A5F530;color:#42A5F5;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;">AC</span>`;

      const sourceLabel = charger.source || "OpenChargeMap";
      const sourceColor =
        sourceLabel === "Google Places"
          ? "#4285F4"
          : sourceLabel === "carregados.com.br"
            ? "#26A69A"
            : "#F44336";
      const chargerTypeLabel = charger.type || charger.levelName || "Verificar";
      const ratingHtml =
        charger.rating && charger.rating > 0
          ? `<div style="color:#FFC107;font-size:11px;margin-bottom:4px;">★ ${charger.rating}${charger.reviews ? ` (${charger.reviews} avaliações)` : ""}</div>`
          : "";

      marker.bindPopup(
        `<div style="font-family:system-ui;min-width:240px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;">
            <span style="background:#F4433630;color:#F44336;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">CONCORRENTE</span>
            ${typeBadge}
            ${statusBadge}
          </div>
          <div style="font-weight:700;font-size:14px;margin-bottom:2px;">${escapeHtml(charger.name)}</div>
          <div style="color:#666;font-size:12px;margin-bottom:6px;">${escapeHtml(charger.address)}</div>
          ${charger.operator && charger.operator !== "Desconhecido" && charger.operator !== "Verificar" ? `<div style="color:#8B949E;font-size:11px;margin-bottom:4px;">Operador: ${escapeHtml(charger.operator)}</div>` : ""}
          <div style="display:flex;gap:12px;margin-bottom:6px;">
            ${charger.powerKW > 0 ? `<div style="text-align:center;"><div style="color:#FF9800;font-weight:700;font-size:16px;">${charger.powerKW}</div><div style="color:#999;font-size:10px;">kW</div></div>` : ""}
            <div style="text-align:center;">
              <div style="color:#ccc;font-weight:700;font-size:14px;">${escapeHtml(chargerTypeLabel)}</div>
              <div style="color:#999;font-size:10px;">tipo</div>
            </div>
          </div>
          ${ratingHtml}
          <div style="color:${sourceColor};font-size:10px;font-style:italic;margin-top:4px;">Fonte: ${escapeHtml(sourceLabel)}</div>
        </div>`,
        { maxWidth: 340 }
      );

      chargerGroup.addLayer(marker);
    });

    chargerGroup.addTo(map);
    chargersLayerRef.current = chargerGroup;

    rebuildControl();
  }, [chargers, rebuildControl, mapReady]);

  // Update mobility zone circles
  useEffect(() => {
    if (!mapReady) return;
    const L = (window as any).L;
    if (!L || !mapRef.current) return;
    const map = mapRef.current;

    if (mobilityLayerRef.current) map.removeLayer(mobilityLayerRef.current);
    mobilityLayerRef.current = null;

    if (mobilityZones.length === 0) {
      rebuildControl();
      return;
    }

    const mobilityGroup = L.layerGroup();

    mobilityZones.forEach((zone) => {
      const color = MOBILITY_TYPE_COLORS[zone.type] || "#42A5F5";

      // Semi-transparent circle indicating zone of influence (~400m radius)
      const circle = L.circle([zone.lat, zone.lng], {
        radius: 400,
        color: color,
        fillColor: color,
        fillOpacity: 0.12,
        weight: 1.5,
        opacity: 0.4,
        dashArray: "4 4",
      });

      circle.bindPopup(
        `<div style="font-family:system-ui;min-width:200px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <span style="background:${color}30;color:${color};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">${escapeHtml(zone.typeLabel)}</span>
            <span style="background:#42A5F520;color:#42A5F5;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">ZONA DE MOBILIDADE</span>
          </div>
          <div style="font-weight:700;font-size:14px;margin-bottom:2px;">${escapeHtml(zone.name)}</div>
          <div style="color:#666;font-size:12px;margin-bottom:6px;">${escapeHtml(zone.address)}</div>
          <div style="color:#42A5F5;font-size:11px;line-height:1.5;">
            Alta concentração de motoristas profissionais.<br/>
            Pontos próximos recebem bonus no score.
          </div>
        </div>`,
        { maxWidth: 300 }
      );

      mobilityGroup.addLayer(circle);

      // Small center dot for the actual location
      const dot = L.circleMarker([zone.lat, zone.lng], {
        radius: 4,
        color: color,
        fillColor: color,
        fillOpacity: 0.8,
        weight: 1,
      });
      dot.bindPopup(circle.getPopup());
      mobilityGroup.addLayer(dot);
    });

    mobilityGroup.addTo(map);
    mobilityLayerRef.current = mobilityGroup;

    rebuildControl();
  }, [mobilityZones, rebuildControl, mapReady]);

  // Fly to selected point
  useEffect(() => {
    if (selectedPointIdx === null || !mapRef.current) return;
    const point = allPoints[selectedPointIdx];
    if (!point) return;

    mapRef.current.flyTo([point.lat, point.lng], 16, { duration: 0.8 });

    const marker = markerMapRef.current.get(selectedPointIdx);
    if (marker) {
      setTimeout(() => marker.openPopup(), 900);
    }
  }, [selectedPointIdx, allPoints]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ background: "#0D1117" }}
    />
  );
}
