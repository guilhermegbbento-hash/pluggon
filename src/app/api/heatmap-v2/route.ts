import { createClient } from "@/lib/supabase/server";
import { getCachedOrFetch } from "@/lib/competitors";
import type { CompetitorStation } from "@/lib/competitors";
import { getABVEData } from "@/lib/abve-real-data";
import { logUsage } from "@/lib/usage-logger";

export const maxDuration = 300;

// ---------- Types ----------

type AnchorType = "gas_station" | "bus_station" | "airport" | "shopping_mall";
type ComplementaryType =
  | "pharmacy"
  | "bakery"
  | "parking"
  | "supermarket"
  | "restaurant"
  | "lodging"
  | "university";
type PlaceType = AnchorType | ComplementaryType;

const ANCHOR_TYPES: AnchorType[] = [
  "gas_station",
  "bus_station",
  "airport",
  "shopping_mall",
];
const COMPLEMENTARY_TYPES: ComplementaryType[] = [
  "pharmacy",
  "bakery",
  "parking",
  "supermarket",
  "restaurant",
  "lodging",
  "university",
];

const ANCHOR_LABELS: Record<AnchorType, string> = {
  gas_station: "Posto de combustível",
  bus_station: "Rodoviária",
  airport: "Aeroporto",
  shopping_mall: "Shopping",
};

const COMPLEMENTARY_LABELS: Record<ComplementaryType, string> = {
  pharmacy: "Farmácia",
  bakery: "Padaria",
  parking: "Estacionamento",
  supermarket: "Supermercado",
  restaurant: "Restaurante",
  lodging: "Hotel",
  university: "Universidade",
};

interface POI {
  name: string;
  lat: number;
  lng: number;
  rating: number;
  reviews: number;
  address: string;
  placeType: PlaceType;
}

interface CompetitorOut {
  name: string;
  lat: number;
  lng: number;
  charger_type: "DC" | "AC" | "unknown";
  address: string;
}

interface Cell {
  row: number;
  col: number;
  centerLat: number;
  centerLng: number;
  score: number;
  anchors: POI[];
  complementary: POI[];
  competitors: CompetitorOut[];
}

// ---------- Helpers ----------

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function searchNearbyOld(
  lat: number,
  lng: number,
  type: PlaceType,
  radius: number,
  apiKey: string
): Promise<POI[]> {
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=${type}&key=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const results = Array.isArray(data.results) ? data.results : [];
    return results
      .filter((p: { geometry?: { location?: { lat: number; lng: number } } }) =>
        Boolean(p.geometry?.location)
      )
      .map(
        (p: {
          name?: string;
          geometry: { location: { lat: number; lng: number } };
          rating?: number;
          user_ratings_total?: number;
          vicinity?: string;
        }) => ({
          name: p.name || "Sem nome",
          lat: p.geometry.location.lat,
          lng: p.geometry.location.lng,
          rating: p.rating || 0,
          reviews: p.user_ratings_total || 0,
          address: p.vicinity || "",
          placeType: type,
        })
      );
  } catch (err) {
    console.error("searchNearbyOld erro:", type, err);
    return [];
  }
}

function deduplicatePOIs(pois: POI[]): POI[] {
  const unique: POI[] = [];
  for (const poi of pois) {
    const isDuplicate = unique.some(
      (u) => haversineMeters(poi.lat, poi.lng, u.lat, u.lng) < 50
    );
    if (!isDuplicate) unique.push(poi);
  }
  return unique;
}

// Remove points that are just addresses, not real commercial establishments
function isValidCommercialPoint(poi: POI): boolean {
  const name = (poi.name || "").trim();

  if (!name || name.length < 4) return false;

  if (
    /^(r\.|rua|av\.|avenida|al\.|alameda|tv\.|travessa|rod\.|rodovia|estr\.|estrada|br-|pr-|sp-|mg-|rj-)\s/i.test(
      name
    )
  )
    return false;

  if (/^(n\.?|nº|numero|número)\s*\d/i.test(name)) return false;

  if (/^[\d\s.,\-/]+$/.test(name)) return false;

  const lower = name.toLowerCase();
  const generic = [
    "lote",
    "terreno",
    "sala",
    "espaço",
    "galpão",
    "barracão",
    "casa",
    "residência",
    "apartamento",
    "prédio",
    "edifício",
    "condomínio",
    "sobrado",
    "kitnet",
  ];
  if (generic.some((g) => lower === g)) return false;

  if (/^\d/.test(name) && name.length < 10) return false;

  if (!/[a-zA-ZÀ-ÿ]/.test(name)) return false;

  return true;
}

// Aceita só rodoviárias intermunicipais/interestaduais, rejeita terminais urbanos
function isRealBusStation(poi: POI): boolean {
  const name = (poi.name || "").toLowerCase();
  const accept = [
    "rodoviária",
    "rodoviaria",
    "terminal rodoviário",
    "terminal rodoviario",
    "rodoferroviária",
    "rodoferroviaria",
  ];
  if (accept.some((a) => name.includes(a))) return true;

  const reject = [
    "terminal urbano",
    "terminal de ônibus",
    "terminal de onibus",
    "estação tubo",
    "estacao tubo",
    "ponto de ônibus",
    "ponto de onibus",
    "parada",
    "terminal metropolitano",
    "terminal de integração",
    "terminal de integracao",
    "tube",
    "brt",
    "ligeirinho",
    "biarticulado",
  ];
  if (reject.some((r) => name.includes(r))) return false;

  if (name.includes("terminal") && !name.includes("rodoviári")) return false;

  return false;
}

// Aceita só aeroportos comerciais, rejeita helipontos/aeroclubes
function isRealAirport(poi: POI): boolean {
  const name = (poi.name || "").toLowerCase();
  const reject = [
    "heliponto",
    "heliporto",
    "helipad",
    "helicóptero",
    "helicoptero",
    "aeroclube",
    "aero clube",
    "pista particular",
    "campo de aviação",
  ];
  if (reject.some((r) => name.includes(r))) return false;

  const accept = [
    "aeroporto",
    "airport",
    "internacional",
    "regional",
    "santos dumont",
    "congonhas",
    "galeão",
    "guarulhos",
    "afonso pena",
    "salgado filho",
  ];
  if (accept.some((a) => name.includes(a))) return true;

  return false;
}

// Aceita só shoppings de médio/grande porte, rejeita galerias pequenas
function isRealShopping(poi: POI): boolean {
  const name = (poi.name || "").toLowerCase();
  const reject = [
    "galeria",
    "mini shopping",
    "mini mall",
    "camelódromo",
    "box",
    "loja de",
  ];
  if (reject.some((r) => name.includes(r))) return false;

  const accept = [
    "shopping",
    "mall",
    "shopping center",
    "centro comercial",
    "outlet",
    "plaza",
    "park shopping",
    "pátio",
    "patio",
  ];
  if (accept.some((a) => name.includes(a))) return true;

  if ((poi.reviews || 0) > 500) return true;

  return false;
}

async function geocodeCity(
  city: string,
  state: string,
  apiKey: string
): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      `${city}, ${state}, Brasil`
    )}&key=${apiKey}&language=pt-BR&region=br`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === "OK" && data.results?.length) {
      return {
        lat: data.results[0].geometry.location.lat,
        lng: data.results[0].geometry.location.lng,
      };
    }
  } catch (err) {
    console.error("geocodeCity erro:", err);
  }
  return null;
}

interface IBGECityData {
  population: number | null;
  gdpPerCapita: number | null;
}

async function fetchIBGECityData(
  city: string,
  state: string
): Promise<IBGECityData> {
  const result: IBGECityData = { population: null, gdpPerCapita: null };
  try {
    const searchUrl = `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state}/municipios`;
    const res = await fetch(searchUrl);
    if (!res.ok) return result;
    const municipalities = await res.json();
    const found = municipalities.find(
      (m: { nome: string }) => m.nome.toLowerCase() === city.toLowerCase()
    );
    if (!found) return result;

    try {
      const popUrl = `https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos/-1/variaveis/9324?localidades=N6[${found.id}]`;
      const popRes = await fetch(popUrl);
      if (popRes.ok) {
        const popData = await popRes.json();
        const series = popData?.[0]?.resultados?.[0]?.series?.[0]?.serie;
        if (series) {
          const latestKey = Object.keys(series).sort().pop();
          if (latestKey) result.population = parseInt(series[latestKey], 10);
        }
      }
    } catch {}

    try {
      const pibUrl = `https://servicodados.ibge.gov.br/api/v3/agregados/5938/periodos/-1/variaveis/37?localidades=N6[${found.id}]`;
      const pibRes = await fetch(pibUrl);
      if (pibRes.ok) {
        const pibData = await pibRes.json();
        const series = pibData?.[0]?.resultados?.[0]?.series?.[0]?.serie;
        if (series) {
          const latestKey = Object.keys(series).sort().pop();
          if (latestKey) {
            const pibEmMil = parseFloat(series[latestKey]);
            const gdpTotal = pibEmMil * 1000;
            if (result.population && result.population > 0) {
              result.gdpPerCapita = Math.round(gdpTotal / result.population);
            }
          }
        }
      }
    } catch {}
  } catch {}
  return result;
}

function classifyChargerType(c: CompetitorStation): "DC" | "AC" | "unknown" {
  if (c.isFastCharge) return "DC";
  if (c.powerKW > 0 && c.powerKW < 40) return "AC";
  // classify by name as fallback
  const nameLower = (c.name || "").toLowerCase();
  const dcKeywords = [
    "shell recharge",
    "zletric",
    "ezvolt",
    "tupinamba",
    "tupinambá",
    "voltbras",
    "neocharge",
    "copel eletrovia",
    "edp",
    "raizen",
    "raízen",
    "ipiranga recarga",
  ];
  const acKeywords = [
    "byd",
    "bmw",
    "volvo",
    "audi",
    "porsche",
    "mercedes",
    "shopping",
    "patio",
    "pátio",
    "mall",
  ];
  if (dcKeywords.some((k) => nameLower.includes(k))) return "DC";
  if (acKeywords.some((k) => nameLower.includes(k))) return "AC";
  return "unknown";
}

function regionLabel(
  cellLat: number,
  cellLng: number,
  centerLat: number,
  centerLng: number
): string {
  const dLat = cellLat - centerLat;
  const dLng = cellLng - centerLng;
  const ns = dLat > 0.005 ? "Norte" : dLat < -0.005 ? "Sul" : "Centro";
  const ew = dLng > 0.005 ? "Leste" : dLng < -0.005 ? "Oeste" : "";
  if (ns === "Centro" && !ew) return "Centro";
  if (!ew) return ns;
  if (ns === "Centro") return ew;
  return `${ns}-${ew}`;
}

// ---------- POST ----------

export async function POST(req: Request) {
  let body: { city?: string; state?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const city = (body.city || "").trim();
  const state = (body.state || "").trim().toUpperCase();
  if (!city || !state) {
    return Response.json({ error: "city e state são obrigatórios" }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "GOOGLE_MAPS_API_KEY ausente" },
      { status: 500 }
    );
  }

  const supabase = await createClient();

  // 0. Cache (7 dias)
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: cached } = await supabase
      .from("city_analyses")
      .select("points_json, created_at")
      .eq("city", city)
      .eq("state", state)
      .eq("status", "heatmap_v2")
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cached && cached.points_json) {
      console.log(`heatmap-v2 CACHE HIT: ${city}/${state}`);
      const payload =
        typeof cached.points_json === "string"
          ? JSON.parse(cached.points_json)
          : cached.points_json;
      return Response.json({ ...payload, fromCache: true });
    }
  } catch (err) {
    console.error("heatmap-v2 cache lookup erro:", err);
  }

  // 1. Geocoding
  const center = await geocodeCity(city, state, apiKey);
  if (!center) {
    return Response.json(
      { error: `Não foi possível geocodificar ${city}, ${state}` },
      { status: 400 }
    );
  }

  // 2. Busca POIs (11 queries)
  const radius = 15000;
  let googleQueries = 0;
  const allAnchors: POI[] = [];
  const allComplementary: POI[] = [];

  const anchorResults = await Promise.all(
    ANCHOR_TYPES.map((t) =>
      searchNearbyOld(center.lat, center.lng, t, radius, apiKey)
    )
  );
  googleQueries += ANCHOR_TYPES.length;
  anchorResults.forEach((arr) => allAnchors.push(...arr));

  const compResults = await Promise.all(
    COMPLEMENTARY_TYPES.map((t) =>
      searchNearbyOld(center.lat, center.lng, t, radius, apiKey)
    )
  );
  googleQueries += COMPLEMENTARY_TYPES.length;
  compResults.forEach((arr) => allComplementary.push(...arr));

  // 3. Deduplicação POR TIPO + filtro de pontos comerciais válidos
  const dedupedAnchorsByType: Record<AnchorType, POI[]> = {
    gas_station: [],
    bus_station: [],
    airport: [],
    shopping_mall: [],
  };
  for (const t of ANCHOR_TYPES) {
    let arr = deduplicatePOIs(allAnchors.filter((p) => p.placeType === t))
      .filter(isValidCommercialPoint);
    if (t === "bus_station") arr = arr.filter(isRealBusStation);
    else if (t === "airport") arr = arr.filter(isRealAirport);
    else if (t === "shopping_mall") arr = arr.filter(isRealShopping);
    dedupedAnchorsByType[t] = arr;
  }
  let dedupedAnchors = ANCHOR_TYPES.flatMap((t) => dedupedAnchorsByType[t]);

  // 3b. Se sobraram poucas âncoras válidas, ampliar raio de busca pra 20km
  if (dedupedAnchors.length < 5) {
    const expandedRadius = 20000;
    const expandedAnchorResults = await Promise.all(
      ANCHOR_TYPES.map((t) =>
        searchNearbyOld(center.lat, center.lng, t, expandedRadius, apiKey)
      )
    );
    googleQueries += ANCHOR_TYPES.length;
    ANCHOR_TYPES.forEach((t, i) => {
      let arr = deduplicatePOIs(expandedAnchorResults[i]).filter(
        isValidCommercialPoint
      );
      if (t === "bus_station") arr = arr.filter(isRealBusStation);
      else if (t === "airport") arr = arr.filter(isRealAirport);
      else if (t === "shopping_mall") arr = arr.filter(isRealShopping);
      dedupedAnchorsByType[t] = arr;
    });
    dedupedAnchors = ANCHOR_TYPES.flatMap((t) => dedupedAnchorsByType[t]);
  }

  const dedupedCompByType: Record<ComplementaryType, POI[]> = {
    pharmacy: [],
    bakery: [],
    parking: [],
    supermarket: [],
    restaurant: [],
    lodging: [],
    university: [],
  };
  for (const t of COMPLEMENTARY_TYPES) {
    dedupedCompByType[t] = deduplicatePOIs(
      allComplementary.filter((p) => p.placeType === t)
    ).filter(isValidCommercialPoint);
  }
  const dedupedComplementary = COMPLEMENTARY_TYPES.flatMap(
    (t) => dedupedCompByType[t]
  );

  if (dedupedAnchors.length === 0 && dedupedComplementary.length === 0) {
    return Response.json(
      {
        error: `Nenhum POI encontrado em ${city}, ${state}. Verifique o nome da cidade.`,
      },
      { status: 404 }
    );
  }

  // 4. Concorrentes
  let competitors: CompetitorOut[] = [];
  let competitorQueries = 0;
  try {
    const compResult = await getCachedOrFetch(
      city,
      state,
      center.lat,
      center.lng,
      supabase
    );
    competitors = compResult.competitors.map((c) => ({
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      charger_type: classifyChargerType(c),
      address: c.address,
    }));
    // queryStats sums (excluding cache hits) approximated
    if (
      compResult.queryStats &&
      compResult.queryStats.cache === undefined
    ) {
      competitorQueries = Object.values(compResult.queryStats).reduce(
        (a, b) => a + b,
        0
      );
    }
  } catch (err) {
    console.error("competitors fetch erro:", err);
  }
  googleQueries += competitorQueries;

  // 5. IBGE
  const ibge = await fetchIBGECityData(city, state);

  // 6. ABVE
  const abve = getABVEData(city, state);
  const totalChargers = abve?.total ?? 0;
  const dcChargers = abve?.dc ?? 0;
  const evs = abve?.evsSold ?? 0;
  const ratioEVperDC = dcChargers > 0 ? Math.round(evs / dcChargers) : 0;

  // 7. Grid 300x300m
  const allPOIs = [...dedupedAnchors, ...dedupedComplementary];
  const allPoints = [
    ...allPOIs.map((p) => ({ lat: p.lat, lng: p.lng })),
    ...competitors.map((c) => ({ lat: c.lat, lng: c.lng })),
  ];
  const minLat = Math.min(...allPoints.map((p) => p.lat)) - 0.005;
  const maxLat = Math.max(...allPoints.map((p) => p.lat)) + 0.005;
  const minLng = Math.min(...allPoints.map((p) => p.lng)) - 0.005;
  const maxLng = Math.max(...allPoints.map((p) => p.lng)) + 0.005;

  const latStep = 0.0027;
  const lngStep = 0.0027 / Math.cos((center.lat * Math.PI) / 180);

  const rows = Math.max(1, Math.ceil((maxLat - minLat) / latStep));
  const cols = Math.max(1, Math.ceil((maxLng - minLng) / lngStep));

  const grid: Cell[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < cols; c++) {
      row.push({
        row: r,
        col: c,
        centerLat: minLat + (r + 0.5) * latStep,
        centerLng: minLng + (c + 0.5) * lngStep,
        score: 0,
        anchors: [],
        complementary: [],
        competitors: [],
      });
    }
    grid.push(row);
  }

  // 8. Popular células
  const placeCell = (lat: number, lng: number): { r: number; c: number } | null => {
    const r = Math.floor((lat - minLat) / latStep);
    const c = Math.floor((lng - minLng) / lngStep);
    if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
    return { r, c };
  };

  for (const a of dedupedAnchors) {
    const idx = placeCell(a.lat, a.lng);
    if (idx) grid[idx.r][idx.c].anchors.push(a);
  }
  for (const cp of dedupedComplementary) {
    const idx = placeCell(cp.lat, cp.lng);
    if (idx) grid[idx.r][idx.c].complementary.push(cp);
  }
  for (const cm of competitors) {
    const idx = placeCell(cm.lat, cm.lng);
    if (idx) grid[idx.r][idx.c].competitors.push(cm);
  }

  // 9. Score por célula
  const ANCHOR_WEIGHTS: Record<AnchorType, number> = {
    gas_station: 10,
    bus_station: 10,
    airport: 10,
    shopping_mall: 8,
  };
  const COMP_WEIGHTS: Record<ComplementaryType, number> = {
    pharmacy: 3,
    bakery: 3,
    parking: 3,
    supermarket: 4,
    restaurant: 2,
    lodging: 2,
    university: 2,
  };

  const NEIGHBORS: [number, number][] = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1],
  ];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      let score = 0;

      for (const t of ANCHOR_TYPES) {
        score += cell.anchors.filter((a) => a.placeType === t).length * ANCHOR_WEIGHTS[t];
      }
      for (const t of COMPLEMENTARY_TYPES) {
        score += cell.complementary.filter((a) => a.placeType === t).length * COMP_WEIGHTS[t];
      }

      const totalAnchors = cell.anchors.length;
      const totalComp = cell.complementary.length;
      const totalPOIs = totalAnchors + totalComp;

      if (totalAnchors >= 1 && totalComp >= 3) score *= 1.2;
      if (totalAnchors >= 2) score *= 1.3;

      let hasNeighborAnchor = false;
      for (const [dr, dc] of NEIGHBORS) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          if (grid[nr][nc].anchors.length > 0) {
            hasNeighborAnchor = true;
            break;
          }
        }
      }
      if (hasNeighborAnchor) score *= 1.1;

      if (totalAnchors === 0 && totalComp >= 5) score = Math.max(score, 15);
      if (totalAnchors === 0 && totalComp >= 8) score = Math.max(score, 25);
      if (totalAnchors === 0 && totalComp >= 12) score = Math.max(score, 35);

      const dcInCell = cell.competitors.filter((cp) => cp.charger_type === "DC").length;
      if (dcInCell > 4) score *= 0.5;

      if (totalPOIs < 2) score = 0;

      cell.score = Math.round(score);
    }
  }

  // 10. Selecionar marcadores

  // Anchors: todos deduplicados (já temos `dedupedAnchors`). Score região = score da célula que cai.
  const anchorsOut = dedupedAnchors.map((a) => {
    const idx = placeCell(a.lat, a.lng);
    const cellScore = idx ? grid[idx.r][idx.c].score : 0;
    return {
      name: a.name,
      lat: a.lat,
      lng: a.lng,
      type: a.placeType,
      typeLabel: ANCHOR_LABELS[a.placeType as AnchorType],
      address: a.address,
      cellScore,
    };
  });

  // Complementares: para cada âncora, top 3 mais próximos (< 500m), max 30 total, sem repetição.
  const selectedComp: POI[] = [];
  const selectedKeys = new Set<string>();
  const keyOf = (p: POI) => `${p.lat.toFixed(6)}|${p.lng.toFixed(6)}|${p.name}`;
  for (const a of dedupedAnchors) {
    if (selectedComp.length >= 30) break;
    const candidates = dedupedComplementary
      .filter((cp) => !selectedKeys.has(keyOf(cp)))
      .map((cp) => ({
        cp,
        dist: haversineMeters(a.lat, a.lng, cp.lat, cp.lng),
      }))
      .filter((x) => x.dist < 500)
      .sort((a2, b2) => a2.dist - b2.dist)
      .slice(0, 3);

    for (const x of candidates) {
      if (selectedComp.length >= 30) break;
      selectedComp.push(x.cp);
      selectedKeys.add(keyOf(x.cp));
    }
  }

  const complementaryOut = selectedComp.map((cp) => {
    // Encontra âncora mais próxima para popup
    let nearest: { name: string; dist: number } | null = null;
    for (const a of dedupedAnchors) {
      const d = haversineMeters(a.lat, a.lng, cp.lat, cp.lng);
      if (nearest === null || d < nearest.dist) {
        nearest = { name: a.name, dist: d };
      }
    }
    return {
      name: cp.name,
      lat: cp.lat,
      lng: cp.lng,
      type: cp.placeType,
      typeLabel: COMPLEMENTARY_LABELS[cp.placeType as ComplementaryType],
      address: cp.address,
      nearAnchor: nearest ? nearest.name : "",
      nearAnchorDist: nearest ? Math.round(nearest.dist) : 0,
    };
  });

  // 11. Top 10 regiões
  const flatCells: Cell[] = grid.flat();
  const topRegions = flatCells
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((c) => {
      const anchorsByType: Record<string, number> = {};
      for (const a of c.anchors) {
        const lbl = ANCHOR_LABELS[a.placeType as AnchorType];
        anchorsByType[lbl] = (anchorsByType[lbl] || 0) + 1;
      }
      const compByType: Record<string, number> = {};
      for (const cp of c.complementary) {
        const lbl = COMPLEMENTARY_LABELS[cp.placeType as ComplementaryType];
        compByType[lbl] = (compByType[lbl] || 0) + 1;
      }
      return {
        lat: c.centerLat,
        lng: c.centerLng,
        score: c.score,
        region: regionLabel(c.centerLat, c.centerLng, center.lat, center.lng),
        anchors: c.anchors.map((a) => a.name),
        anchorsByType,
        complementary: c.complementary.map((cp) => cp.name),
        complementaryByType: compByType,
        competitorsDC: c.competitors.filter((cp) => cp.charger_type === "DC").length,
        competitorsAC: c.competitors.filter((cp) => cp.charger_type === "AC").length,
      };
    });

  // 12. Grid output
  const gridOut = flatCells
    .filter((c) => c.score > 0)
    .map((c) => ({ lat: c.centerLat, lng: c.centerLng, score: c.score }));

  const maxScore = gridOut.reduce((m, c) => Math.max(m, c.score), 0);

  const payload = {
    city,
    state,
    center,
    grid: gridOut,
    anchors: anchorsOut,
    complementary: complementaryOut,
    competitors,
    cityData: {
      population: ibge.population,
      gdpPerCapita: ibge.gdpPerCapita,
      evs,
      dcChargers,
      totalChargers,
      ratioEVperDC,
    },
    stats: {
      totalAnchors: dedupedAnchors.length,
      totalComplementary: dedupedComplementary.length,
      totalCompetitors: competitors.length,
      totalCells: flatCells.filter((c) => c.score > 0).length,
      maxScore,
      googleQueries,
    },
    topRegions,
  };

  // 13. Salva cache
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("city_analyses").insert({
        user_id: user.id,
        city,
        state,
        population: ibge.population,
        gdp_per_capita: ibge.gdpPerCapita,
        charger_count: totalChargers,
        dc_charger_count: dcChargers,
        ev_count: evs,
        points_json: payload,
        status: "heatmap_v2",
      });
    }
  } catch (err) {
    console.error("heatmap-v2 cache save erro:", err);
  }

  // 14. Log usage
  await logUsage({
    module: "heatmap",
    city: `${city}/${state}`,
    googlePlacesQueries: googleQueries,
  });

  return Response.json(payload);
}
