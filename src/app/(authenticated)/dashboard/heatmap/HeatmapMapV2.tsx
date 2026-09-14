"use client";

import { useEffect, useRef, useState } from "react";
import { DARK_TILES, TILE_OPTIONS, warnIfMissingKey } from "@/lib/basemap";
import { COMPETITOR_OVERLAP_PX, COMPETITOR_ZONE_RADIUS_M, INFLUENCE_RULES, specsForLayer } from "@/lib/heatmap/config";
import type { AnchorOut, ComplementaryOut, CompetitorOut, StudyScope } from "@/lib/heatmap/types";

interface HeatmapMapV2Props {
  scope: StudyScope;
  anchors: AnchorOut[];
  complementary: ComplementaryOut[];
  competitors: CompetitorOut[];
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

const km = (m: number) => `${(m / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km`;

const ANCHOR_ICONS: Record<string, string> = Object.fromEntries(
  specsForLayer("anchor").map((s) => [s.key, s.emoji])
);

function chargerBadge(c: CompetitorOut): string {
  const kw = c.chargerMaxKw ? ` ${c.chargerMaxKw} kW` : "";
  if (c.charger_type === "DC") {
    return `<span style="background:#FF980030;color:#FF9800;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">DC${kw}</span>`;
  }
  if (c.charger_type === "AC") {
    return `<span style="background:#42A5F530;color:#42A5F5;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">AC${kw}</span>`;
  }
  return `<span style="background:#21262D;color:#8B949E;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">Não informado</span>`;
}

export default function HeatmapMapV2({ scope, anchors, complementary, competitors, flyTo }: HeatmapMapV2Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const scopeLayerRef = useRef<any>(null);
  const influenceLayerRef = useRef<any>(null);
  const competitorZoneLayerRef = useRef<any>(null);
  const anchorsLayerRef = useRef<any>(null);
  const compLayerRef = useRef<any>(null);
  const competitorsLayerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      loadCSS("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
      await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");

      const L = (window as any).L;
      if (cancelled || !L || mapRef.current || !containerRef.current) return;

      const map = L.map(containerRef.current, { zoomControl: true });
      warnIfMissingKey();
      L.tileLayer(DARK_TILES, TILE_OPTIONS).addTo(map);

      mapRef.current = map;
      setMapReady(true);
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Enquadra o ESCOPO pedido (centro + raio), nunca os pontos.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const b = scope.bounds;
    mapRef.current.fitBounds(
      [
        [b.south, b.west],
        [b.north, b.east],
      ],
      { padding: [20, 20] }
    );
  }, [scope.bounds, mapReady]);

  // Área de estudo (círculo tracejado)
  useEffect(() => {
    if (!mapReady) return;
    const L = (window as any).L;
    if (!L || !mapRef.current) return;
    if (scopeLayerRef.current) mapRef.current.removeLayer(scopeLayerRef.current);
    const group = L.layerGroup();
    scope.areas.forEach((a) => {
      L.circle([a.center.lat, a.center.lng], {
        radius: a.radiusM,
        color: "#C9A84C",
        weight: 2,
        dashArray: "8 6",
        fill: false,
        interactive: false,
      }).addTo(group);
    });
    group.addTo(mapRef.current);
    scopeLayerRef.current = group;
  }, [scope.areas, mapReady]);

  // Zonas de influência (âncoras): anéis externos fixos + anel interno vindo do servidor
  useEffect(() => {
    if (!mapReady) return;
    const L = (window as any).L;
    if (!L || !mapRef.current) return;
    if (influenceLayerRef.current) {
      mapRef.current.removeLayer(influenceLayerRef.current);
      influenceLayerRef.current = null;
    }
    if (anchors.length === 0) return;

    const group = L.layerGroup();
    anchors.forEach((a) => {
      INFLUENCE_RULES.outerRings.forEach((ring) => {
        L.circle([a.lat, a.lng], {
          radius: ring.radiusM,
          color: "transparent",
          fillColor: "#C9A84C",
          fillOpacity: ring.opacity,
          weight: 0,
          interactive: false,
        }).addTo(group);
      });
      L.circle([a.lat, a.lng], {
        radius: a.influenceInnerRadiusM,
        color: "transparent",
        fillColor: "#C9A84C",
        fillOpacity: INFLUENCE_RULES.innerOpacity,
        weight: 0,
        interactive: false,
      }).addTo(group);
    });
    group.addTo(mapRef.current);
    influenceLayerRef.current = group;
  }, [anchors, mapReady]);

  // Zonas dos concorrentes (vermelho)
  useEffect(() => {
    if (!mapReady) return;
    const L = (window as any).L;
    if (!L || !mapRef.current) return;
    if (competitorZoneLayerRef.current) {
      mapRef.current.removeLayer(competitorZoneLayerRef.current);
      competitorZoneLayerRef.current = null;
    }
    if (competitors.length === 0) return;

    const group = L.layerGroup();
    competitors.forEach((cm) => {
      L.circle([cm.lat, cm.lng], {
        radius: COMPETITOR_ZONE_RADIUS_M,
        color: "transparent",
        fillColor: "#FF4444",
        fillOpacity: 0.1,
        weight: 0,
        interactive: false,
      }).addTo(group);
    });
    group.addTo(mapRef.current);
    competitorZoneLayerRef.current = group;
  }, [competitors, mapReady]);

  // Âncoras
  useEffect(() => {
    if (!mapReady) return;
    const L = (window as any).L;
    if (!L || !mapRef.current) return;
    if (anchorsLayerRef.current) mapRef.current.removeLayer(anchorsLayerRef.current);
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
          <div style="margin-top:6px;font-size:11px;color:#8B949E;">${km(a.distanceToCenterM)} do centro · ${a.complementaryWithin300m} complementares a 300 m · ${a.competitorsWithin1km} concorrentes a 1 km</div>
        </div>`,
        { maxWidth: 300 }
      );
      group.addLayer(marker);
    });

    group.addTo(mapRef.current);
    anchorsLayerRef.current = group;
  }, [anchors, mapReady]);

  // Complementares (POTENCIAL)
  useEffect(() => {
    if (!mapReady) return;
    const L = (window as any).L;
    if (!L || !mapRef.current) return;
    if (compLayerRef.current) mapRef.current.removeLayer(compLayerRef.current);
    const group = L.layerGroup();

    complementary.forEach((cp) => {
      const icon = L.divIcon({
        html: `<div style="width:8px;height:8px;border-radius:50%;background:#ffffff;border:1px solid #0D1117;box-shadow:0 0 4px #ffffff80;"></div>`,
        className: "",
        iconSize: [8, 8],
        iconAnchor: [4, 4],
      });
      const marker = L.marker([cp.lat, cp.lng], { icon, zIndexOffset: 500 });
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
          <div style="color:#8B949E;font-size:11px;margin-top:4px;">Próximo a ${escapeHtml(cp.nearAnchor)} (${cp.nearAnchorDist} m)</div>
        </div>`,
        { maxWidth: 280 }
      );
      group.addLayer(marker);
    });

    group.addTo(mapRef.current);
    compLayerRef.current = group;
  }, [complementary, mapReady]);

  // Concorrentes: pontos sobrepostos no zoom atual viram um ponto com contador — nenhum some.
  useEffect(() => {
    if (!mapReady) return;
    const L = (window as any).L;
    const map = mapRef.current;
    if (!L || !map) return;

    const render = () => {
      if (competitorsLayerRef.current) map.removeLayer(competitorsLayerRef.current);
      const group = L.layerGroup();
      const clusters: { pt: any; items: CompetitorOut[] }[] = [];
      competitors.forEach((cm) => {
        const pt = map.latLngToLayerPoint([cm.lat, cm.lng]);
        const hit = clusters.find((c) => c.pt.distanceTo(pt) < COMPETITOR_OVERLAP_PX);
        if (hit) hit.items.push(cm);
        else clusters.push({ pt, items: [cm] });
      });

      clusters.forEach(({ items }) => {
      const n = items.length;
      const size = n === 1 ? 12 : 18;
      const icon = L.divIcon({
        html: `<div class="cmp-dot" data-count="${n}" style="width:${size}px;height:${size}px;border-radius:50%;background:#F44336;border:2px solid #0D1117;box-shadow:0 0 6px #F4433680;color:#fff;font-size:10px;font-weight:700;line-height:${size - 4}px;text-align:center;">${n > 1 ? n : ""}</div>`,
        className: "",
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      // Acima da âncora: eletroposto dentro de posto/shopping não pode sumir sob o ponto dourado.
      const marker = L.marker([items[0].lat, items[0].lng], { icon, zIndexOffset: 1500 });
      marker.bindPopup(
        items.map((cm) => `<div style="font-family:system-ui;min-width:220px;">
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
            <span style="background:#F4433630;color:#F44336;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">CONCORRENTE</span>
            ${chargerBadge(cm)}
          </div>
          <div style="font-weight:700;font-size:13px;">${escapeHtml(cm.name)}</div>
          <div style="color:#666;font-size:12px;margin-top:2px;">${escapeHtml(cm.address)}</div>
          <div style="color:#8B949E;font-size:11px;margin-top:4px;">${km(cm.distanceToCenterM)} do centro</div>
        </div>`).join('<hr style="border:none;border-top:1px solid #30363D;margin:6px 0;">'),
        { maxWidth: 280 }
      );
      group.addLayer(marker);
      });

      group.addTo(map);
      competitorsLayerRef.current = group;
    };

    render();
    map.on("zoomend", render);
    return () => {
      map.off("zoomend", render);
    };
  }, [competitors, mapReady]);

  useEffect(() => {
    if (!mapReady || !flyTo || !mapRef.current) return;
    mapRef.current.flyTo([flyTo.lat, flyTo.lng], flyTo.zoom ?? 16, { duration: 0.8 });
  }, [flyTo, mapReady]);

  const radiusText = scope.areas.map((a) => km(a.radiusM)).join(" / ");

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" style={{ background: "#0D1117" }} />

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
        <div className="space-y-1.5 text-[11px]">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full" style={{ border: "2px dashed #C9A84C" }} />
            Área de estudo (raio {radiusText})
          </div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: "#C9A84C", border: "2px solid #0D1117", boxShadow: "0 0 4px #C9A84C" }}
            />
            Ponto Âncora
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#fff", border: "1px solid #0D1117" }} />
            Ponto Potencial
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: "#F44336", border: "2px solid #0D1117" }} />
            Concorrente existente
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: "#C9A84C", opacity: 0.45 }} />
            Zona de influência (âncora)
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: "#FF4444", opacity: 0.4 }} />
            Zona do concorrente
          </div>
        </div>
      </div>

      {showHelp && (
        <>
          <div className="absolute inset-0 z-[1000]" onClick={() => setShowHelp(false)} />
          <div
            className="absolute bottom-3 right-3 z-[1001] max-w-[360px] rounded-lg border text-white shadow-2xl"
            style={{ background: "#161B22", borderColor: "#C9A84C", padding: 16 }}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-[#C9A84C]">Sobre a legenda</span>
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
                <strong className="text-[#C9A84C]">Círculo tracejado:</strong> área de estudo. Todo ponto do
                mapa está dentro dela.
              </p>
              <p>
                <strong className="text-[#C9A84C]">Círculo dourado:</strong> zona de influência do ponto âncora.
                Cresce com pontos complementares a até 300 m e diminui com concorrentes a até 1 km.
              </p>
              <p>
                <strong className="text-white">Sobreposição:</strong> onde dois ou mais círculos se sobrepõem, a
                cor fica mais intensa — regiões com mais âncoras próximas têm maior potencial.
              </p>
              <p>
                <strong className="text-[#FF4444]">Círculo vermelho:</strong> zona de atuação de um concorrente
                existente.
              </p>
              <p>
                <strong className="text-[#F44336]">Concorrente:</strong> carregador existente. &quot;Não
                informado&quot; significa que nenhuma fonte trouxe a potência; não entra na contagem de DC.
              </p>
              <p className="border-t border-[#30363D] pt-2 text-[11px] text-[#C9D1D9]">
                Outros locais não apresentados no mapa podem e devem ser considerados. Entre em contato com a
                equipe da Blev Educação para estudar o ponto.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
