import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { calculateScore } from "@/lib/scoring-engine";
import type { ScoreInput } from "@/lib/scoring-engine";
import { logUsage } from "@/lib/usage-logger";
import { getABVEData } from "@/lib/abve-real-data";
import {
  populateChargersFromGoogle,
  populateChargersLocal,
  enrichWithOpenChargeMap,
  enrichWithCarregados,
  enrichWithPlugShare,
  cityHasFreshChargers,
  getChargersNearPoint,
} from "@/lib/charger-database";

export const maxDuration = 300;

const anthropic = new Anthropic();
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const ADMIN_EMAIL = "guilhermegbbento@gmail.com";

// Pricing
const CLAUDE_INPUT_COST_PER_TOKEN = 0.003 / 1000;
const CLAUDE_OUTPUT_COST_PER_TOKEN = 0.015 / 1000;
const GOOGLE_PLACES_COST_PER_QUERY = 0.032;

// ---------- Utilities ----------

function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
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

// ---------- Geocoding ----------

async function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number; city: string; state: string } | null> {
  if (!GOOGLE_MAPS_API_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      address
    )}&key=${GOOGLE_MAPS_API_KEY}&language=pt-BR&region=br`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== "OK" || !data.results?.length) return null;

    const result = data.results[0];
    const loc = result.geometry.location;

    let city = "";
    let state = "";
    for (const comp of result.address_components || []) {
      if (comp.types.includes("administrative_area_level_2"))
        city = comp.long_name;
      if (comp.types.includes("administrative_area_level_1"))
        state = comp.short_name;
    }

    return { lat: loc.lat, lng: loc.lng, city, state };
  } catch {
    return null;
  }
}

// ---------- POI Search ----------

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

// Nearby Search (OLD API): suporta type filter nativo e devolve resultados muito mais
// precisos que o Text Search da Places API v1 para categorias bem-definidas.
async function searchNearbyOld(
  lat: number,
  lng: number,
  type: string,
  radiusM: number,
  label: string
): Promise<NearbyPlace[]> {
  if (!GOOGLE_MAPS_API_KEY) return [];
  try {
    const url =
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
      `?location=${lat},${lng}&radius=${radiusM}&type=${type}` +
      `&language=pt-BR&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.warn(
        `searchNearbyOld(${type}) status=${data.status}`,
        data.error_message || ""
      );
    }
    const results = (data.results || []) as Array<{
      name?: string;
      vicinity?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
      rating?: number;
      user_ratings_total?: number;
    }>;
    return results
      .map((p) => {
        const plat = p.geometry?.location?.lat ?? 0;
        const plng = p.geometry?.location?.lng ?? 0;
        return {
          name: p.name || "",
          lat: plat,
          lng: plng,
          address: p.vicinity || "",
          type: label,
          rating: p.rating ?? null,
          reviews: p.user_ratings_total ?? null,
          distance_m: Math.round(haversineDistance(lat, lng, plat, plng)),
        };
      })
      .filter((p: NearbyPlace) => p.distance_m <= radiusM);
  } catch {
    return [];
  }
}

function deduplicateByLocation(places: NearbyPlace[]): NearbyPlace[] {
  const seen = new Set<string>();
  return places.filter((p) => {
    const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------- IBGE ----------

interface IBGEData {
  population: number | null;
  gdp_total: number | null;
  gdp_per_capita: number | null;
  idhm: number | null;
}

async function fetchIBGEData(city: string, state: string): Promise<IBGEData> {
  const result: IBGEData = {
    population: null,
    gdp_total: null,
    gdp_per_capita: null,
    idhm: null,
  };

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
    } catch {
      // continue
    }

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
            result.gdp_total = pibEmMil * 1000;
            if (result.population && result.population > 0) {
              result.gdp_per_capita = Math.round(
                result.gdp_total / result.population
              );
            }
          }
        }
      }
    } catch {
      // continue
    }

    try {
      const idhmUrl = `https://servicodados.ibge.gov.br/api/v3/agregados/1387/periodos/-1/variaveis/4359?localidades=N6[${found.id}]`;
      const idhmRes = await fetch(idhmUrl);
      if (idhmRes.ok) {
        const idhmData = await idhmRes.json();
        const series = idhmData?.[0]?.resultados?.[0]?.series?.[0]?.serie;
        if (series) {
          const latestKey = Object.keys(series).sort().pop();
          if (latestKey) result.idhm = parseFloat(series[latestKey]);
        }
      }
    } catch {
      // continue
    }
  } catch {
    // continue
  }

  return result;
}

// ---------- Claude text generator ----------

interface ClaudeTextResult {
  strengths: string[];
  tokensIn: number;
  tokensOut: number;
}

async function generateAnalysisText(args: {
  overallScore: number;
  classification: string;
  city: string;
  state: string;
  population: number;
  gdpPerCapita: number;
  dcInCity: number;
  evsCity: number;
  establishmentType: string;
  distanceKm: number;
  dcIn200m: number;
  dcIn500m: number;
  dcIn1km: number;
  dcIn2km: number;
  restaurants: number;
  supermarkets: number;
  gasStations: number;
  shoppings: number;
  hotels: number;
  hasHubNearby: boolean;
  observations: string;
}): Promise<ClaudeTextResult> {
  const empty: ClaudeTextResult = {
    strengths: [],
    tokensIn: 0,
    tokensOut: 0,
  };

  const systemPrompt = `Você é analista de mercado da PLUGGON, plataforma de inteligência para eletromobilidade no Brasil. Gere relatórios executivos baseados APENAS nos dados fornecidos. Responda APENAS com JSON válido, sem markdown, sem texto extra.`;

  const userPrompt = `Score: ${args.overallScore}/100 (${args.classification}).
Dados verificados:
- Cidade: ${args.city}/${args.state}, ${args.population.toLocaleString("pt-BR")} habitantes, PIB R$${Math.round(args.gdpPerCapita).toLocaleString("pt-BR")}
- EVs na cidade: ${args.evsCity.toLocaleString("pt-BR")}
- Carregadores DC cidade: ${args.dcInCity} (ABVE)
- Ponto: ${args.establishmentType} a ${args.distanceKm.toFixed(1)}km do centro
- Concorrentes DC: ${args.dcIn200m} em 200m, ${args.dcIn500m} em 500m, ${args.dcIn1km} em 1km, ${args.dcIn2km} em 2km
- POIs 500m: ${args.restaurants} restaurantes, ${args.supermarkets} supermercados, ${args.gasStations} postos combustível
- POIs 1km+: ${args.shoppings} shoppings, ${args.hotels} hotéis
- Hub transporte próximo: ${args.hasHubNearby ? "sim" : "não"}
- Observações do analista: ${args.observations || "(nenhuma)"}

Gere APENAS 3-5 PONTOS FORTES deste ponto.
REGRAS ABSOLUTAS:
- Use APENAS os dados fornecidos acima. NUNCA invente números.
- NUNCA diga "apenas X carregadores" com número diferente do fornecido.
- NUNCA recomende potência de carregador.
- NUNCA mencione dados que não foram fornecidos.
- Se um dado é bom, mencione. Se é ruim, NÃO mencione (não tem pontos de atenção).
- Cada ponto forte deve ter o DADO REAL que justifica. Ex: "30 restaurantes em 500m garantem alto tempo de permanência"
- Linguagem profissional de relatório executivo. Sem emojis.

Retorne SOMENTE o JSON:
{
  "strengths": ["bullet 1", "bullet 2", "bullet 3"]
}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const tokensIn = message.usage?.input_tokens || 0;
    const tokensOut = message.usage?.output_tokens || 0;

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { ...empty, tokensIn, tokensOut };
    }

    let raw = textBlock.text
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/gi, "")
      .trim();
    const start = raw.indexOf("{");
    if (start > 0) raw = raw.substring(start);

    try {
      const parsed = JSON.parse(raw);
      return {
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
        tokensIn,
        tokensOut,
      };
    } catch {
      return { ...empty, tokensIn, tokensOut };
    }
  } catch (err) {
    console.error("score-point: erro Claude:", err instanceof Error ? err.message : err);
    return empty;
  }
}

// ---------- Main handler ----------

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      address,
      establishment_type,
      establishment_name,
      lat: providedLat,
      lng: providedLng,
    } = body as {
      address?: string;
      establishment_type?: string;
      establishment_name?: string;
      lat?: number;
      lng?: number;
    };

    if (!address && (providedLat == null || providedLng == null)) {
      return Response.json(
        { error: "Endereço ou coordenadas são obrigatórios" },
        { status: 400 }
      );
    }

    let googleQueriesUsed = 0;

    // 1. Geocode (endereço ou lat/lng)
    let geo: { lat: number; lng: number; city: string; state: string } | null = null;
    if (typeof providedLat === "number" && typeof providedLng === "number") {
      let city = "";
      let state = "";
      if (GOOGLE_MAPS_API_KEY) {
        try {
          const revUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${providedLat},${providedLng}&key=${GOOGLE_MAPS_API_KEY}&language=pt-BR&region=br`;
          const revRes = await fetch(revUrl);
          googleQueriesUsed += 1;
          if (revRes.ok) {
            const revData = await revRes.json();
            if (revData.status === "OK" && revData.results?.length) {
              for (const comp of revData.results[0].address_components || []) {
                if (comp.types.includes("administrative_area_level_2"))
                  city = comp.long_name;
                if (comp.types.includes("administrative_area_level_1"))
                  state = comp.short_name;
              }
            }
          }
        } catch {
          // continue
        }
      }
      geo = { lat: providedLat, lng: providedLng, city, state };
    } else if (address) {
      geo = await geocodeAddress(address);
      googleQueriesUsed += 1;
    }
    if (!geo) {
      return Response.json(
        { error: "Não foi possível geocodificar o endereço." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 2. Buscar dados ABVE da cidade
    const abve = getABVEData(geo.city, geo.state);

    // 3. IBGE em paralelo com tudo abaixo
    const ibgePromise = fetchIBGEData(geo.city, geo.state);

    // 4. Geocode do centro da cidade (para distância)
    let cityLat = geo.lat;
    let cityLng = geo.lng;
    if (GOOGLE_MAPS_API_KEY && geo.city) {
      try {
        const cityGeoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
          `${geo.city}, ${geo.state}, Brasil`
        )}&key=${GOOGLE_MAPS_API_KEY}&language=pt-BR&region=br`;
        const cityGeoRes = await fetch(cityGeoUrl);
        googleQueriesUsed += 1;
        if (cityGeoRes.ok) {
          const cityGeoData = await cityGeoRes.json();
          if (cityGeoData.status === "OK" && cityGeoData.results?.length) {
            cityLat = cityGeoData.results[0].geometry.location.lat;
            cityLng = cityGeoData.results[0].geometry.location.lng;
          }
        }
      } catch {
        // continue
      }
    }

    // 5. Verificar se a cidade já tem carregadores frescos no banco
    const hasFresh = await cityHasFreshChargers(geo.city, supabase, 7);
    if (!hasFresh) {
      // Popular o banco. Cada fonte que funcionar enriquece; se falhar, ignora.
      const gQueries = await populateChargersFromGoogle(
        geo.city,
        geo.state,
        geo.lat,
        geo.lng,
        supabase
      );
      googleQueriesUsed += gQueries;
      await enrichWithOpenChargeMap(geo.city, geo.lat, geo.lng, supabase);
      await enrichWithCarregados(geo.city, geo.state, supabase);
      await enrichWithPlugShare(geo.city, geo.lat, geo.lng, supabase);
    }

    // Sempre faz uma busca local (2km do ponto) — o sweep amplo da cidade pode
    // perder carregadores discretos próximos ao endereço sendo analisado.
    googleQueriesUsed += await populateChargersLocal(
      geo.city,
      geo.state,
      geo.lat,
      geo.lng,
      supabase
    );

    // 6. POIs — primeiro tenta o cache (point_pois_cache em ~100m, < 30 dias)
    interface PoiBundle {
      restaurants: NearbyPlace[];
      supermarkets: NearbyPlace[];
      gasStations: NearbyPlace[];
      shoppings: NearbyPlace[];
      hotels: NearbyPlace[];
      parkingLots: NearbyPlace[];
      airports: NearbyPlace[];
      busStations: NearbyPlace[];
      universities: NearbyPlace[];
      hospitals: NearbyPlace[];
    }

    let poiBundle: PoiBundle | null = null;
    let poiSource = "google";
    try {
      const latDelta = 0.001; // ~110m
      const lngDelta = 0.001;
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: cacheRows } = await supabase
        .from("point_pois_cache")
        .select("lat, lng, pois_json, created_at")
        .gte("lat", geo.lat - latDelta)
        .lte("lat", geo.lat + latDelta)
        .gte("lng", geo.lng - lngDelta)
        .lte("lng", geo.lng + lngDelta)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(5);

      const hit = (cacheRows || []).find(
        (r: { lat: number; lng: number }) =>
          haversineDistance(geo!.lat, geo!.lng, Number(r.lat), Number(r.lng)) <= 100
      );
      if (hit && hit.pois_json) {
        poiBundle = hit.pois_json as PoiBundle;
        poiSource = "cache";
      }
    } catch (e) {
      console.warn("point_pois_cache read failed:", e);
    }

    if (!poiBundle) {
      // POIs em paralelo via Nearby Search OLD (type filter — muito mais preciso que text)
      const [
        restaurants,
        cafes,
        supermarkets,
        gasStations,
        shoppings,
        hotels,
        parkingLots,
        airports,
        busStations,
        universities,
        hospitals,
      ] = await Promise.all([
        searchNearbyOld(geo.lat, geo.lng, "restaurant", 500, "restaurante"),
        searchNearbyOld(geo.lat, geo.lng, "cafe", 500, "cafe"),
        searchNearbyOld(geo.lat, geo.lng, "supermarket", 500, "supermercado"),
        searchNearbyOld(geo.lat, geo.lng, "gas_station", 500, "posto"),
        searchNearbyOld(geo.lat, geo.lng, "shopping_mall", 1000, "shopping"),
        searchNearbyOld(geo.lat, geo.lng, "lodging", 1000, "hotel"),
        searchNearbyOld(geo.lat, geo.lng, "parking", 500, "estacionamento"),
        searchNearbyOld(geo.lat, geo.lng, "airport", 5000, "aeroporto"),
        searchNearbyOld(geo.lat, geo.lng, "bus_station", 3000, "rodoviaria"),
        searchNearbyOld(geo.lat, geo.lng, "university", 2000, "universidade"),
        searchNearbyOld(geo.lat, geo.lng, "hospital", 2000, "hospital"),
      ]);
      googleQueriesUsed += 11;

      // Restaurantes + cafés são da mesma família (ambos contam para o score de
      // alimentação), mas são tipos distintos no Google. Mescla dedup por coordenada.
      const restaurantsMerged = deduplicateByLocation([...restaurants, ...cafes]);

      poiBundle = {
        restaurants: restaurantsMerged,
        supermarkets: deduplicateByLocation(supermarkets),
        gasStations: deduplicateByLocation(gasStations),
        shoppings: deduplicateByLocation(shoppings),
        hotels: deduplicateByLocation(hotels),
        parkingLots: deduplicateByLocation(parkingLots),
        airports: deduplicateByLocation(airports),
        busStations: deduplicateByLocation(busStations),
        universities: deduplicateByLocation(universities),
        hospitals: deduplicateByLocation(hospitals),
      };

      try {
        await supabase.from("point_pois_cache").insert({
          lat: geo.lat,
          lng: geo.lng,
          city: geo.city,
          state: geo.state,
          pois_json: poiBundle,
        });
      } catch (e) {
        console.warn("point_pois_cache write failed:", e);
      }
    }

    const {
      restaurants,
      supermarkets,
      gasStations,
      shoppings,
      hotels,
      parkingLots,
      airports,
      busStations,
      universities,
      hospitals,
    } = poiBundle;

    console.log(`=== POIs ENCONTRADOS (Nearby Search API, fonte=${poiSource}) ===`);
    console.log("Restaurantes/cafés 500m:", restaurants.length);
    console.log("Supermercados 500m:", supermarkets.length);
    console.log("Postos combustível 500m:", gasStations.length);
    console.log("Shoppings 1km:", shoppings.length);
    console.log("Hotéis 1km:", hotels.length);
    console.log("Estacionamentos 500m:", parkingLots.length);
    console.log("Aeroportos 5km:", airports.length);
    console.log("Rodoviárias 3km:", busStations.length);
    console.log("Universidades 2km:", universities.length);
    console.log("Hospitais 2km:", hospitals.length);

    // 7. Buscar carregadores próximos do banco
    const chargersNear = await getChargersNearPoint(
      geo.lat,
      geo.lng,
      geo.city,
      supabase
    );

    // Debug — concorrentes por raio
    const formatChargerLabel = (c: { name: string; address: string }) => {
      const name = (c.name || "").trim() || "Sem nome";
      const addr = (c.address || "").trim();
      return addr ? `${name} - ${addr}` : name;
    };
    const dcNamesIn200m = chargersNear.in200m
      .filter((c) => c.charger_type === "DC")
      .map(formatChargerLabel);
    const dcNamesIn500m = chargersNear.in500m
      .filter((c) => c.charger_type === "DC")
      .map(formatChargerLabel);
    const dcNamesIn1km = chargersNear.in1km
      .filter((c) => c.charger_type === "DC")
      .map(formatChargerLabel);
    const dcNamesIn2km = chargersNear.in2km
      .filter((c) => c.charger_type === "DC")
      .map(formatChargerLabel);

    console.log("=== EV_CHARGERS DEBUG ===");
    console.log(
      `Total carregadores no banco para ${geo.city}:`,
      chargersNear.totalInCity
    );
    console.log("DC no banco:", chargersNear.dcInCity);

    console.log("=== CONCORRENTES POR RAIO ===");
    console.log("DC 200m:", chargersNear.dcIn200m, dcNamesIn200m);
    console.log("DC 500m:", chargersNear.dcIn500m, dcNamesIn500m);
    console.log("DC 1km:", chargersNear.dcIn1km, dcNamesIn1km);
    console.log("DC 2km:", chargersNear.dcIn2km, dcNamesIn2km);

    const ibgeData = await ibgePromise;
    const population = ibgeData.population ?? 0;
    const gdpPerCapita = ibgeData.gdp_per_capita ?? 0;

    // POIs deduplicados em 500m (para variável "Visibilidade e Fluxo")
    const allPOIs: NearbyPlace[] = [];
    const seen = new Set<string>();
    for (const list of [
      restaurants,
      supermarkets,
      gasStations,
      shoppings,
      hotels,
      parkingLots,
    ]) {
      for (const p of list) {
        const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
        if (!seen.has(key)) {
          seen.add(key);
          allPOIs.push(p);
        }
      }
    }
    const totalPoisIn500m = allPOIs.filter((p) => p.distance_m <= 500).length;
    console.log("Total POIs 500m:", totalPoisIn500m);

    // Distância ao centro
    const distanceKm =
      haversineDistance(geo.lat, geo.lng, cityLat, cityLng) / 1000;

    // 8. Calcular score
    const scoreInput: ScoreInput = {
      population,
      gdpPerCapita,
      abveDC: abve?.dc ?? 0,
      abveTotal: abve?.total ?? 0,
      abveEVs: abve?.evsSold ?? 0,
      dcIn200m: chargersNear.dcIn200m,
      dcIn500m: chargersNear.dcIn500m,
      dcIn1km: chargersNear.dcIn1km,
      dcIn2km: chargersNear.dcIn2km,
      dcInCity: chargersNear.dcInCity,
      totalInCity: chargersNear.totalInCity,
      dcNamesIn200m,
      dcNamesIn500m,
      dcNamesIn1km,
      dcNamesIn2km,
      restaurants: restaurants.length,
      supermarkets: supermarkets.length,
      gasStations: gasStations.length,
      shoppings: shoppings.length,
      hotels: hotels.length,
      parkingLots: parkingLots.length,
      universities: universities.length,
      hospitals: hospitals.length,
      hasAirportNearby: airports.length > 0,
      hasRodoviariaNearby: busStations.length > 0,
      totalPOIs: totalPoisIn500m,
      distanceToCenter: distanceKm,
      establishmentType: establishment_type || "outro",
      observations: establishment_name || "",
    };

    const scoreResult = calculateScore(scoreInput);

    // 9. Claude (1x, max 1500 tokens) — apenas pontos fortes/atenção/recomendação
    const dcCityForPrompt = Math.max(
      abve?.dc ?? 0,
      chargersNear.dcInCity || 0
    );
    const evsCityForPrompt =
      abve?.evsSold ??
      Math.round(
        population *
          (gdpPerCapita > 50_000
            ? 0.006
            : gdpPerCapita > 30_000
            ? 0.004
            : 0.002)
      );

    const claudeResult = await generateAnalysisText({
      overallScore: scoreResult.overallScore,
      classification: scoreResult.classification,
      city: geo.city,
      state: geo.state,
      population,
      gdpPerCapita,
      dcInCity: dcCityForPrompt,
      evsCity: evsCityForPrompt,
      establishmentType: establishment_type || "outro",
      distanceKm,
      dcIn200m: chargersNear.dcIn200m,
      dcIn500m: chargersNear.dcIn500m,
      dcIn1km: chargersNear.dcIn1km,
      dcIn2km: chargersNear.dcIn2km,
      restaurants: restaurants.length,
      supermarkets: supermarkets.length,
      gasStations: gasStations.length,
      shoppings: shoppings.length,
      hotels: hotels.length,
      hasHubNearby: airports.length > 0 || busStations.length > 0,
      observations: establishment_name || "",
    });

    // 10. Custos
    const claudeCost =
      claudeResult.tokensIn * CLAUDE_INPUT_COST_PER_TOKEN +
      claudeResult.tokensOut * CLAUDE_OUTPUT_COST_PER_TOKEN;
    const googleCost = googleQueriesUsed * GOOGLE_PLACES_COST_PER_QUERY;
    const totalCost = claudeCost + googleCost;

    const costBreakdown = {
      googleQueries: googleQueriesUsed,
      googleCostUsd: Math.round(googleCost * 10000) / 10000,
      claudeTokensIn: claudeResult.tokensIn,
      claudeTokensOut: claudeResult.tokensOut,
      claudeCostUsd: Math.round(claudeCost * 10000) / 10000,
      totalCostUsd: Math.round(totalCost * 10000) / 10000,
    };

    // 11. Logar uso
    await logUsage({
      module: "score",
      city: `${geo.city}/${geo.state}`,
      claudeTokensIn: claudeResult.tokensIn,
      claudeTokensOut: claudeResult.tokensOut,
      googlePlacesQueries: googleQueriesUsed,
    });

    // 12. Carregadores próximos para o mapa (5km)
    const nearbyChargers = chargersNear.in5km.map((c) => ({
      name: c.name || "",
      lat: Number(c.lat),
      lng: Number(c.lng),
      address: c.address || "",
      operator: c.operator || "",
      powerKW: Number(c.power_kw) || 0,
      type: c.charger_type,
      isFastCharge: c.charger_type === "DC",
      isOperational: true,
      rating: 0,
      reviews: 0,
      distance_m: Math.round(
        haversineDistance(geo.lat, geo.lng, Number(c.lat), Number(c.lng))
      ),
    }));

    // 13. Identificar usuário (custo é admin-only)
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const isAdmin = user?.email === ADMIN_EMAIL;

    // 14. Resposta
    const responseData: Record<string, unknown> = {
      address: address || "",
      lat: geo.lat,
      lng: geo.lng,
      city: geo.city,
      state: geo.state,
      establishment_type: establishment_type || "outro",
      establishment_name: establishment_name || "",
      overall_score: scoreResult.overallScore,
      raw_score: scoreResult.rawScore,
      city_factor: scoreResult.cityFactor,
      classification: scoreResult.classification,
      category_scores: scoreResult.categoryScores,
      scoring_variables: scoreResult.variables,
      strengths: claudeResult.strengths,
      nearby_pois: allPOIs,
      nearby_chargers: nearbyChargers,
      ibge_data: ibgeData,
      abve_data: abve,
      charger_summary: {
        total_in_city: chargersNear.totalInCity,
        dc_in_city: chargersNear.dcInCity,
        in_200m: chargersNear.in200m.length,
        in_500m: chargersNear.in500m.length,
        in_1km: chargersNear.in1km.length,
        in_2km: chargersNear.in2km.length,
        dc_in_200m: chargersNear.dcIn200m,
        dc_in_500m: chargersNear.dcIn500m,
        dc_in_1km: chargersNear.dcIn1km,
        dc_in_2km: chargersNear.dcIn2km,
      },
    };

    if (isAdmin) {
      responseData.cost_breakdown = costBreakdown;
    }

    // 15. Salvar histórico
    let score_id: number | null = null;
    if (user) {
      const { data: inserted } = await supabase
        .from("point_scores")
        .insert({
          user_id: user.id,
          address: address || "",
          lat: geo.lat,
          lng: geo.lng,
          city: geo.city,
          state: geo.state,
          establishment_type: establishment_type || "outro",
          establishment_name: establishment_name || "",
          overall_score: scoreResult.overallScore,
          classification: scoreResult.classification,
          variables_json: scoreResult.variables,
          strengths: claudeResult.strengths,
          weaknesses: [],
          recommendation: "",
          full_json: responseData,
          status: "done",
        })
        .select("id")
        .single();
      score_id = (inserted?.id as number) ?? null;
    }

    return Response.json({ ...responseData, score_id });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("score-point: erro geral:", errorMessage);
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
