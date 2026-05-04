import { createClient } from "@/lib/supabase/server";
import { getCachedOrFetch } from "@/lib/competitors";
import type { CompetitorStation } from "@/lib/competitors";
import { getABVEData, getCityEVData, ABVE_NATIONAL } from "@/lib/abve-real-data";
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
  | "university"
  | "hospital"
  | "convenience"
  | "gym";
type PlaceType = AnchorType | ComplementaryType;

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
  hospital: "Hospital",
  convenience: "Loja de conveniência",
  gym: "Academia",
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

type RawPlace = Omit<POI, "placeType">;

async function searchTextPlaces(
  query: string,
  lat: number,
  lng: number,
  apiKey: string,
  radius: number = 15000
): Promise<RawPlace[]> {
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
    query
  )}&location=${lat},${lng}&radius=${radius}&language=pt-BR&region=br&key=${apiKey}`;
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
          formatted_address?: string;
        }) => ({
          name: p.name || "",
          lat: p.geometry.location.lat,
          lng: p.geometry.location.lng,
          rating: p.rating || 0,
          reviews: p.user_ratings_total || 0,
          address: p.formatted_address || "",
        })
      );
  } catch (err) {
    console.error("searchTextPlaces erro:", query, err);
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

function isQualityPoint(poi: POI): boolean {
  const name = (poi.name || "").trim();

  if (!name || name.length < 4) return false;

  if (
    /^(r\.|rua|av\.|avenida|al\.|alameda|tv\.|travessa|rod\.|rodovia|estr\.|estrada|br-|pr-|sp-|mg-|rj-)\s/i.test(
      name
    )
  )
    return false;

  if (/^[\d\s.,\-/]+$/.test(name)) return false;

  const lower = name.toLowerCase();
  const reject = [
    "lote",
    "terreno",
    "sala",
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
  if (reject.some((r) => lower === r || lower.startsWith(r + " "))) return false;

  if (!/[a-zA-ZÀ-ÿ]/.test(name)) return false;

  return true;
}

function isQualityAnchor(poi: POI): boolean {
  if (!isQualityPoint(poi)) return false;
  const name = (poi.name || "").toLowerCase();

  if (poi.placeType === "airport") {
    const rejectAirport = [
      "heliponto",
      "heliporto",
      "helipad",
      "helicóptero",
      "helicoptero",
      "aeroclube",
      "aero clube",
      "pista particular",
      "táxi aéreo",
      "taxi aereo",
    ];
    if (rejectAirport.some((r) => name.includes(r))) return false;
    if (
      !name.includes("aeroporto") &&
      !name.includes("airport") &&
      !name.includes("internacional")
    )
      return false;
  }

  if (poi.placeType === "bus_station") {
    const rejectBus = [
      "terminal urbano",
      "terminal de ônibus",
      "terminal de onibus",
      "estação tubo",
      "estacao tubo",
      "ponto de ônibus",
      "ponto de onibus",
      "parada",
      "terminal metropolitano",
      "brt",
      "ligeirinho",
      "biarticulado",
      "tube",
      "estação de transferência",
    ];
    if (rejectBus.some((r) => name.includes(r))) return false;
    if (
      name.includes("terminal") &&
      !name.includes("rodoviári") &&
      !name.includes("rodoviario") &&
      !name.includes("rodoferroviári")
    )
      return false;
  }

  if (poi.placeType === "shopping_mall") {
    const rejectShop = [
      "galeria",
      "mini shopping",
      "camelódromo",
      "box",
      "centro comercial pequeno",
    ];
    if (rejectShop.some((r) => name.includes(r))) return false;
  }

  return true;
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
  const dcByPower = /\b(50|60|80|100|120|150|180|200|240|300|350)\s*kw\b/i.test(
    c.name || ""
  );
  if (dcByPower) return "DC";
  const dcKeywords = [
    "rápido",
    "rapido",
    "fast",
    "supercharger",
    "ultra",
    "ccs",
    "chademo",
    " dc ",
    "(dc)",
    " dc-",
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
  // Match " dc " com espaços simulados
  const padded = ` ${nameLower} `;
  if (dcKeywords.some((k) => padded.includes(k))) return "DC";
  if (acKeywords.some((k) => nameLower.includes(k))) return "AC";
  return "unknown";
}

// ---------- POST ----------

export async function POST(req: Request) {
  let body: { city?: string; state?: string; forceRefresh?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const city = (body.city || "").trim();
  const state = (body.state || "").trim().toUpperCase();
  const forceRefresh = Boolean(body.forceRefresh);
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

  // 0. Cache (7 dias) — ignorado quando forceRefresh
  if (!forceRefresh) {
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
  } else {
    console.log(`heatmap-v2 FORCE REFRESH: ${city}/${state}`);
  }

  // 1. Geocoding
  const center = await geocodeCity(city, state, apiKey);
  if (!center) {
    return Response.json(
      { error: `Não foi possível geocodificar ${city}, ${state}` },
      { status: 400 }
    );
  }

  // 2. Busca POIs via Text Search (22 queries paralelas)
  let googleQueries = 0;
  const cityQuery = `${city} ${state}`;

  const anchorQueries: { q: string; type: AnchorType }[] = [
    { q: `posto de combustível ${cityQuery}`, type: "gas_station" },
    { q: `posto de gasolina ${cityQuery}`, type: "gas_station" },
    { q: `posto 24 horas ${cityQuery}`, type: "gas_station" },
    { q: `rede de postos ${cityQuery}`, type: "gas_station" },
    { q: `shopping center ${cityQuery}`, type: "shopping_mall" },
    { q: `shopping mall ${cityQuery}`, type: "shopping_mall" },
    { q: `rodoviária interestadual ${cityQuery}`, type: "bus_station" },
    { q: `aeroporto ${cityQuery}`, type: "airport" },
  ];

  const compQueries: { q: string; type: ComplementaryType }[] = [
    { q: `farmácia ${cityQuery}`, type: "pharmacy" },
    { q: `drogaria ${cityQuery}`, type: "pharmacy" },
    { q: `padaria ${cityQuery}`, type: "bakery" },
    { q: `supermercado ${cityQuery}`, type: "supermarket" },
    { q: `hipermercado ${cityQuery}`, type: "supermarket" },
    { q: `estacionamento ${cityQuery}`, type: "parking" },
    { q: `restaurante ${cityQuery}`, type: "restaurant" },
    { q: `lanchonete ${cityQuery}`, type: "restaurant" },
    { q: `hotel ${cityQuery}`, type: "lodging" },
    { q: `pousada ${cityQuery}`, type: "lodging" },
    { q: `universidade ${cityQuery}`, type: "university" },
    { q: `hospital ${cityQuery}`, type: "hospital" },
    { q: `loja de conveniência ${cityQuery}`, type: "convenience" },
    { q: `academia ${cityQuery}`, type: "gym" },
  ];

  const [anchorRaws, compRaws] = await Promise.all([
    Promise.all(
      anchorQueries.map((aq) =>
        searchTextPlaces(aq.q, center.lat, center.lng, apiKey)
      )
    ),
    Promise.all(
      compQueries.map((cq) =>
        searchTextPlaces(cq.q, center.lat, center.lng, apiKey)
      )
    ),
  ]);
  googleQueries += anchorQueries.length + compQueries.length; // 22

  let allAnchors: POI[] = anchorQueries.flatMap((aq, i) =>
    anchorRaws[i].map((p) => ({ ...p, placeType: aq.type }))
  );
  let allComplementary: POI[] = compQueries.flatMap((cq, i) =>
    compRaws[i].map((p) => ({ ...p, placeType: cq.type }))
  );

  // 3. Deduplicação geral + filtros de qualidade
  allAnchors = deduplicatePOIs(allAnchors).filter(isQualityAnchor);
  allComplementary = deduplicatePOIs(allComplementary).filter(isQualityPoint);

  const dedupedAnchors = allAnchors;
  const dedupedComplementary = allComplementary;

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

  // 6. ABVE (quantidade oficial) + Google (localização)
  const abveData = getABVEData(city, state);
  const abveDC = abveData?.dc ?? 0;
  const abveAC = abveData?.ac ?? 0;
  const abveTotal = abveData?.total ?? 0;

  const googleDC = competitors.filter((c) => c.charger_type === "DC").length;
  const googleAC = competitors.filter((c) => c.charger_type === "AC").length;
  const googleTotal = competitors.length;

  const dcCity = abveDC > 0 ? abveDC : googleDC;
  const totalChargers = abveTotal > 0 ? abveTotal : googleTotal;

  const population = ibge.population ?? 0;
  const gdpPerCapita = ibge.gdpPerCapita ?? 0;

  const evData = getCityEVData(city, state, population, gdpPerCapita);

  console.log("=== EV DATA ===", city, state);
  console.log("Total EVs:", evData.totalEVs, "| BEV:", evData.bev, "| PHEV:", evData.phev);
  console.log("BEV+PHEV (carregam):", evData.bevPlusPHEV, "| DC:", evData.dcChargers, "| Ratio:", evData.ratioEVperDC);
  console.log("Fonte:", evData.source);
  console.log("ABVE Nacional:", ABVE_NATIONAL.totalBEVPHEV, "veículos plug-in (BEV+PHEV)");

  console.log("=== CARREGADORES ===");
  console.log("ABVE:", abveDC, "DC,", abveAC, "AC,", abveTotal, "total");
  console.log(
    "Google/Banco:",
    googleDC,
    "DC classificados,",
    googleTotal,
    "total localizados"
  );
  if (!abveData) {
    console.log("Cidade não encontrada na ABVE - usando apenas Google Places");
  }

  // 7. Selecionar marcadores complementares
  // Top 5 mais próximos (< 500m) de cada âncora, sem repetição.
  const keyOf = (p: POI) => `${p.lat.toFixed(6)}|${p.lng.toFixed(6)}|${p.name}`;
  const selectedKeys = new Set<string>();
  const selectedComp: { cp: POI; nearAnchor: string; nearAnchorDist: number }[] = [];

  for (const a of dedupedAnchors) {
    const candidates = dedupedComplementary
      .filter((cp) => !selectedKeys.has(keyOf(cp)))
      .map((cp) => ({
        cp,
        dist: haversineMeters(a.lat, a.lng, cp.lat, cp.lng),
      }))
      .filter((x) => x.dist < 500)
      .sort((x1, x2) => x1.dist - x2.dist)
      .slice(0, 5);

    for (const x of candidates) {
      selectedKeys.add(keyOf(x.cp));
      selectedComp.push({
        cp: x.cp,
        nearAnchor: a.name,
        nearAnchorDist: Math.round(x.dist),
      });
    }
  }

  const MIN_MARKERS = 50;
  if (dedupedAnchors.length + selectedComp.length < MIN_MARKERS) {
    const remaining = MIN_MARKERS - dedupedAnchors.length - selectedComp.length;
    const extras = dedupedComplementary
      .filter((cp) => !selectedKeys.has(keyOf(cp)))
      .slice(0, remaining);

    for (const cp of extras) {
      selectedKeys.add(keyOf(cp));
      let nearest: { name: string; dist: number } | null = null;
      for (const a of dedupedAnchors) {
        const d = haversineMeters(a.lat, a.lng, cp.lat, cp.lng);
        if (nearest === null || d < nearest.dist) {
          nearest = { name: a.name, dist: d };
        }
      }
      selectedComp.push({
        cp,
        nearAnchor: nearest ? nearest.name : "",
        nearAnchorDist: nearest ? Math.round(nearest.dist) : 0,
      });
    }
  }

  const complementaryOut = selectedComp.map(({ cp, nearAnchor, nearAnchorDist }) => ({
    name: cp.name,
    lat: cp.lat,
    lng: cp.lng,
    type: cp.placeType,
    typeLabel: COMPLEMENTARY_LABELS[cp.placeType as ComplementaryType],
    address: cp.address,
    nearAnchor,
    nearAnchorDist,
  }));

  // 8. Anchors: contar complementares próximos (< 300m) pra escalar raio do círculo
  const anchorsOut = dedupedAnchors.map((a) => {
    const nearbyCompCount = dedupedComplementary.reduce((count, cp) => {
      const d = haversineMeters(a.lat, a.lng, cp.lat, cp.lng);
      return count + (d < 300 ? 1 : 0);
    }, 0);
    return {
      name: a.name,
      lat: a.lat,
      lng: a.lng,
      type: a.placeType,
      typeLabel: ANCHOR_LABELS[a.placeType as AnchorType],
      address: a.address,
      nearbyCompCount,
    };
  });

  const payload = {
    city,
    state,
    center,
    anchors: anchorsOut,
    complementary: complementaryOut,
    competitors,
    cityData: {
      population: ibge.population,
      gdpPerCapita: ibge.gdpPerCapita,
      evs: evData.totalEVs,
      totalEVs: evData.totalEVs,
      bev: evData.bev,
      phev: evData.phev,
      bevPlusPHEV: evData.bevPlusPHEV,
      dcChargers: dcCity,
      acChargers: abveAC,
      totalChargers,
      ratioEVperDC: evData.ratioEVperDC,
      evsSource: evData.source,
      source: evData.source,
      abveDC,
      abveAC,
      abveTotal,
      googleDC,
      googleAC,
      googleTotal,
      hasAbve: !!abveData,
    },
    stats: {
      totalAnchors: dedupedAnchors.length,
      totalComplementary: complementaryOut.length,
      totalCompetitors: competitors.length,
      googleQueries,
    },
  };

  // 9. Salva cache (apaga entradas anteriores da mesma cidade/estado primeiro)
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from("city_analyses")
        .delete()
        .eq("city", city)
        .eq("state", state)
        .eq("status", "heatmap_v2");

      await supabase.from("city_analyses").insert({
        user_id: user.id,
        city,
        state,
        population: ibge.population,
        gdp_per_capita: ibge.gdpPerCapita,
        charger_count: totalChargers,
        dc_charger_count: dcCity,
        ev_count: evData.totalEVs,
        points_json: payload,
        status: "heatmap_v2",
      });
    }
  } catch (err) {
    console.error("heatmap-v2 cache save erro:", err);
  }

  // 10. Log usage
  await logUsage({
    module: "heatmap",
    city: `${city}/${state}`,
    googlePlacesQueries: googleQueries,
  });

  return Response.json(payload);
}
