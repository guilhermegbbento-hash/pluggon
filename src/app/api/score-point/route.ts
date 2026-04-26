import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { calculateScore } from "@/lib/scoring-engine";
import type { ScoreInput } from "@/lib/scoring-engine";
import { logUsage } from "@/lib/usage-logger";
import { getABVEData } from "@/lib/abve-real-data";
import {
  populateChargersFromGoogle,
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

async function searchNearbyPlaces(
  lat: number,
  lng: number,
  textQuery: string,
  type: string,
  radiusM = 500
): Promise<NearbyPlace[]> {
  if (!GOOGLE_MAPS_API_KEY) return [];
  try {
    const res = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
          "X-Goog-FieldMask":
            "places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount",
        },
        body: JSON.stringify({
          textQuery,
          locationBias: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius: radiusM,
            },
          },
          languageCode: "pt-BR",
          maxResultCount: 20,
        }),
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.places) return [];

    return data.places
      .map((p: {
        displayName?: { text?: string };
        formattedAddress?: string;
        location?: { latitude?: number; longitude?: number };
        rating?: number;
        userRatingCount?: number;
      }) => {
        const plat = p.location?.latitude || 0;
        const plng = p.location?.longitude || 0;
        return {
          name: p.displayName?.text || "",
          lat: plat,
          lng: plng,
          address: p.formattedAddress || "",
          type,
          rating: p.rating ?? null,
          reviews: p.userRatingCount ?? null,
          distance_m: Math.round(haversineDistance(lat, lng, plat, plng)),
        };
      })
      .filter((p: NearbyPlace) => p.distance_m <= radiusM);
  } catch {
    return [];
  }
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
  weaknesses: string[];
  recommendation: string;
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
  totalPOIs: number;
  observations: string;
}): Promise<ClaudeTextResult> {
  const empty: ClaudeTextResult = {
    strengths: [],
    weaknesses: [],
    recommendation: "",
    tokensIn: 0,
    tokensOut: 0,
  };

  const systemPrompt = `Você é analista de mercado da PLUGGON, plataforma de inteligência para eletromobilidade no Brasil.

REGRAS INVIOLÁVEIS:
- Gere relatório profissional baseado APENAS nos dados fornecidos.
- Nunca invente dados.
- Nunca recomende potência de carregador (não diga "DC 80kW", "150kW", "50kW", etc).
- Nunca questione, altere ou comente o score (já foi calculado pelo sistema).
- Linguagem de relatório executivo, sem emojis.
- Cada bullet com no máximo 22 palavras e referenciando pelo menos um dado real fornecido.
- Responda APENAS com JSON válido, sem markdown, sem texto extra.`;

  const userPrompt = `Score: ${args.overallScore}/100 (${args.classification}).

Cidade: ${args.city}/${args.state}, ${args.population.toLocaleString("pt-BR")} habitantes, PIB per capita R$ ${Math.round(args.gdpPerCapita).toLocaleString("pt-BR")}.
Carregadores DC na cidade: ${args.dcInCity}. EVs na cidade: ${args.evsCity.toLocaleString("pt-BR")}.

Ponto: ${args.establishmentType} a ${args.distanceKm.toFixed(1)} km do centro.
Concorrentes DC: ${args.dcIn200m} em 200m, ${args.dcIn500m} em 500m, ${args.dcIn1km} em 1km, ${args.dcIn2km} em 2km.
POIs em 500m: ${args.restaurants} restaurantes, ${args.supermarkets} supermercados, ${args.gasStations} postos, ${args.totalPOIs} no total.

Observações do analista: ${args.observations || "(nenhuma)"}

Gere PONTOS FORTES (3-5 itens) e PONTOS DE ATENÇÃO (3-5 itens) com base APENAS nesses dados.

Retorne SOMENTE o JSON:
{
  "strengths": ["bullet 1", "bullet 2", "bullet 3"],
  "weaknesses": ["bullet 1", "bullet 2", "bullet 3"],
  "recommendation": "1-2 frases de recomendação executiva, sem mencionar potência de carregador."
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
        weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
        recommendation:
          typeof parsed.recommendation === "string" ? parsed.recommendation : "",
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

    // 6. POIs em paralelo (500m e 1km)
    const [
      restaurants,
      supermarkets,
      gasStations,
      shoppings,
      hotels,
      parkingLots,
    ] = await Promise.all([
      searchNearbyPlaces(geo.lat, geo.lng, "restaurante", "restaurante", 500),
      searchNearbyPlaces(geo.lat, geo.lng, "supermercado", "supermercado", 500),
      searchNearbyPlaces(geo.lat, geo.lng, "posto de gasolina", "posto", 500),
      searchNearbyPlaces(geo.lat, geo.lng, "shopping center", "shopping", 1000),
      searchNearbyPlaces(geo.lat, geo.lng, "hotel", "hotel", 1000),
      searchNearbyPlaces(geo.lat, geo.lng, "estacionamento", "estacionamento", 500),
    ]);
    googleQueriesUsed += 6;

    // Validar rating do ponto (se endereço foi fornecido)
    let pointRating = 0;
    let pointReviews = 0;
    if (GOOGLE_MAPS_API_KEY && address) {
      try {
        const placeRes = await fetch(
          "https://places.googleapis.com/v1/places:searchText",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
              "X-Goog-FieldMask": "places.rating,places.userRatingCount",
            },
            body: JSON.stringify({ textQuery: address, maxResultCount: 1 }),
          }
        );
        googleQueriesUsed += 1;
        if (placeRes.ok) {
          const placeData = await placeRes.json();
          const place = placeData.places?.[0];
          if (place) {
            pointRating = place.rating || 0;
            pointReviews = place.userRatingCount || 0;
          }
        }
      } catch {
        // continue
      }
    }

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
      totalPOIs: totalPoisIn500m,
      distanceToCenter: distanceKm,
      rating: pointRating,
      reviewCount: pointReviews,
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
      totalPOIs: totalPoisIn500m,
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
      weaknesses: claudeResult.weaknesses,
      recommendation: claudeResult.recommendation,
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
          weaknesses: claudeResult.weaknesses,
          recommendation: claudeResult.recommendation,
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
