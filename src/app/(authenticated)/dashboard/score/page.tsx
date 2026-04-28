"use client";

import { useState, useEffect, useRef, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { buildScoreHtml } from "@/lib/score-html-export";
import { createClient } from "@/lib/supabase/client";
import { calculateScore, type ScoreInput, type ScoreResult as EngineScoreResult } from "@/lib/scoring-engine";

const COST_VIEWER_EMAIL = "guilhermegbbento@gmail.com";

// Admins veem a tela de revisão de dados antes do cálculo final do score.
const ADMIN_EMAILS = ['guilhermegbbento@gmail.com', 'marco@bleveducacao.com.br'];

// ---------- Types ----------

type ScoreSource = "ABVE" | "Google Places" | "IBGE" | "Cálculo" | "Usuário";

interface ScoringVariable {
  id: number;
  name: string;
  category: string;
  score: number;
  weight: number;
  justification: string;
  source: ScoreSource;
}

interface NearbyPlace {
  name: string;
  lat: number;
  lng: number;
  address: string;
  type: string;
  rating: number | null;
  reviews: number | null;
  distance_m: number;
}

interface CostBreakdown {
  googleQueries: number;
  googleCostUsd: number;
  claudeTokensIn: number;
  claudeTokensOut: number;
  claudeCostUsd: number;
  totalCostUsd: number;
}

interface ScoreResult {
  address: string;
  lat: number;
  lng: number;
  city: string;
  state: string;
  establishment_type: string;
  establishment_name: string;
  overall_score: number;
  raw_score: number;
  city_factor: number;
  classification: string;
  category_scores: Record<string, number>;
  scoring_variables: ScoringVariable[];
  strengths: string[];
  nearby_pois: NearbyPlace[];
  nearby_chargers: NearbyPlace[];
  ibge_data: {
    population: number | null;
    gdp_total: number | null;
    gdp_per_capita: number | null;
    idhm: number | null;
  };
  abve_data?: {
    city: string;
    state: string;
    ac: number;
    dc: number;
    total: number;
    evsSold?: number;
  } | null;
  data_sources?: {
    cross_check: Array<{
      source: string;
      total: number | null;
      dc: number | null;
      status: "ok" | "partial" | "unavailable";
      details: string;
    }>;
    best_total: { value: number; source: string };
    best_dc: { value: number; source: string };
  };
  cost_breakdown?: CostBreakdown;
}

// Estrutura dos dados coletados (modo collect — admin)
interface CollectedData {
  population: number;
  gdpPerCapita: number;
  abveDC: number;
  abveTotal: number;
  abveEVs: number;
  abveSource: "ABVE" | "Estimativa";
  dcInCity: number;
  totalInCity: number;
  dcIn200m: number;
  dcIn500m: number;
  dcIn1km: number;
  dcIn2km: number;
  dcNamesIn200m: string[];
  dcNamesIn500m: string[];
  dcNamesIn1km: string[];
  dcNamesIn2km: string[];
  restaurants: number;
  supermarkets: number;
  gasStations: number;
  shoppings: number;
  hotels: number;
  parkingLots: number;
  airports: number;
  busStations: number;
  universities: number;
  hospitals: number;
  totalPOIs500m: number;
  distanceToCenter: number;
  hasAirportNearby: boolean;
  hasRodoviariaNearby: boolean;
}

interface CollectResponse {
  mode: "collect";
  address: string;
  lat: number;
  lng: number;
  city: string;
  state: string;
  establishment_type: string;
  establishment_name: string;
  ibge_data: ScoreResult["ibge_data"];
  abve_data: ScoreResult["abve_data"];
  nearby_pois: NearbyPlace[];
  nearby_chargers: NearbyPlace[];
  collected: CollectedData;
  cost_breakdown?: CostBreakdown;
}

// ---------- Constants ----------

const ESTABLISHMENT_TYPES: Record<string, string> = {
  posto_24h: "Posto de Combustível 24h",
  posto_combustivel: "Posto de Combustível",
  shopping: "Shopping Center",
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
  terreno: "Terreno",
  restaurante: "Restaurante",
  outro: "Outro",
};

const CLASSIFICATION_CONFIG: Record<
  string,
  { label: string; color: string }
> = {
  PREMIUM: { label: "Premium", color: "#C9A84C" },
  ESTRATÉGICO: { label: "Estratégico", color: "#2196F3" },
  VIÁVEL: { label: "Viável", color: "#FFC107" },
  MARGINAL: { label: "Marginal", color: "#FF9800" },
  "NÃO RECOMENDADO": { label: "Não Recomendado", color: "#F44336" },
};

const CATEGORY_LABELS: Record<string, string> = {
  Demanda: "Demanda",
  Concorrência: "Concorrência",
  Localização: "Localização",
  Amenidades: "Amenidades",
  "Tipo de Ponto": "Tipo de Ponto",
  Observações: "Observações",
};

const CATEGORY_ICONS: Record<string, string> = {
  Demanda: "🏙️",
  Concorrência: "🏁",
  Localização: "📍",
  Amenidades: "🏪",
  "Tipo de Ponto": "🏢",
  Observações: "📝",
};

const SOURCE_BADGE: Record<ScoreSource, { bg: string; fg: string; label: string }> = {
  ABVE: { bg: "#C9A84C22", fg: "#C9A84C", label: "Análise PLUGGON" },
  "Google Places": { bg: "#C9A84C22", fg: "#C9A84C", label: "Análise PLUGGON" },
  IBGE: { bg: "#5BB3F022", fg: "#5BB3F0", label: "Dados demográficos oficiais" },
  Cálculo: { bg: "#C9A84C22", fg: "#C9A84C", label: "Análise PLUGGON" },
  Usuário: { bg: "#A06CD522", fg: "#B98AE0", label: "Usuário" },
};

const LOADING_STEPS = [
  "Geocodificando endereço...",
  "Carregando inteligência da cidade...",
  "Carregando dados demográficos oficiais...",
  "Identificando concorrentes...",
  "Buscando pontos de interesse no entorno...",
  "Calculando score (28 variáveis)...",
  "Gerando análise textual...",
];

const POI_COLORS: Record<string, string> = {
  restaurante: "#FF6B6B",
  farmacia: "#4ECDC4",
  posto: "#FFE66D",
  shopping: "#A06CD5",
  hospital: "#FF8A5C",
  universidade: "#4ECDC4",
  hotel: "#5BB3F0",
  estacionamento: "#FFC107",
  supermercado: "#3FB373",
};

// ---------- Helpers ----------

function getClassificationColor(classification: string): string {
  return CLASSIFICATION_CONFIG[classification]?.color || "#8B949E";
}

function getClassificationLabel(classification: string): string {
  return CLASSIFICATION_CONFIG[classification]?.label || classification;
}

function getScoreColor(score: number): string {
  if (score >= 8.5) return "#C9A84C";
  if (score >= 7) return "#2196F3";
  if (score >= 5.5) return "#FFC107";
  if (score >= 4) return "#FF9800";
  return "#F44336";
}

// Recompute observation variable client-side (zero API cost) — espelha scoring-engine.ts
function recomputeObservationScore(text: string): {
  score: number;
  justification: string;
} {
  const obs = (text || "").toLowerCase();
  const positives = [
    "24h", "avenida", "principal", "visibilidade", "frente", "alto fluxo",
    "segurança", "câmera", "iluminação", "trifásico", "transformador",
    "terreno próprio", "sem aluguel", "rodovia", "br-", "esquina", "próprio",
    "excelente", "ótimo", "premium", "nobre", "centro", "batel", "jardins", "leblon",
  ];
  const negatives = [
    "escuro", "perigoso", "difícil acesso", "rua estreita", "monofásico",
    "sem estacionamento", "longe", "afastado", "ruim", "pouco movimento",
  ];
  const posCount = positives.filter((p) => obs.includes(p)).length;
  const negCount = negatives.filter((n) => obs.includes(n)).length;
  const score = Math.max(1, Math.min(10, 5 + posCount * 2 - negCount * 2));
  const justification = obs.length > 0
    ? `Observações analisadas: ${posCount} fatores positivos, ${negCount} fatores de atenção`
    : "Sem observações adicionais";
  return { score, justification };
}

function buildScoreInput(
  c: CollectedData,
  establishmentType: string,
  observations: string
): ScoreInput {
  return {
    population: c.population || 0,
    gdpPerCapita: c.gdpPerCapita || 0,
    abveDC: c.abveDC || 0,
    abveTotal: c.abveTotal || 0,
    abveEVs: c.abveEVs || 0,
    dcIn200m: c.dcIn200m || 0,
    dcIn500m: c.dcIn500m || 0,
    dcIn1km: c.dcIn1km || 0,
    dcIn2km: c.dcIn2km || 0,
    dcInCity: c.dcInCity || 0,
    totalInCity: c.totalInCity || 0,
    dcNamesIn200m: c.dcNamesIn200m || [],
    dcNamesIn500m: c.dcNamesIn500m || [],
    dcNamesIn1km: c.dcNamesIn1km || [],
    dcNamesIn2km: c.dcNamesIn2km || [],
    restaurants: c.restaurants || 0,
    supermarkets: c.supermarkets || 0,
    gasStations: c.gasStations || 0,
    shoppings: c.shoppings || 0,
    hotels: c.hotels || 0,
    parkingLots: c.parkingLots || 0,
    universities: c.universities || 0,
    hospitals: c.hospitals || 0,
    hasAirportNearby: !!c.hasAirportNearby,
    hasRodoviariaNearby: !!c.hasRodoviariaNearby,
    totalPOIs: c.totalPOIs500m || 0,
    distanceToCenter: c.distanceToCenter || 0,
    establishmentType: establishmentType || "outro",
    observations: observations || "",
  };
}

// Recompute final score from current variables (used after observation edit)
// Espelha scoring-engine.ts (Demanda 25, Concorrência 25, Localização 20, Amenidades 15, Tipo 10, Observações 5)
const CATEGORY_WEIGHTS: Record<string, number> = {
  Demanda: 0.25,
  Concorrência: 0.25,
  Localização: 0.20,
  Amenidades: 0.15,
  "Tipo de Ponto": 0.10,
  Observações: 0.05,
};

function recomputeOverall(
  variables: ScoringVariable[],
  cityFactor: number
): { rawScore: number; overallScore: number; classification: string; categoryScores: Record<string, number> } {
  const categoryScores: Record<string, number> = {};
  for (const cat of Object.keys(CATEGORY_WEIGHTS)) {
    const inCat = variables.filter((v) => v.category === cat);
    if (!inCat.length) {
      categoryScores[cat] = 0;
      continue;
    }
    let weighted = 0;
    let totalW = 0;
    for (const v of inCat) {
      weighted += v.score * v.weight;
      totalW += v.weight;
    }
    categoryScores[cat] = totalW > 0 ? weighted / totalW : 0;
  }
  let rawScore = 0;
  for (const [cat, w] of Object.entries(CATEGORY_WEIGHTS)) {
    rawScore += (categoryScores[cat] || 0) * 10 * w;
  }
  const finalMultiplier = 0.85 + 0.15 * cityFactor;
  const overallScore = Math.max(0, Math.min(100, Math.round(rawScore * finalMultiplier)));
  const classification =
    overallScore >= 85 ? "PREMIUM" :
    overallScore >= 70 ? "ESTRATÉGICO" :
    overallScore >= 55 ? "VIÁVEL" :
    overallScore >= 40 ? "MARGINAL" : "NÃO RECOMENDADO";
  return { rawScore: Math.round(rawScore * 10) / 10, overallScore, classification, categoryScores };
}

// ---------- Animated Gauge ----------

function ScoreGauge({
  score,
  classification,
}: {
  score: number;
  classification: string;
}) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const color = getClassificationColor(classification);
  const classLabel = getClassificationLabel(classification);

  useEffect(() => {
    let frame: number;
    const duration = 1500;
    const start = performance.now();

    function animate(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimatedScore(Math.round(eased * score));
      if (progress < 1) frame = requestAnimationFrame(animate);
    }

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [score]);

  const circumference = 2 * Math.PI * 90;
  const strokeDashoffset = circumference - (animatedScore / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative" style={{ width: 220, height: 220 }}>
        <svg width="220" height="220" viewBox="0 0 220 220">
          <circle cx="110" cy="110" r="90" fill="none" stroke="#21262D" strokeWidth="12" />
          <circle
            cx="110"
            cy="110"
            r="90"
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            transform="rotate(-90 110 110)"
            style={{ transition: "stroke-dashoffset 1.5s ease-out" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-5xl font-bold text-white">{animatedScore}</span>
          <span className="text-sm text-[#8B949E]">de 100</span>
        </div>
      </div>
      <span
        className="rounded-full px-4 py-1.5 text-sm font-semibold"
        style={{ backgroundColor: color + "20", color }}
      >
        {classLabel}
      </span>
    </div>
  );
}

// ---------- Mini Map ----------

function MiniMap({
  lat,
  lng,
  pois,
  chargers,
}: {
  lat: number;
  lng: number;
  pois: NearbyPlace[];
  chargers: NearbyPlace[];
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    interface LLayer {
      addTo: (m: unknown) => LLayer;
      bindPopup: (s: string) => LLayer;
    }
    const L = (window as unknown as Record<string, unknown>).L as {
      map: (el: HTMLElement, opts: Record<string, unknown>) => unknown;
      tileLayer: (url: string, opts: Record<string, unknown>) => LLayer;
      circleMarker: (latlng: [number, number], opts: Record<string, unknown>) => LLayer;
      circle: (latlng: [number, number], opts: Record<string, unknown>) => LLayer;
      marker: (latlng: [number, number], opts?: Record<string, unknown>) => LLayer;
      divIcon: (opts: Record<string, unknown>) => unknown;
    };
    if (!L) return;

    const map = L.map(mapRef.current, {
      center: [lat, lng] as unknown as Record<string, unknown>,
      zoom: 15,
      zoomControl: false,
      attributionControl: false,
    } as Record<string, unknown>);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
    }).addTo(map);

    L.circle([lat, lng], {
      radius: 500,
      color: "#C9A84C",
      fillColor: "#C9A84C",
      fillOpacity: 0.05,
      weight: 1,
      dashArray: "5,5",
    }).addTo(map);

    const mainIcon = L.divIcon({
      html: `<div style="width:20px;height:20px;background:#C9A84C;border:3px solid white;border-radius:50%;"></div>`,
      iconSize: [20, 20] as unknown as Record<string, unknown>,
      iconAnchor: [10, 10] as unknown as Record<string, unknown>,
      className: "",
    });
    L.marker([lat, lng], { icon: mainIcon } as Record<string, unknown>)
      .addTo(map)
      .bindPopup("<b>Ponto analisado</b>");

    pois.forEach((poi) => {
      const poiColor = POI_COLORS[poi.type] || "#8B949E";
      L.circleMarker([poi.lat, poi.lng], {
        radius: 5,
        fillColor: poiColor,
        color: poiColor,
        weight: 1,
        fillOpacity: 0.8,
      })
        .addTo(map)
        .bindPopup(`<b>${poi.name}</b><br>${poi.type} · ${poi.distance_m}m`);
    });

    chargers.forEach((c) => {
      const chargerIcon = L.divIcon({
        html: `<div style="width:14px;height:14px;background:#F44336;border:2px solid white;border-radius:50%;"></div>`,
        iconSize: [14, 14] as unknown as Record<string, unknown>,
        iconAnchor: [7, 7] as unknown as Record<string, unknown>,
        className: "",
      });
      L.marker([c.lat, c.lng], { icon: chargerIcon } as Record<string, unknown>)
        .addTo(map)
        .bindPopup(`<b>⚡ ${c.name}</b><br>${c.distance_m}m`);
    });

    mapInstanceRef.current = map;
  }, [lat, lng, pois, chargers]);

  return <div ref={mapRef} className="h-full w-full rounded-lg" />;
}

// ---------- Source Badge ----------

function SourceBadge({ source }: { source: ScoreSource }) {
  const cfg = SOURCE_BADGE[source];
  return (
    <span
      className="inline-flex rounded px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
      style={{ backgroundColor: cfg.bg, color: cfg.fg }}
    >
      {cfg.label}
    </span>
  );
}

// ---------- Editable Number Input (com valor original em cinza) ----------

function EditableNumber({
  label,
  value,
  original,
  onChange,
  step = 1,
  min = 0,
  suffix,
}: {
  label: string;
  value: number;
  original: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  suffix?: string;
}) {
  const isEdited = Number(value) !== Number(original);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label className="text-xs text-[#C9D1D9]">{label}</label>
        <span className="text-[10px] text-[#484F58]">
          (original: {original.toLocaleString("pt-BR")}
          {suffix ? ` ${suffix}` : ""})
          {isEdited && (
            <span className="ml-1 text-[#C9A84C]">(editado)</span>
          )}
        </span>
      </div>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`w-full rounded-md border bg-[#0D1117] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-[#C9A84C] ${
          isEdited ? "border-[#C9A84C]" : "border-[#30363D]"
        }`}
      />
    </div>
  );
}

// ---------- Review Panel (admin) ----------

interface ReviewPanelProps {
  collectedRaw: CollectResponse;
  editedData: CollectedData;
  editedType: string;
  editedObservations: string;
  previewScore: EngineScoreResult | null;
  generatingFinal: boolean;
  onUpdateField: <K extends keyof CollectedData>(field: K, value: CollectedData[K]) => void;
  onSetHubNearby: (checked: boolean) => void;
  onChangeType: (t: string) => void;
  onChangeObservations: (o: string) => void;
  onCalculatePreview: () => void;
  onGenerateFinal: () => void;
  onCancel: () => void;
}

function ReviewPanel({
  collectedRaw,
  editedData,
  editedType,
  editedObservations,
  previewScore,
  generatingFinal,
  onUpdateField,
  onSetHubNearby,
  onChangeType,
  onChangeObservations,
  onCalculatePreview,
  onGenerateFinal,
  onCancel,
}: ReviewPanelProps) {
  const original = collectedRaw.collected;
  const hubChecked = !!editedData.hasAirportNearby || !!editedData.hasRodoviariaNearby;
  const hubOriginal = !!original.hasAirportNearby || !!original.hasRodoviariaNearby;
  const typeEdited = editedType !== (collectedRaw.establishment_type || "outro");
  const obsEdited = editedObservations !== (collectedRaw.establishment_name || "");

  const cardClass = (anyEdited: boolean) =>
    `rounded-xl border bg-[#161B22] p-5 ${
      anyEdited ? "border-[#C9A84C]" : "border-[#30363D]"
    }`;

  const anyEditedInCard = (...fields: Array<keyof CollectedData>) =>
    fields.some((f) => Number(editedData[f]) !== Number(original[f]));

  return (
    <div className="mt-8 space-y-5">
      {/* Header com prévia */}
      <div className="rounded-xl border border-[#C9A84C]/40 bg-[#161B22] p-6 text-center">
        <p className="text-xs uppercase tracking-wider text-[#C9A84C]">
          Revisão de Dados Coletados (admin)
        </p>
        <p className="mt-1 text-sm text-[#8B949E]">
          {collectedRaw.address || `${collectedRaw.lat.toFixed(5)}, ${collectedRaw.lng.toFixed(5)}`}
          {" · "}
          {collectedRaw.city}/{collectedRaw.state}
        </p>

        {previewScore ? (
          <div className="mt-4 flex flex-col items-center gap-2">
            <div className="text-6xl font-bold text-white">
              {previewScore.overallScore}
              <span className="ml-1 text-2xl text-[#8B949E]">/100</span>
            </div>
            <span
              className="rounded-full px-3 py-1 text-xs font-semibold"
              style={{
                backgroundColor: getClassificationColor(previewScore.classification) + "22",
                color: getClassificationColor(previewScore.classification),
              }}
            >
              {getClassificationLabel(previewScore.classification)}
            </span>
            <p className="text-[10px] text-[#484F58]">
              Prévia client-side · score bruto {previewScore.rawScore} · fator cidade{" "}
              {previewScore.cityFactor.toFixed(2)}
            </p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-[#8B949E]">
            Edite os dados abaixo e clique em &quot;Calcular Prévia&quot; para ver o score atualizado.
          </p>
        )}
      </div>

      {/* Card: Cidade e Demografia */}
      <div className={cardClass(anyEditedInCard("population", "gdpPerCapita"))}>
        <h3 className="mb-3 text-sm font-semibold text-white">🏙️ Cidade e Demografia</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <EditableNumber
            label="População"
            value={editedData.population}
            original={original.population}
            onChange={(n) => onUpdateField("population", n)}
          />
          <EditableNumber
            label="PIB per capita (R$)"
            value={editedData.gdpPerCapita}
            original={original.gdpPerCapita}
            onChange={(n) => onUpdateField("gdpPerCapita", n)}
          />
        </div>
      </div>

      {/* Card: Frota EV */}
      <div className={cardClass(anyEditedInCard("abveEVs"))}>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          ⚡ Frota EV
          <span
            className="rounded px-2 py-0.5 text-[10px] font-semibold"
            style={{
              backgroundColor:
                original.abveSource === "ABVE" ? "#C9A84C22" : "#FFC10722",
              color: original.abveSource === "ABVE" ? "#C9A84C" : "#FFC107",
            }}
          >
            Fonte: {original.abveSource}
          </span>
        </h3>
        <div className="grid gap-4 md:grid-cols-1">
          <EditableNumber
            label="EVs na cidade"
            value={editedData.abveEVs}
            original={original.abveEVs}
            onChange={(n) => onUpdateField("abveEVs", n)}
          />
        </div>
      </div>

      {/* Card: Concorrentes */}
      <div
        className={cardClass(
          anyEditedInCard("dcInCity", "dcIn200m", "dcIn500m", "dcIn1km", "dcIn2km")
        )}
      >
        <h3 className="mb-3 text-sm font-semibold text-white">
          🏁 Concorrentes (banco PLUGGON)
        </h3>
        <div className="grid gap-4 md:grid-cols-3">
          <EditableNumber
            label="DC na cidade (total)"
            value={editedData.dcInCity}
            original={original.dcInCity}
            onChange={(n) => onUpdateField("dcInCity", n)}
          />
          <div>
            <EditableNumber
              label="DC em 200m"
              value={editedData.dcIn200m}
              original={original.dcIn200m}
              onChange={(n) => onUpdateField("dcIn200m", n)}
            />
            {original.dcNamesIn200m.length > 0 && (
              <p className="mt-1 text-[10px] text-[#8B949E]">
                {original.dcNamesIn200m.join(" · ")}
              </p>
            )}
          </div>
          <div>
            <EditableNumber
              label="DC em 500m"
              value={editedData.dcIn500m}
              original={original.dcIn500m}
              onChange={(n) => onUpdateField("dcIn500m", n)}
            />
            {original.dcNamesIn500m.length > 0 && (
              <p className="mt-1 text-[10px] text-[#8B949E]">
                {original.dcNamesIn500m.join(" · ")}
              </p>
            )}
          </div>
          <div>
            <EditableNumber
              label="DC em 1km"
              value={editedData.dcIn1km}
              original={original.dcIn1km}
              onChange={(n) => onUpdateField("dcIn1km", n)}
            />
            {original.dcNamesIn1km.length > 0 && (
              <p className="mt-1 text-[10px] text-[#8B949E]">
                {original.dcNamesIn1km.length} concorrente(s) listado(s)
              </p>
            )}
          </div>
          <div>
            <EditableNumber
              label="DC em 2km"
              value={editedData.dcIn2km}
              original={original.dcIn2km}
              onChange={(n) => onUpdateField("dcIn2km", n)}
            />
            {original.dcNamesIn2km.length > 0 && (
              <p className="mt-1 text-[10px] text-[#8B949E]">
                {original.dcNamesIn2km.length} concorrente(s) listado(s)
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Card: POIs */}
      <div
        className={cardClass(
          anyEditedInCard(
            "restaurants",
            "supermarkets",
            "gasStations",
            "shoppings",
            "hotels",
            "parkingLots",
            "airports",
            "busStations",
            "universities",
            "hospitals"
          )
        )}
      >
        <h3 className="mb-3 text-sm font-semibold text-white">
          🏪 POIs Google Places
        </h3>
        <div className="grid gap-4 md:grid-cols-3">
          <EditableNumber
            label="Restaurantes/cafés 500m"
            value={editedData.restaurants}
            original={original.restaurants}
            onChange={(n) => onUpdateField("restaurants", n)}
          />
          <EditableNumber
            label="Supermercados 500m"
            value={editedData.supermarkets}
            original={original.supermarkets}
            onChange={(n) => onUpdateField("supermarkets", n)}
          />
          <EditableNumber
            label="Postos combustível 500m"
            value={editedData.gasStations}
            original={original.gasStations}
            onChange={(n) => onUpdateField("gasStations", n)}
          />
          <EditableNumber
            label="Shoppings 1km"
            value={editedData.shoppings}
            original={original.shoppings}
            onChange={(n) => onUpdateField("shoppings", n)}
          />
          <EditableNumber
            label="Hotéis 1km"
            value={editedData.hotels}
            original={original.hotels}
            onChange={(n) => onUpdateField("hotels", n)}
          />
          <EditableNumber
            label="Estacionamentos 500m"
            value={editedData.parkingLots}
            original={original.parkingLots}
            onChange={(n) => onUpdateField("parkingLots", n)}
          />
          <EditableNumber
            label="Aeroportos 5km"
            value={editedData.airports}
            original={original.airports}
            onChange={(n) => onUpdateField("airports", n)}
          />
          <EditableNumber
            label="Rodoviárias 3km"
            value={editedData.busStations}
            original={original.busStations}
            onChange={(n) => onUpdateField("busStations", n)}
          />
          <EditableNumber
            label="Universidades 2km"
            value={editedData.universities}
            original={original.universities}
            onChange={(n) => onUpdateField("universities", n)}
          />
          <EditableNumber
            label="Hospitais 2km"
            value={editedData.hospitals}
            original={original.hospitals}
            onChange={(n) => onUpdateField("hospitals", n)}
          />
          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <label className="text-xs text-[#C9D1D9]">Total POIs 500m</label>
              <span className="text-[10px] text-[#484F58]">(calculado)</span>
            </div>
            <div className="rounded-md border border-[#30363D] bg-[#0D1117] px-3 py-2 text-sm text-[#8B949E]">
              {editedData.totalPOIs500m}
            </div>
          </div>
        </div>
      </div>

      {/* Card: Localização */}
      <div className={cardClass(editedData.distanceToCenter !== original.distanceToCenter || hubChecked !== hubOriginal)}>
        <h3 className="mb-3 text-sm font-semibold text-white">📍 Localização</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <EditableNumber
            label="Distância ao centro (km)"
            value={editedData.distanceToCenter}
            original={original.distanceToCenter}
            onChange={(n) => onUpdateField("distanceToCenter", n)}
            step={0.1}
          />
          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <label className="text-xs text-[#C9D1D9]">Hub transporte próximo</label>
              <span className="text-[10px] text-[#484F58]">
                (original: {hubOriginal ? "sim" : "não"})
                {hubChecked !== hubOriginal && (
                  <span className="ml-1 text-[#C9A84C]">(editado)</span>
                )}
              </span>
            </div>
            <label
              className={`flex cursor-pointer items-center gap-2 rounded-md border bg-[#0D1117] px-3 py-2 text-sm text-white ${
                hubChecked !== hubOriginal ? "border-[#C9A84C]" : "border-[#30363D]"
              }`}
            >
              <input
                type="checkbox"
                checked={hubChecked}
                onChange={(e) => onSetHubNearby(e.target.checked)}
                className="h-4 w-4 accent-[#C9A84C]"
              />
              <span>{hubChecked ? "Sim — aeroporto/rodoviária próximos" : "Não"}</span>
            </label>
          </div>
        </div>
      </div>

      {/* Card: Tipo e Observações */}
      <div
        className={`rounded-xl border bg-[#161B22] p-5 ${
          typeEdited || obsEdited ? "border-[#C9A84C]" : "border-[#30363D]"
        }`}
      >
        <h3 className="mb-3 text-sm font-semibold text-white">📝 Tipo e Observações</h3>
        <div className="grid gap-4">
          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <label className="text-xs text-[#C9D1D9]">Tipo de estabelecimento</label>
              <span className="text-[10px] text-[#484F58]">
                (original:{" "}
                {ESTABLISHMENT_TYPES[collectedRaw.establishment_type] ||
                  collectedRaw.establishment_type}
                )
                {typeEdited && <span className="ml-1 text-[#C9A84C]">(editado)</span>}
              </span>
            </div>
            <select
              value={editedType}
              onChange={(e) => onChangeType(e.target.value)}
              className={`w-full rounded-md border bg-[#0D1117] px-3 py-2 text-sm text-white outline-none ${
                typeEdited ? "border-[#C9A84C]" : "border-[#30363D]"
              }`}
            >
              {Object.entries(ESTABLISHMENT_TYPES).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <label className="text-xs text-[#C9D1D9]">Observações</label>
              <span className="text-[10px] text-[#484F58]">
                {obsEdited && <span className="text-[#C9A84C]">(editado)</span>}
              </span>
            </div>
            <textarea
              value={editedObservations}
              onChange={(e) => onChangeObservations(e.target.value)}
              rows={3}
              className={`w-full rounded-md border bg-[#0D1117] px-3 py-2 text-sm text-white outline-none ${
                obsEdited ? "border-[#C9A84C]" : "border-[#30363D]"
              }`}
            />
          </div>
        </div>
      </div>

      {/* Botões de ação */}
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <button
          type="button"
          onClick={onCalculatePreview}
          disabled={generatingFinal}
          className="rounded-lg border border-[#C9A84C] bg-transparent px-6 py-3 font-semibold text-[#C9A84C] transition-colors hover:bg-[#C9A84C]/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Calcular Prévia do Score
        </button>
        <button
          type="button"
          onClick={onGenerateFinal}
          disabled={generatingFinal}
          className="flex items-center gap-2 rounded-lg bg-[#C9A84C] px-6 py-3 font-semibold text-[#0D1117] transition-colors hover:bg-[#B89443] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {generatingFinal ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#0D1117] border-t-transparent" />
              Gerando...
            </>
          ) : (
            "Gerar Score Final"
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={generatingFinal}
          className="rounded-lg border border-[#30363D] bg-transparent px-6 py-3 text-sm text-[#8B949E] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>

      {collectedRaw.cost_breakdown && (
        <p className="text-center text-[11px] text-[#484F58]">
          Custo da coleta: US$ {collectedRaw.cost_breakdown.totalCostUsd.toFixed(4)} (
          {collectedRaw.cost_breakdown.googleQueries} queries Google) · Prévia roda
          client-side (zero custo) · &quot;Gerar Final&quot; chama Claude 1×.
        </p>
      )}
    </div>
  );
}

// ---------- Main Page ----------

export default function ScorePage() {
  return (
    <Suspense fallback={<div className="p-8 text-[#8B949E]">Carregando...</div>}>
      <ScorePageInner />
    </Suspense>
  );
}

function ScorePageInner() {
  const searchParams = useSearchParams();
  const [address, setAddress] = useState(searchParams.get("address") || "");
  const [establishmentType, setEstablishmentType] = useState(searchParams.get("type") || "");
  const [establishmentName, setEstablishmentName] = useState(searchParams.get("name") || "");
  const [addressTab, setAddressTab] = useState<"address" | "gmaps">("address");
  const [gmapsLink, setGmapsLink] = useState("");
  const [gmapsError, setGmapsError] = useState("");
  const [parsedCoords, setParsedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [scoreId, setScoreId] = useState<number | null>(null);
  const [leafletLoaded, setLeafletLoaded] = useState(false);

  // Local state for client-side observation re-edit
  const [extraObservation, setExtraObservation] = useState("");
  const [obsDraftOpen, setObsDraftOpen] = useState(false);
  const [canSeeCost, setCanSeeCost] = useState(false);

  // Admin: fluxo coleta → revisão → final
  const [isAdmin, setIsAdmin] = useState(false);
  const [collectedRaw, setCollectedRaw] = useState<CollectResponse | null>(null);
  const [editedData, setEditedData] = useState<CollectedData | null>(null);
  const [editedType, setEditedType] = useState("");
  const [editedObservations, setEditedObservations] = useState("");
  const [previewScore, setPreviewScore] = useState<EngineScoreResult | null>(null);
  const [generatingFinal, setGeneratingFinal] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email === COST_VIEWER_EMAIL) setCanSeeCost(true);
      if (user?.email && ADMIN_EMAILS.includes(user.email)) setIsAdmin(true);
    });
  }, []);

  useEffect(() => {
    if (document.getElementById("leaflet-css")) {
      setLeafletLoaded(true);
      return;
    }
    const css = document.createElement("link");
    css.id = "leaflet-css";
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(css);

    const js = document.createElement("script");
    js.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    js.onload = () => setLeafletLoaded(true);
    document.head.appendChild(js);
  }, []);

  useEffect(() => {
    if (loading) {
      setLoadingStep(0);
      intervalRef.current = setInterval(() => {
        setLoadingStep((prev) => (prev < LOADING_STEPS.length - 1 ? prev + 1 : prev));
      }, 3000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [loading]);

  function parseGoogleMapsLink(link: string): { lat: number; lng: number } | null {
    const match1 = link.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (match1) return { lat: parseFloat(match1[1]), lng: parseFloat(match1[2]) };
    const match2 = link.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (match2) return { lat: parseFloat(match2[1]), lng: parseFloat(match2[2]) };
    const match3 = link.match(/ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (match3) return { lat: parseFloat(match3[1]), lng: parseFloat(match3[2]) };
    return null;
  }

  async function handleGmapsLink(link: string) {
    setGmapsLink(link);
    setGmapsError("");
    setParsedCoords(null);

    if (!link.trim()) return;

    if (/goo\.gl/.test(link)) {
      setGmapsError(
        "Link curto não suportado. Abra o Google Maps, clique no local e copie o link completo da barra de endereço."
      );
      return;
    }

    const coords = parseGoogleMapsLink(link);
    if (!coords) {
      setGmapsError(
        "Não foi possível extrair coordenadas deste link. Copie o link completo da barra de endereço do Google Maps."
      );
      return;
    }

    setParsedCoords(coords);

    try {
      const res = await fetch(`/api/reverse-geocode?lat=${coords.lat}&lng=${coords.lng}`);
      if (res.ok) {
        const data = await res.json();
        if (data.address) setAddress(data.address);
      }
    } catch {
      // continue
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim() && !parsedCoords) return;

    setLoading(true);
    setError("");
    setResult(null);
    setExtraObservation("");
    setCollectedRaw(null);
    setEditedData(null);
    setPreviewScore(null);

    try {
      const payload: Record<string, unknown> = {
        address: address.trim(),
        establishment_type: establishmentType || "outro",
        establishment_name: establishmentName.trim(),
      };
      if (parsedCoords) {
        payload.lat = parsedCoords.lat;
        payload.lng = parsedCoords.lng;
      }
      if (isAdmin) payload.mode = "collect";

      const res = await fetch("/api/score-point", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erro ao analisar o ponto.");
        return;
      }

      if (isAdmin && data?.mode === "collect") {
        const collected = data as CollectResponse;
        setCollectedRaw(collected);
        setEditedData({ ...collected.collected });
        setEditedType(collected.establishment_type || "outro");
        setEditedObservations(collected.establishment_name || "");
        // useEffect calcula a prévia automaticamente assim que editedData é setado
        return;
      }

      setResult(data);
      setScoreId((data?.score_id as number) ?? null);
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  function updateCollectedField<K extends keyof CollectedData>(
    field: K,
    value: CollectedData[K]
  ) {
    if (!editedData) return;
    const next = { ...editedData, [field]: value } as CollectedData;
    // totalPOIs500m é derivado dos POIs em raio de 500m
    next.totalPOIs500m =
      (next.restaurants || 0) +
      (next.supermarkets || 0) +
      (next.gasStations || 0) +
      (next.parkingLots || 0);
    // Counts de aeroporto/rodoviária mantêm sincronizados com os booleans
    if (field === "airports") next.hasAirportNearby = (value as number) > 0;
    if (field === "busStations") next.hasRodoviariaNearby = (value as number) > 0;
    setEditedData(next);
  }

  function setHubNearby(checked: boolean) {
    if (!editedData) return;
    setEditedData({
      ...editedData,
      hasAirportNearby: checked,
      hasRodoviariaNearby: checked,
    });
  }

  function calculatePreview() {
    if (!editedData) return;
    const result = calculateScore(
      buildScoreInput(editedData, editedType, editedObservations)
    );
    setPreviewScore(result);
  }

  // Prévia em tempo real (zero custo — roda no browser)
  useEffect(() => {
    if (!editedData) return;
    const result = calculateScore(
      buildScoreInput(editedData, editedType, editedObservations)
    );
    setPreviewScore(result);
  }, [editedData, editedType, editedObservations]);

  async function generateFinalScore() {
    if (!collectedRaw || !editedData) return;
    setGeneratingFinal(true);
    setError("");
    try {
      const payload = {
        mode: "final",
        address: collectedRaw.address,
        lat: collectedRaw.lat,
        lng: collectedRaw.lng,
        city: collectedRaw.city,
        state: collectedRaw.state,
        establishment_type: editedType,
        establishment_name: editedObservations,
        collected: editedData,
        ibge_data: collectedRaw.ibge_data,
        abve_data: collectedRaw.abve_data,
        nearby_pois: collectedRaw.nearby_pois,
        nearby_chargers: collectedRaw.nearby_chargers,
      };
      const res = await fetch("/api/score-point", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erro ao gerar score final.");
        return;
      }
      setResult(data);
      setScoreId((data?.score_id as number) ?? null);
      setCollectedRaw(null);
      setEditedData(null);
      setPreviewScore(null);
    } catch {
      setError("Erro de conexão ao gerar score final.");
    } finally {
      setGeneratingFinal(false);
    }
  }

  function applyObservation() {
    if (!result) return;
    const baseObs = (result.establishment_name || "").trim();
    const merged = [baseObs, extraObservation.trim()].filter(Boolean).join(" | ");
    const recomp = recomputeObservationScore(merged);

    const newVars = result.scoring_variables.map((v) =>
      v.category === "Observações"
        ? { ...v, score: recomp.score, justification: recomp.justification }
        : v
    );
    const newAgg = recomputeOverall(newVars, result.city_factor);
    setResult({
      ...result,
      scoring_variables: newVars,
      raw_score: newAgg.rawScore,
      overall_score: newAgg.overallScore,
      classification: newAgg.classification,
      category_scores: newAgg.categoryScores,
      establishment_name: merged,
    });
    setExtraObservation("");
    setObsDraftOpen(false);
  }

  // Group + sort variables
  const sortedVariables = useMemo(() => {
    if (!result) return [];
    const order = ["Demanda", "Concorrência", "Localização", "Amenidades", "Tipo de Ponto", "Observações"];
    return [...result.scoring_variables].sort((a, b) => {
      const da = order.indexOf(a.category);
      const db = order.indexOf(b.category);
      if (da !== db) return da - db;
      return a.id - b.id;
    });
  }, [result]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-white">Score do Ponto</h1>
      <p className="mt-1 text-[#8B949E]">
        Score 100% calculado por código a partir de dados verificáveis e dados demográficos oficiais.
      </p>

      {/* Form */}
      <form
        onSubmit={handleSubmit}
        className="mt-6 rounded-xl border border-[#30363D] bg-[#161B22] p-6"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-[#C9D1D9]">
              Observações <span className="text-[#484F58]">(opcional)</span>
            </label>
            <textarea
              value={establishmentName}
              onChange={(e) => setEstablishmentName(e.target.value)}
              placeholder="Ex: terreno próprio, frente pra avenida, operação 24h, próximo rodovia BR-277..."
              rows={3}
              className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-3 text-white placeholder-[#484F58] outline-none transition-colors focus:border-[#C9A84C]"
              disabled={loading}
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-[#C9D1D9]">
              Localização *
            </label>
            <div className="mb-2 flex gap-1 rounded-lg border border-[#30363D] bg-[#0D1117] p-1">
              <button
                type="button"
                onClick={() => setAddressTab("address")}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  addressTab === "address"
                    ? "bg-[#C9A84C] text-[#0D1117]"
                    : "text-[#8B949E] hover:text-white"
                }`}
              >
                Endereço
              </button>
              <button
                type="button"
                onClick={() => setAddressTab("gmaps")}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  addressTab === "gmaps"
                    ? "bg-[#C9A84C] text-[#0D1117]"
                    : "text-[#8B949E] hover:text-white"
                }`}
              >
                Link do Google Maps
              </button>
            </div>

            {addressTab === "address" ? (
              <input
                type="text"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setParsedCoords(null);
                }}
                placeholder="Ex: Av. Paulista, 1000, São Paulo, SP"
                className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-3 text-white placeholder-[#484F58] outline-none transition-colors focus:border-[#C9A84C]"
                disabled={loading}
                required={addressTab === "address"}
              />
            ) : (
              <div>
                <input
                  type="text"
                  value={gmapsLink}
                  onChange={(e) => handleGmapsLink(e.target.value)}
                  placeholder="Cole aqui o link do Google Maps"
                  className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-3 text-white placeholder-[#484F58] outline-none transition-colors focus:border-[#C9A84C]"
                  disabled={loading}
                />
                {gmapsError && <p className="mt-1.5 text-sm text-yellow-400">{gmapsError}</p>}
                {parsedCoords && (
                  <p className="mt-1.5 text-sm text-green-400">
                    Coordenadas extraídas: {parsedCoords.lat.toFixed(6)}, {parsedCoords.lng.toFixed(6)}
                    {address && ` — ${address}`}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-[#C9D1D9]">
              Tipo de estabelecimento *
            </label>
            <select
              value={establishmentType}
              onChange={(e) => setEstablishmentType(e.target.value)}
              className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-3 text-white outline-none transition-colors focus:border-[#C9A84C]"
              disabled={loading}
              required
            >
              <option value="">Selecione...</option>
              {Object.entries(ESTABLISHMENT_TYPES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || (!address.trim() && !parsedCoords) || !establishmentType}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-[#C9A84C] px-6 py-3 font-semibold text-[#0D1117] transition-colors hover:bg-[#B89443] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#0D1117] border-t-transparent" />
              Analisando...
            </>
          ) : (
            <>Analisar Ponto</>
          )}
        </button>

        {loading && (
          <div className="mt-4 space-y-2">
            {LOADING_STEPS.map((step, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                {i < loadingStep ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="#C9A84C">
                    <path d="M8 0a8 8 0 110 16A8 8 0 018 0zm3.78 5.22a.75.75 0 00-1.06 0L7 8.94 5.28 7.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l4.25-4.25a.75.75 0 000-1.06z" />
                  </svg>
                ) : i === loadingStep ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#C9A84C] border-t-transparent" />
                ) : (
                  <div className="h-4 w-4 rounded-full border border-[#30363D]" />
                )}
                <span className={i <= loadingStep ? "text-[#C9D1D9]" : "text-[#484F58]"}>
                  {step}
                </span>
              </div>
            ))}
          </div>
        )}
      </form>

      {/* Tela de Revisão (admin) — antes de calcular score final */}
      {isAdmin && collectedRaw && editedData && !result && (
        <ReviewPanel
          collectedRaw={collectedRaw}
          editedData={editedData}
          editedType={editedType}
          editedObservations={editedObservations}
          previewScore={previewScore}
          generatingFinal={generatingFinal}
          onUpdateField={updateCollectedField}
          onSetHubNearby={setHubNearby}
          onChangeType={(t) => setEditedType(t)}
          onChangeObservations={(o) => setEditedObservations(o)}
          onCalculatePreview={calculatePreview}
          onGenerateFinal={generateFinalScore}
          onCancel={() => {
            setCollectedRaw(null);
            setEditedData(null);
            setPreviewScore(null);
          }}
        />
      )}

      {/* Results */}
      {result && (
        <div className="mt-8 space-y-6">
          {/* Top: Gauge + Map */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="flex flex-col items-center justify-center rounded-xl border border-[#30363D] bg-[#161B22] p-6">
              <ScoreGauge score={result.overall_score} classification={result.classification} />
              <div className="mt-4 text-center">
                <p className="text-sm text-[#8B949E]">{result.address}</p>
                <p className="mt-1 text-xs text-[#484F58]">
                  {result.city} - {result.state} · {result.lat.toFixed(5)}, {result.lng.toFixed(5)}
                </p>
                <p className="mt-2 text-[11px] text-[#484F58]">
                  Score bruto: {result.raw_score} | Fator cidade: {result.city_factor.toFixed(2)}
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-[#30363D] bg-[#161B22] lg:col-span-2">
              <div className="flex items-center justify-between border-b border-[#30363D] px-4 py-3">
                <h3 className="text-sm font-semibold text-white">Mapa do Entorno (500m)</h3>
                <div className="flex items-center gap-3 text-xs text-[#8B949E]">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#C9A84C" }} />
                    Ponto
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#F44336" }} />
                    Carregadores
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#4ECDC4" }} />
                    POIs
                  </span>
                </div>
              </div>
              <div style={{ height: 320 }}>
                {leafletLoaded ? (
                  <MiniMap
                    lat={result.lat}
                    lng={result.lng}
                    pois={result.nearby_pois}
                    chargers={result.nearby_chargers}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-[#8B949E]">
                    Carregando mapa...
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className="rounded-lg border border-[#30363D] bg-[#161B22] p-4">
              <p className="text-xs text-[#8B949E]">População</p>
              <p className="mt-1 text-xl font-bold text-white">
                {result.ibge_data.population?.toLocaleString("pt-BR") ?? "N/D"}
              </p>
            </div>
            <div className="rounded-lg border border-[#30363D] bg-[#161B22] p-4">
              <p className="text-xs text-[#8B949E]">PIB per capita</p>
              <p className="mt-1 text-xl font-bold text-white">
                {result.ibge_data.gdp_per_capita
                  ? `R$ ${Math.round(result.ibge_data.gdp_per_capita).toLocaleString("pt-BR")}`
                  : "N/D"}
              </p>
            </div>
            <div className="rounded-lg border border-[#30363D] bg-[#161B22] p-4">
              <p className="text-xs text-[#8B949E]">Carregadores rápidos na cidade</p>
              <p className="mt-1 text-xl font-bold text-white">
                {result.abve_data?.dc ?? "N/D"}
              </p>
            </div>
            <div className="rounded-lg border border-[#30363D] bg-[#161B22] p-4">
              <p className="text-xs text-[#8B949E]">EVs na cidade</p>
              <p className="mt-1 text-xl font-bold text-white">
                {result.abve_data?.evsSold?.toLocaleString("pt-BR") ?? "N/D"}
              </p>
            </div>
            <div className="rounded-lg border border-[#30363D] bg-[#161B22] p-4">
              <p className="text-xs text-[#8B949E]">Concorrentes 500m</p>
              <p className="mt-1 text-xl font-bold text-white">
                {result.scoring_variables.find((v) => v.name === "Concorrência Próxima (500m)")?.score ?? "—"}
                <span className="ml-1 text-sm font-normal text-[#8B949E]">/10</span>
              </p>
            </div>
          </div>

          {/* Variables Table */}
          <div className="overflow-hidden rounded-xl border border-[#30363D] bg-[#161B22]">
            <div className="flex items-center justify-between border-b border-[#30363D] px-5 py-3">
              <h3 className="text-base font-semibold text-white">
                Variáveis do Score ({sortedVariables.length})
              </h3>
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                {(() => {
                  const seenLabels = new Set<string>();
                  const unique: ScoreSource[] = [];
                  for (const s of Object.keys(SOURCE_BADGE) as ScoreSource[]) {
                    const label = SOURCE_BADGE[s].label;
                    if (!seenLabels.has(label)) {
                      seenLabels.add(label);
                      unique.push(s);
                    }
                  }
                  return unique.map((s) => <SourceBadge key={s} source={s} />);
                })()}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#0D1117] text-left text-xs uppercase text-[#8B949E]">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">#</th>
                    <th className="px-4 py-2.5 font-medium">Variável</th>
                    <th className="px-4 py-2.5 font-medium">Categoria</th>
                    <th className="px-4 py-2.5 font-medium text-center">Peso</th>
                    <th className="px-4 py-2.5 font-medium text-center">Nota</th>
                    <th className="px-4 py-2.5 font-medium">Fonte</th>
                    <th className="px-4 py-2.5 font-medium">Justificativa</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedVariables.map((v) => {
                    const color = getScoreColor(v.score);
                    return (
                      <tr key={v.id} className="border-t border-[#21262D] hover:bg-[#0D1117]">
                        <td className="px-4 py-3 text-xs text-[#8B949E]">{v.id}</td>
                        <td className="px-4 py-3 text-[#C9D1D9]">{v.name}</td>
                        <td className="px-4 py-3 text-xs text-[#8B949E]">
                          {CATEGORY_ICONS[v.category]} {CATEGORY_LABELS[v.category] || v.category}
                        </td>
                        <td className="px-4 py-3 text-center text-xs text-[#8B949E]">×{v.weight}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-base font-bold" style={{ color }}>
                            {v.score.toFixed(1)}
                          </span>
                        </td>
                        <td className="px-4 py-3"><SourceBadge source={v.source} /></td>
                        <td className="px-4 py-3 text-xs text-[#8B949E]">{v.justification}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Category scores summary */}
            <div className="border-t border-[#30363D] bg-[#0D1117] px-5 py-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                {Object.entries(result.category_scores).map(([cat, score]) => (
                  <div key={cat} className="text-xs">
                    <div className="text-[#8B949E]">
                      {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat] || cat}
                    </div>
                    <div
                      className="mt-0.5 text-base font-bold"
                      style={{ color: getScoreColor(score) }}
                    >
                      {score.toFixed(1)}<span className="ml-1 text-[10px] text-[#8B949E]">/10</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Fontes de Dados (cruzamento de fontes para concorrentes / DC) — admin only */}
          {canSeeCost && result.data_sources && (
            <div className="overflow-hidden rounded-xl border border-[#30363D] bg-[#161B22]">
              <div className="flex items-center justify-between border-b border-[#30363D] px-5 py-3">
                <h3 className="text-base font-semibold text-white">
                  🔎 Fontes de Dados — Concorrentes / DC na Cidade
                </h3>
                <span className="text-xs text-[#8B949E]">
                  Melhor DC: <span className="font-semibold text-white">{result.data_sources.best_dc.value}</span>
                  {" "}({result.data_sources.best_dc.source})
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#0D1117] text-left text-xs uppercase text-[#8B949E]">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Fonte</th>
                      <th className="px-4 py-2.5 font-medium text-center">Total</th>
                      <th className="px-4 py-2.5 font-medium text-center">DC</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium">Detalhes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data_sources.cross_check.map((s) => {
                      const statusLabel =
                        s.status === "ok"
                          ? "✅ Dado oficial"
                          : s.status === "partial"
                          ? "⚠️ Parcial"
                          : "❌ Indisponível";
                      const statusColor =
                        s.status === "ok"
                          ? "text-[#4CAF50]"
                          : s.status === "partial"
                          ? "text-[#FFC107]"
                          : "text-[#8B949E]";
                      return (
                        <tr key={s.source} className="border-t border-[#21262D] hover:bg-[#0D1117]">
                          <td className="px-4 py-3 text-[#C9D1D9]">{s.source}</td>
                          <td className="px-4 py-3 text-center text-[#C9D1D9]">
                            {s.total ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-center text-[#C9D1D9]">
                            {s.dc ?? "—"}
                          </td>
                          <td className={`px-4 py-3 text-xs ${statusColor}`}>{statusLabel}</td>
                          <td className="px-4 py-3 text-xs text-[#8B949E]">{s.details}</td>
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-[#30363D] bg-[#0D1117]">
                      <td className="px-4 py-3 font-semibold text-[#C9A84C]">MELHOR DADO</td>
                      <td className="px-4 py-3 text-center font-bold text-white">
                        {result.data_sources.best_total.value}
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-white">
                        {result.data_sources.best_dc.value}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#C9A84C]" colSpan={2}>
                        Fonte total: {result.data_sources.best_total.source}
                        {" · "}Fonte DC: {result.data_sources.best_dc.source}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Adicionar Observação (zero custo) */}
          <div className="rounded-xl border border-[#A06CD5]/30 bg-[#A06CD5]/5 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-[#B98AE0]">
                  ➕ Adicionar Observação
                </h3>
                <p className="mt-1 text-xs text-[#8B949E]">
                  Recalcula apenas a variável de Observações (custo zero — sem chamadas de API).
                </p>
              </div>
              {!obsDraftOpen && (
                <button
                  type="button"
                  onClick={() => setObsDraftOpen(true)}
                  className="rounded-lg border border-[#A06CD5] bg-transparent px-4 py-1.5 text-sm font-semibold text-[#B98AE0] transition-colors hover:bg-[#A06CD5]/10"
                >
                  Adicionar
                </button>
              )}
            </div>
            {obsDraftOpen && (
              <div className="mt-3 space-y-3">
                <textarea
                  value={extraObservation}
                  onChange={(e) => setExtraObservation(e.target.value)}
                  placeholder="Ex: terreno tem transformador trifásico dedicado, esquina movimentada, câmeras 24h..."
                  rows={3}
                  className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-3 text-sm text-white placeholder-[#484F58] outline-none transition-colors focus:border-[#A06CD5]"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={applyObservation}
                    disabled={!extraObservation.trim()}
                    className="rounded-lg bg-[#A06CD5] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#8B5DBF] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Aplicar e Recalcular
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExtraObservation("");
                      setObsDraftOpen(false);
                    }}
                    className="rounded-lg border border-[#30363D] bg-transparent px-4 py-2 text-sm text-[#8B949E] hover:text-white"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Strengths */}
          <div className="rounded-xl border border-[#C9A84C]/30 bg-[#C9A84C]/5 p-5">
            <h3 className="mb-3 text-base font-semibold text-[#C9A84C]">✓ Pontos Fortes</h3>
            <ul className="space-y-2">
              {result.strengths.length === 0 && (
                <li className="text-sm text-[#8B949E]">Nenhum ponto forte gerado.</li>
              )}
              {result.strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-[#C9D1D9]">
                  <span className="mt-1 text-[#C9A84C]">•</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>

          {/* Cost Card — admin only */}
          {canSeeCost && result.cost_breakdown && (
          <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-5">
            <h3 className="mb-3 text-base font-semibold text-white">💰 Custo desta análise</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-[#2196F3]/20 bg-[#2196F3]/5 p-3">
                <p className="text-xs text-[#5BB3F0]">Google Places</p>
                <p className="mt-1 text-lg font-bold text-white">
                  {result.cost_breakdown.googleQueries} queries
                </p>
                <p className="text-xs text-[#8B949E]">
                  US$ {result.cost_breakdown.googleCostUsd.toFixed(4)}
                </p>
              </div>
              <div className="rounded-lg border border-[#A06CD5]/20 bg-[#A06CD5]/5 p-3">
                <p className="text-xs text-[#B98AE0]">Claude (texto)</p>
                <p className="mt-1 text-lg font-bold text-white">
                  {(result.cost_breakdown.claudeTokensIn + result.cost_breakdown.claudeTokensOut).toLocaleString("pt-BR")} tokens
                </p>
                <p className="text-xs text-[#8B949E]">
                  in {result.cost_breakdown.claudeTokensIn} / out {result.cost_breakdown.claudeTokensOut} · US$ {result.cost_breakdown.claudeCostUsd.toFixed(4)}
                </p>
              </div>
              <div className="rounded-lg border border-[#C9A84C]/20 bg-[#C9A84C]/5 p-3">
                <p className="text-xs text-[#C9A84C]">Total</p>
                <p className="mt-1 text-lg font-bold text-white">
                  US$ {result.cost_breakdown.totalCostUsd.toFixed(4)}
                </p>
                <p className="text-xs text-[#8B949E]">
                  ≈ R$ {(result.cost_breakdown.totalCostUsd * 5).toFixed(3)}
                </p>
              </div>
            </div>
          </div>
          )}

          {/* CTA */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (!scoreId) {
                  alert("Aguarde — salvando no histórico...");
                  return;
                }
                window.open(`/score-print/${scoreId}`, "_blank");
              }}
              disabled={!scoreId}
              className="rounded-lg bg-[#C9A84C] px-6 py-3 font-semibold text-[#0D1117] transition-colors hover:bg-[#B89443] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Exportar PDF
            </button>

            <button
              type="button"
              onClick={() => {
                const html = buildScoreHtml(result);
                const blob = new Blob([html], { type: "text/html;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                const safeCity = result.city.replace(/[^a-zA-Z0-9]/g, "_");
                a.href = url;
                a.download = `score-ponto-${safeCity}-${Date.now()}.html`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }}
              className="rounded-lg bg-[#C9A84C] px-6 py-3 font-semibold text-[#0D1117] transition-colors hover:bg-[#B89443]"
            >
              Exportar HTML
            </button>

            <button
              type="button"
              onClick={() => {
                setResult(null);
                setScoreId(null);
              }}
              className="rounded-lg border border-[#C9A84C] bg-transparent px-6 py-3 font-semibold text-[#C9A84C] transition-colors hover:bg-[#C9A84C]/10"
            >
              Nova Análise
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
