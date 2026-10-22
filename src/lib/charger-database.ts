import type { SupabaseClient } from "@supabase/supabase-js";
import { ScoreDataError } from "@/lib/score/errors";

// ============================================================
// Tipos
// ============================================================

export type ChargerType = "DC" | "AC" | "unknown";
export type Confidence = "high" | "medium" | "low";

export interface ChargerRow {
  id?: number;
  city: string;
  state: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  power_kw: number;
  charger_type: ChargerType;
  connector?: string;
  operator?: string;
  source: string;
  verified: boolean;
}

export interface ChargersNearPoint {
  in200m: ChargerRow[];
  in500m: ChargerRow[];
  in1km: ChargerRow[];
  in2km: ChargerRow[];
  in5km: ChargerRow[];
  dcIn200m: number;
  dcIn500m: number;
  dcIn1km: number;
  dcIn2km: number;
  dcInCity: number;
  totalInCity: number;
}

// ============================================================
// Classificação AC vs DC pelo nome
// ============================================================

export function classifyChargerType(
  name: string,
  operator?: string
): { type: ChargerType; estimatedPower: number; confidence: Confidence } {
  const text = (name + " " + (operator || "")).toLowerCase();

  const dcHighKeywords = [
    "supercharger",
    "supercarregador",
    "ultra rapid",
    "ultra-rapid",
    "hpc",
    "150kw",
    "120kw",
    "100kw",
    "80kw",
    "60kw",
    "50kw",
    "ccs2",
    "chademo",
    "dc fast",
    "carregador rápido",
    "carregamento rápido",
    "fast charge",
    "rapid",
  ];
  if (dcHighKeywords.some((k) => text.includes(k))) {
    return { type: "DC", estimatedPower: 60, confidence: "high" };
  }

  const dcMediumKeywords = [
    "shell recharge",
    "zletric",
    "ezvolt",
    "tupinambá",
    "tupinamba",
    "neocharge",
    "voltbras",
    "raízen",
    "raizen",
    "ipiranga",
    "vibra",
    "copel eletrovia",
    "cpfl",
    "edp",
    "enel x",
    "abb",
    "weg charge",
  ];
  if (dcMediumKeywords.some((k) => text.includes(k))) {
    return { type: "DC", estimatedPower: 60, confidence: "medium" };
  }

  const acHighKeywords = [
    "wallbox",
    "wall box",
    "7kw",
    "7.4kw",
    "22kw",
    "tipo 2",
    "type 2",
    "level 2",
    "nível 2",
    "lento",
    "slow",
    "ac charger",
  ];
  if (acHighKeywords.some((k) => text.includes(k))) {
    return { type: "AC", estimatedPower: 7, confidence: "high" };
  }

  const acMediumKeywords = [
    "bmw",
    "volvo",
    "audi",
    "porsche",
    "mercedes",
    "jaguar",
    "concessionária",
    "concessionaria",
    "shopping",
    "mall",
    "estacionamento",
    "condor",
    "pátio",
    "patio",
  ];
  if (acMediumKeywords.some((k) => text.includes(k))) {
    return { type: "AC", estimatedPower: 7, confidence: "medium" };
  }

  return { type: "unknown", estimatedPower: 0, confidence: "low" };
}

// ============================================================
// Helpers
// ============================================================

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeCity(city: string): string {
  if (!city) return "";
  return city
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

type FetchLike = (url: string) => Promise<Response>;

type NearbyResult = {
  name?: string;
  vicinity?: string;
  formatted_address?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
};

/**
 * Grava os carregadores de uma busca num único upsert. Antes era um por um, e o
 * erro do banco era ignorado: carregador não gravado sumia da contagem de
 * concorrentes sem ninguém saber. Agora a falha bloqueia o Score.
 */
async function saveChargers(
  supabase: SupabaseClient,
  chargers: Omit<ChargerRow, "id">[],
  fonte: string
): Promise<void> {
  // O upsert em lote reprova linha repetida na chave (lat, lng, name).
  const byKey = new Map<string, Omit<ChargerRow, "id">>();
  for (const c of chargers) {
    const row = { ...c, city: normalizeCity(c.city) };
    byKey.set(`${row.lat}|${row.lng}|${row.name}`, row);
  }
  if (byKey.size === 0) return;
  const { error } = await supabase
    .from("ev_chargers")
    .upsert([...byKey.values()], { onConflict: "lat,lng,name", ignoreDuplicates: false });
  if (error) {
    throw new ScoreDataError(
      "concorrentes",
      `gravação de ${byKey.size} carregadores (${fonte}) falhou (${error.message})`,
      500
    );
  }
}

/**
 * Nearby Search (legado). O Google devolve erro com HTTP 200 e o motivo em
 * `status`: chave negada ou cota estourada vinham como "0 resultados". Só OK e
 * ZERO_RESULTS são resposta; o resto bloqueia o Score.
 */
async function googleNearby(
  params: string,
  contexto: string,
  apiKey: string | undefined,
  fetchImpl: FetchLike
): Promise<NearbyResult[]> {
  if (!apiKey) {
    throw new ScoreDataError("concorrentes", `GOOGLE_MAPS_API_KEY ausente (${contexto})`);
  }
  let data: { status?: string; error_message?: string; results?: NearbyResult[] };
  try {
    const res = await fetchImpl(
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}&key=${apiKey}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    throw new ScoreDataError("concorrentes", `busca no Google (${contexto}) falhou (${(e as Error).message})`);
  }
  if (data.status === "ZERO_RESULTS") return [];
  if (data.status !== "OK") {
    const why = [data.status, data.error_message].filter(Boolean).join(" — ") || "sem status";
    throw new ScoreDataError("concorrentes", `busca no Google (${contexto}) recusada (${why})`);
  }
  return data.results ?? [];
}

/** Resultados da busca → linhas do ev_chargers, sem coordenada repetida. */
function toChargerRows(
  results: NearbyResult[],
  city: string,
  state: string,
  source: string,
  seen: Set<string>
): Omit<ChargerRow, "id">[] {
  const rows: Omit<ChargerRow, "id">[] = [];
  for (const place of results) {
    const plat = place.geometry?.location?.lat;
    const plng = place.geometry?.location?.lng;
    if (typeof plat !== "number" || typeof plng !== "number") continue;
    const key = `${plat.toFixed(5)},${plng.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const classification = classifyChargerType(place.name || "");
    rows.push({
      city,
      state,
      name: place.name || "",
      address: place.vicinity || place.formatted_address || "",
      lat: plat,
      lng: plng,
      power_kw: classification.estimatedPower,
      charger_type: classification.type,
      operator: "",
      source,
      verified: classification.confidence === "high",
    });
  }
  return rows;
}

// ============================================================
// FONTE 1: Google Places (popular o banco)
// ============================================================

export async function populateChargersFromGoogle(
  city: string,
  state: string,
  lat: number,
  lng: number,
  supabase: SupabaseClient,
  apiKey: string | undefined = process.env.GOOGLE_MAPS_API_KEY,
  fetchImpl: FetchLike = fetch
): Promise<number> {
  const queries = [
    "eletroposto",
    "carregador veículo elétrico",
    "ev charging station",
    "estação recarga",
    "ponto recarga",
  ];

  const seen = new Set<string>();
  const rows: Omit<ChargerRow, "id">[] = [];
  for (const query of queries) {
    const results = await googleNearby(
      `location=${lat},${lng}&radius=50000&keyword=${encodeURIComponent(query)}`,
      `"${query}" em ${city}`,
      apiKey,
      fetchImpl
    );
    rows.push(...toChargerRows(results, city, state, "google_places", seen));
  }
  await saveChargers(supabase, rows, "Google, cidade");
  return queries.length;
}

// Busca local (2km) ao redor de um ponto específico. Roda em toda análise
// porque o sweep amplo (50km do centro) às vezes não retorna carregadores
// discretos próximos ao ponto sendo analisado.
export async function populateChargersLocal(
  city: string,
  state: string,
  pointLat: number,
  pointLng: number,
  supabase: SupabaseClient,
  apiKey: string | undefined = process.env.GOOGLE_MAPS_API_KEY,
  fetchImpl: FetchLike = fetch
): Promise<number> {
  const results = await googleNearby(
    `location=${pointLat},${pointLng}&radius=2000&keyword=${encodeURIComponent("eletroposto carregador ev charging")}`,
    "2 km do ponto",
    apiKey,
    fetchImpl
  );
  await saveChargers(supabase, toChargerRows(results, city, state, "google_places_local", new Set()), "Google, 2 km");
  return 1;
}

// PlugShare e carregados.com.br saíram em 22/10/2026: o endpoint do PlugShare
// devolvia a página do site em vez de dados, e o extrator do carregados achava
// 0 coordenadas numa página que lista centenas. Nunca gravaram nada, e a falha
// era engolida.

// ============================================================
// Verificar se a cidade já tem dados frescos no banco
// ============================================================

export async function cityHasFreshChargers(
  city: string,
  supabase: SupabaseClient,
  maxAgeDays = 7
): Promise<boolean> {
  const cutoff = new Date(
    Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  ).toISOString();
  const { count, error } = await supabase
    .from("ev_chargers")
    .select("id", { count: "exact", head: true })
    .ilike("city", normalizeCity(city))
    .gte("updated_at", cutoff);
  if (error) {
    throw new ScoreDataError("concorrentes", `leitura de ev_chargers falhou (${error.message})`, 500);
  }
  return (count || 0) > 0;
}

// ============================================================
// Buscar carregadores próximos a um ponto (do banco)
// ============================================================

export async function getChargersNearPoint(
  lat: number,
  lng: number,
  city: string,
  supabase: SupabaseClient
): Promise<ChargersNearPoint> {
  // Falha na leitura vira erro, não "0 concorrentes": mercado falsamente vazio
  // é o pior erro que o Score pode entregar. O count exato pega o teto de linhas
  // do PostgREST (1.000 por resposta), que cortaria a cidade calado.
  const { data: cityChargers, error, count } = await supabase
    .from("ev_chargers")
    .select("*", { count: "exact" })
    .ilike("city", normalizeCity(city));
  if (error) {
    throw new ScoreDataError("concorrentes", `leitura de ev_chargers falhou (${error.message})`, 500);
  }
  const chargers = (cityChargers || []) as ChargerRow[];
  if (count !== null && count > chargers.length) {
    throw new ScoreDataError(
      "concorrentes",
      `a leitura de ${city} veio cortada: ${chargers.length} de ${count} carregadores`,
      500
    );
  }

  const withDistance = chargers.map((c) => ({
    ...c,
    distance: haversine(lat, lng, Number(c.lat), Number(c.lng)),
  }));

  const in200m = withDistance.filter((c) => c.distance <= 200);
  const in500m = withDistance.filter((c) => c.distance <= 500);
  const in1km = withDistance.filter((c) => c.distance <= 1000);
  const in2km = withDistance.filter((c) => c.distance <= 2000);
  const in5km = withDistance.filter((c) => c.distance <= 5000);

  return {
    in200m,
    in500m,
    in1km,
    in2km,
    in5km,
    dcIn200m: in200m.filter((c) => c.charger_type === "DC").length,
    dcIn500m: in500m.filter((c) => c.charger_type === "DC").length,
    dcIn1km: in1km.filter((c) => c.charger_type === "DC").length,
    dcIn2km: in2km.filter((c) => c.charger_type === "DC").length,
    dcInCity: chargers.filter((c) => c.charger_type === "DC").length,
    totalInCity: chargers.length,
  };
}
