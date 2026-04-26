import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import {
  getCachedOrFetch,
  classifyCompetitors,
  countNearby,
} from "@/lib/competitors";
import { calculateScore } from "@/lib/scoring-engine";
import type { ScoreInput, ScoreVariable } from "@/lib/scoring-engine";
import { logUsage } from "@/lib/usage-logger";
import { getABVEData } from "@/lib/abve-real-data";

export const maxDuration = 300;

const anthropic = new Anthropic();
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

// Pricing constants (mirror usage-logger)
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

async function generateAnalysisText(
  scoreVariables: ScoreVariable[],
  overallScore: number,
  classification: string,
  city: string,
  state: string,
  establishmentType: string,
  observations: string
): Promise<ClaudeTextResult> {
  const empty: ClaudeTextResult = {
    strengths: [],
    weaknesses: [],
    recommendation: "",
    tokensIn: 0,
    tokensOut: 0,
  };

  const variablesSummary = scoreVariables
    .map(
      (v) =>
        `[${v.category}] ${v.name}: ${v.score}/10 (peso ${v.weight}, ${v.source}) — ${v.justification}`
    )
    .join("\n");

  const systemPrompt = `Você é a BLEV, plataforma de inteligência para eletromobilidade no Brasil.

REGRAS INVIOLÁVEIS:
- Score JÁ FOI calculado pelo sistema. NUNCA altere, comente ou questione o score.
- NUNCA invente dados: estatísticas, quantidades, percentuais, rankings, vendas. Use APENAS os dados listados na entrada.
- NUNCA recomende potência de carregador. Não fale "DC 80kW", "150kW", "50kW", etc.
- NUNCA mencione recomendação de instalação técnica.
- Sua tarefa é APENAS interpretar os dados em prosa: pontos fortes (3 a 5 bullets) e pontos de atenção (3 a 5 bullets), e uma recomendação de NEGÓCIO sucinta.
- Cada bullet deve ter no máximo 18 palavras e referenciar pelo menos um dado real fornecido.
- Responda APENAS com JSON válido, sem markdown, sem texto extra.`;

  const userPrompt = `DADOS:
- Cidade: ${city}, ${state}
- Tipo do ponto: ${establishmentType}
- Observações do usuário: ${observations || "(nenhuma)"}

SCORE CALCULADO (NÃO ALTERAR): ${overallScore}/100 — ${classification}

VARIÁVEIS COM DADOS REAIS:
${variablesSummary}

Gere SOMENTE o JSON abaixo. NÃO mude o score. NÃO invente dados. NÃO recomende potência de carregador.

{
  "strengths": ["bullet 1", "bullet 2", "bullet 3"],
  "weaknesses": ["bullet 1", "bullet 2", "bullet 3"],
  "recommendation": "1-2 frases de recomendação de negócio com base nos dados (sem potência)."
}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const tokensIn = message.usage?.input_tokens || 0;
    const tokensOut = message.usage?.output_tokens || 0;

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { ...empty, tokensIn, tokensOut };
    }

    let raw = textBlock.text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
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

    // 1. Geocode
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

    // 2. Buscar dados ABVE da cidade
    const abve = getABVEData(geo.city, geo.state);

    // 3. IBGE (em paralelo com tudo abaixo)
    const ibgePromise = fetchIBGEData(geo.city, geo.state);

    // 4. Concorrentes via cache (Google Places se cache miss — competitors.ts usa 5 queries)
    const supabase = await createClient();
    const competitorsResult = await getCachedOrFetch(
      geo.city,
      geo.state,
      geo.lat,
      geo.lng,
      supabase
    );
    const allCompetitors = competitorsResult.competitors;
    const cacheHit = !!competitorsResult.queryStats?.cache;
    if (!cacheHit) {
      // 5 queries fixas (queries de competitors.ts) — independente de subareas extras
      googleQueriesUsed += 5;
    }

    const chargerInfo = classifyCompetitors(allCompetitors);
    const competitorsIn200m = countNearby(geo.lat, geo.lng, allCompetitors, 200);
    const competitorsIn500m = countNearby(geo.lat, geo.lng, allCompetitors, 500);
    const competitorsIn1km = countNearby(geo.lat, geo.lng, allCompetitors, 1000);
    const competitorsIn2km = countNearby(geo.lat, geo.lng, allCompetitors, 2000);

    // 5. POIs no raio (9 categorias)
    const [
      restaurants,
      pharmacies,
      gasStations,
      supermarkets,
      shoppings,
      hospitals,
      universities,
      hotels,
      parking,
    ] = await Promise.all([
      searchNearbyPlaces(geo.lat, geo.lng, "restaurante", "restaurante", 500),
      searchNearbyPlaces(geo.lat, geo.lng, "farmácia", "farmacia", 500),
      searchNearbyPlaces(geo.lat, geo.lng, "posto de gasolina", "posto", 500),
      searchNearbyPlaces(geo.lat, geo.lng, "supermercado", "supermercado", 500),
      searchNearbyPlaces(geo.lat, geo.lng, "shopping center", "shopping", 1000),
      searchNearbyPlaces(geo.lat, geo.lng, "hospital", "hospital", 1000),
      searchNearbyPlaces(geo.lat, geo.lng, "universidade", "universidade", 1000),
      searchNearbyPlaces(geo.lat, geo.lng, "hotel", "hotel", 1000),
      searchNearbyPlaces(geo.lat, geo.lng, "estacionamento", "estacionamento", 500),
    ]);
    googleQueriesUsed += 9;

    // Validar o ponto (rating/reviews)
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
            body: JSON.stringify({
              textQuery: address,
              maxResultCount: 1,
            }),
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

    // Geocode do centro da cidade
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

    const ibgeData = await ibgePromise;

    // Dedup POIs
    const allPOIs: NearbyPlace[] = [];
    const seen = new Set<string>();
    for (const list of [
      restaurants,
      pharmacies,
      gasStations,
      supermarkets,
      shoppings,
      hospitals,
      universities,
      hotels,
      parking,
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

    // 6. Calcular score (100% código)
    const scoreInput: ScoreInput = {
      city: geo.city,
      state: geo.state,
      population: ibgeData.population,
      gdpPerCapita: ibgeData.gdp_per_capita,
      abveDcCity: abve?.dc ?? null,
      abveTotalCity: abve?.total ?? null,
      abveEvsSold: abve?.evsSold ?? null,
      competitorsIn200m,
      competitorsIn500m,
      competitorsIn1km,
      competitorsIn2km,
      restaurantsIn500m: restaurants.length,
      supermercadosIn500m: supermarkets.length,
      farmaciasIn500m: pharmacies.length,
      shoppingsIn1km: shoppings.length,
      hospitaisIn1km: hospitals.length,
      postosIn500m: gasStations.length,
      hoteisIn1km: hotels.length,
      totalPoisIn500m,
      lat: geo.lat,
      lng: geo.lng,
      cityLat,
      cityLng,
      rating: pointRating,
      reviews: pointReviews,
      establishmentType: establishment_type || "outro",
      is24h: ["posto_24h", "hospital_24h", "farmacia_24h", "aeroporto"].includes(
        establishment_type || ""
      ),
      observations: establishment_name || "",
    };

    const scoreResult = calculateScore(scoreInput);

    // 7. Claude para texto APENAS
    const claudeResult = await generateAnalysisText(
      scoreResult.variables,
      scoreResult.overallScore,
      scoreResult.classification,
      geo.city,
      geo.state,
      establishment_type || "outro",
      establishment_name || ""
    );

    // 8. Custos
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

    // 9. Logar
    await logUsage({
      module: "score",
      city: `${geo.city}/${geo.state}`,
      claudeTokensIn: claudeResult.tokensIn,
      claudeTokensOut: claudeResult.tokensOut,
      googlePlacesQueries: googleQueriesUsed,
    });

    // 10. Resposta
    const responseData = {
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
      nearby_chargers: allCompetitors
        .filter(
          (c) => haversineDistance(geo.lat, geo.lng, c.lat, c.lng) <= 5000
        )
        .map((c) => ({
          name: c.name,
          lat: c.lat,
          lng: c.lng,
          address: c.address,
          operator: c.operator,
          powerKW: c.powerKW,
          type: c.type,
          source: c.source,
          isFastCharge: c.isFastCharge,
          isOperational: c.isOperational,
          rating: c.rating,
          reviews: c.reviews,
          distance_m: Math.round(haversineDistance(geo.lat, geo.lng, c.lat, c.lng)),
        })),
      ibge_data: ibgeData,
      abve_data: abve,
      charger_summary: {
        total: chargerInfo.total,
        dc: chargerInfo.dc,
        ac: chargerInfo.ac,
        in_200m: competitorsIn200m,
        in_500m: competitorsIn500m,
        in_1km: competitorsIn1km,
        in_2km: competitorsIn2km,
        operators: chargerInfo.operators,
      },
      cost_breakdown: costBreakdown,
    };

    // 11. Salvar
    const {
      data: { user },
    } = await supabase.auth.getUser();

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
