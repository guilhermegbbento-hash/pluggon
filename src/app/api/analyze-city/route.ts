import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import {
  getCachedOrFetch,
  classifyCompetitors,
  countNearby,
} from "@/lib/competitors";
import type { CompetitorStation } from "@/lib/competitors";
import { calculateScore } from "@/lib/scoring-engine";
import type { ScoreInput } from "@/lib/scoring-engine";
import { logUsage } from "@/lib/usage-logger";

export const maxDuration = 300;

const anthropic = new Anthropic();

// ---------- IBGE Population + GDP ----------

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
            const gdpTotal = pibEmMil * 1000;
            if (result.population && result.population > 0) {
              result.gdpPerCapita = Math.round(gdpTotal / result.population);
            }
          }
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

// ---------- Geocode city ----------

async function geocodeCity(
  city: string,
  state: string
): Promise<{ lat: number; lng: number }> {
  const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
  if (GOOGLE_MAPS_API_KEY) {
    try {
      const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        `${city}, ${state}, Brasil`
      )}&key=${GOOGLE_MAPS_API_KEY}&language=pt-BR&region=br`;
      const geoRes = await fetch(geoUrl);
      if (geoRes.ok) {
        const geoData = await geoRes.json();
        if (geoData.status === "OK" && geoData.results?.length) {
          return {
            lat: geoData.results[0].geometry.location.lat,
            lng: geoData.results[0].geometry.location.lng,
          };
        }
      }
    } catch {
      // fallback
    }
  }
  return { lat: -15.78, lng: -47.93 };
}

// ---------- Region planning ----------

function getRegions(
  city: string,
  population: number | null,
  specificZone: string | null
): { region: string; pointCount: number }[] {
  // Se o usuário pediu uma zona específica
  if (specificZone && specificZone.trim()) {
    return [{ region: specificZone.trim(), pointCount: 50 }];
  }

  const pop = population || 200000;

  // Cidades pequenas: 1 chamada só
  if (pop <= 500000) {
    const pointCount = Math.min(Math.max(30, Math.round(pop / 20000)), 40);
    return [{ region: `toda a cidade de ${city}`, pointCount }];
  }

  // Cidades médias (500k-1M): 5 regiões
  if (pop <= 1000000) {
    const regions = ["Centro", "Zona Norte", "Zona Sul", "Zona Leste", "Zona Oeste"];
    const pointsPerRegion = Math.min(25, Math.round(pop / 20000 / regions.length));
    return regions.map((r) => ({
      region: `${r} de ${city}`,
      pointCount: Math.max(15, pointsPerRegion),
    }));
  }

  // Cidades grandes (>1M): 7 regiões
  const regions = [
    "Centro",
    "Zona Norte",
    "Zona Sul",
    "Zona Leste",
    "Zona Oeste",
    "Região Metropolitana Norte",
    "Região Metropolitana Sul",
  ];
  const pointsPerRegion = Math.min(25, Math.round(pop / 20000 / regions.length));
  return regions.map((r) => ({
    region: `${r} de ${city}`,
    pointCount: Math.max(15, pointsPerRegion),
  }));
}

// ---------- Validate coordinates via Google Places ----------

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

async function validateCoordinates(
  points: Record<string, unknown>[],
  city: string,
  state: string
): Promise<Record<string, unknown>[]> {
  console.log('=== VALIDANDO COORDENADAS ===', points.length, 'pontos');
  if (!GOOGLE_MAPS_API_KEY) return points;

  // Limitar a 50 validações por análise
  const toValidate = points.slice(0, 50);
  const rest = points.slice(50);

  const validated: Record<string, unknown>[] = [];

  for (const point of toValidate) {
    const nome = (point.nome ?? point.name ?? "") as string;
    const endereco = (point.endereco ?? point.address ?? "") as string;
    if (!nome) {
      validated.push({ ...point, googleValidated: false });
      continue;
    }

    // Tentar buscar pelo nome primeiro, depois pelo endereço
    const queries = [
      nome + " " + city + " " + state,
      ...(endereco ? [endereco + " " + city + " " + state] : []),
    ];

    let found = false;
    for (const query of queries) {
      try {
        const res = await fetch(
          "https://places.googleapis.com/v1/places:searchText",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
              "X-Goog-FieldMask":
                "places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.currentOpeningHours,places.types",
            },
            body: JSON.stringify({
              textQuery: query,
              maxResultCount: 1,
            }),
          }
        );
        if (res.ok) {
          const data = await res.json();
          const place = data.places?.[0];
          if (place?.location) {
            validated.push({
              ...point,
              lat: place.location.latitude,
              lng: place.location.longitude,
              endereco: place.formattedAddress || point.endereco,
              rating: place.rating || 0,
              reviews: place.userRatingCount || 0,
              operacao_24h:
                place.currentOpeningHours?.periods?.some(
                  (p: { open?: { hour?: number }; close?: { hour?: number } }) =>
                    p.open?.hour === 0 && p.close?.hour === 0
                ) ||
                nome.toLowerCase().includes("24") ||
                (point.operacao_24h as boolean) ||
                false,
              googleValidated: true,
            });
            found = true;
            break;
          }
        }
      } catch {
        // Tentar próxima query
      }
    }

    if (!found) {
      validated.push({ ...point, googleValidated: false });
    }
  }

  // Pontos além do limite de 50 ficam sem validação
  for (const point of rest) {
    validated.push({ ...point, googleValidated: false });
  }

  return validated;
}

// ---------- Normalize Claude response ----------

function normalizePoint(raw: Record<string, unknown>, region: string) {
  return {
    name: (raw.nome ?? raw.name ?? "") as string,
    lat: raw.lat as number,
    lng: raw.lng as number,
    address: (raw.endereco ?? raw.address ?? "") as string,
    category: (raw.categoria ?? raw.category ?? "outro") as string,
    subcategory: (raw.subcategoria ?? raw.subcategory ?? "") as string,
    score: 0,
    classification: "",
    justification: (raw.justificativa ?? raw.justification ?? "") as string,
    operacao_24h: (raw.operacao_24h ?? false) as boolean,
    tempo_permanencia: (raw.tempo_permanencia ?? "") as string,
    pontos_fortes: (raw.pontos_fortes ?? []) as string[],
    pontos_atencao: (raw.pontos_atencao ?? []) as string[],
    is_main_road: (raw.via_principal ?? raw.is_main_road ?? false) as boolean,
    has_parking: (raw.tem_estacionamento ?? raw.has_parking ?? true) as boolean,
    rating: (raw.rating ?? 0) as number,
    reviews: (raw.reviews ?? 0) as number,
    googleValidated: (raw.googleValidated ?? false) as boolean,
    region,
    chargers_in_2km: 0,
  };
}

// ---------- Build Claude prompt for a region ----------

function buildRegionPrompt(
  city: string,
  state: string,
  region: string,
  pointCount: number,
  population: number | null,
  chargerSummary: string
): string {
  const popInfo = population
    ? ` (população total: ${population.toLocaleString("pt-BR")})`
    : "";
  return `Retorne um JSON array com exatamente ${pointCount} pontos para eletropostos rápidos DC na região: ${region}, ${state}${popInfo}.

DADOS REAIS DE CONCORRÊNCIA (Google Places + carregados.com.br):
${chargerSummary}

DISTRIBUIÇÃO OBRIGATÓRIA DE CATEGORIAS (proporcional a ${pointCount} pontos):
- ~30% postos de combustível 24h e terrenos em avenidas principais (${Math.round(pointCount * 0.3)} pontos)
- ~20% shoppings e centros comerciais (${Math.round(pointCount * 0.2)} pontos)
- ~15% hospitais 24h e farmácias 24h (${Math.round(pointCount * 0.15)} pontos)
- ~10% rodoviárias e aeroportos (${Math.round(pointCount * 0.1)} pontos)
- ~10% supermercados e atacadões (${Math.round(pointCount * 0.1)} pontos)
- ~10% universidades e hotéis (${Math.round(pointCount * 0.1)} pontos)
- ~5% estacionamentos e outros (${Math.round(pointCount * 0.05)} pontos)

Cada objeto: {"nome": "Nome real", "lat": -23.55, "lng": -46.63, "endereco": "Endereço real completo", "categoria": "posto_24h", "subcategoria": "Rede ou detalhe", "justificativa": "Motivo curto", "operacao_24h": true, "tempo_permanencia": "15-45min", "pontos_fortes": ["ponto1"], "pontos_atencao": ["ponto1"], "via_principal": true, "tem_estacionamento": true}.

NÃO inclua "score" ou "classificacao" — isso será calculado pelo sistema.

Categorias: posto_24h, posto_combustivel, shopping, hospital_24h, farmacia_24h, rodoviaria, aeroporto, universidade, supermercado, atacadao, hotel, academia, estacionamento, concessionaria, centro_comercial, terreno, restaurante, outro.

IMPORTANTE:
- APENAS locais na região "${region}" — não inclua pontos de outras zonas
- Coordenadas REAIS de locais que EXISTEM
- "via_principal": true se o local fica em avenida/rodovia importante
- "tem_estacionamento": true se o local tem estacionamento
- Priorize diversidade geográfica dentro da região
- Responda APENAS o JSON array, sem markdown, sem texto extra.`;
}

// ---------- Parse Claude JSON response ----------

function parseClaudeJSON(raw: string): any {
  let text = raw;
  text = text.replace(/```json\s*/gi, "");
  text = text.replace(/```\s*/gi, "");
  text = text.trim();
  const startBrace = text.indexOf("{");
  const startBracket = text.indexOf("[");
  let start = -1;
  if (startBrace === -1) start = startBracket;
  else if (startBracket === -1) start = startBrace;
  else start = Math.min(startBrace, startBracket);
  if (start > 0) text = text.substring(start);
  const endBrace = text.lastIndexOf("}");
  const endBracket = text.lastIndexOf("]");
  const end = Math.max(endBrace, endBracket);
  if (end > 0) text = text.substring(0, end + 1);
  try {
    return JSON.parse(text);
  } catch (e) {
    if (text.includes('"sections"')) {
      const lastComplete = text.lastIndexOf("}");
      if (lastComplete > 0) {
        const fixed = text.substring(0, lastComplete + 1) + "]}";
        return JSON.parse(fixed);
      }
    }
    console.error("JSON raw:", text.substring(0, 200));
    throw new Error("Failed to parse JSON: " + (e as Error).message);
  }
}

// ---------- Claude retry helper ----------

async function callClaudeWithRetry(
  params: Anthropic.MessageCreateParamsNonStreaming
): Promise<Anthropic.Message> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 280000);
    try {
      const msg = await anthropic.messages.create(params, {
        signal: controller.signal,
      });
      return msg;
    } catch (err) {
      console.warn(
        `Chamada Claude falhou (tentativa ${attempt + 1}):`,
        err instanceof Error ? err.message : err
      );
      if (attempt === 1) throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("Falha após 2 tentativas");
}

// ---------- Score a batch of raw points ----------

function scorePoints(
  rawPoints: Record<string, unknown>[],
  region: string,
  population: number,
  gdpPerCapita: number,
  chargerInfo: { total: number; dc: number },
  competitors: CompetitorStation[]
) {
  return rawPoints
    .map((p) => {
      const normalized = normalizePoint(p, region);
      if (!normalized.lat || !normalized.lng) return null;

      const chargersIn200m = countNearby(normalized.lat, normalized.lng, competitors, 200);
      const chargersIn2km = countNearby(normalized.lat, normalized.lng, competitors, 2000);

      // Inferir qualidade do bairro pelo tipo de estabelecimento
      const premiumTypes = ["shopping", "aeroporto", "hotel"];
      const altoTypes = ["hospital_24h", "centro_comercial", "concessionaria"];
      const nbQuality = premiumTypes.includes(normalized.category)
        ? "premium"
        : altoTypes.includes(normalized.category)
          ? "alto"
          : "medio";

      const scoreInput: ScoreInput = {
        population,
        gdpPerCapita,
        establishmentType: normalized.category,
        is24h: normalized.operacao_24h,
        neighborhoodQuality: nbQuality,
        chargersInCity: chargerInfo.total,
        dcChargersInCity: chargerInfo.dc,
        chargersIn200m,
        chargersIn2km,
        restaurantsNearby: 3,
        hospitalsNearby: 1,
        shoppingNearby: 1,
        gasStationsNearby: 2,
        parkingNearby: normalized.has_parking ? 2 : 0,
        rating: normalized.rating,
        reviews: normalized.reviews,
      };

      const scoreResult = calculateScore(scoreInput);

      return {
        name: normalized.name,
        lat: normalized.lat,
        lng: normalized.lng,
        address: normalized.address,
        category: normalized.category,
        subcategory: normalized.subcategory,
        score: scoreResult.overallScore,
        classification: scoreResult.classification,
        justification: normalized.justification,
        operacao_24h: normalized.operacao_24h,
        tempo_permanencia: normalized.tempo_permanencia,
        pontos_fortes: normalized.pontos_fortes,
        pontos_atencao: normalized.pontos_atencao,
        region,
        chargers_in_2km: chargersIn2km,
        googleValidated: normalized.googleValidated,
      };
    })
    .filter(Boolean);
}

// ---------- Main handler (streaming) ----------

export async function POST(request: Request) {
  try {
    const { city, state, zone } = await request.json();

    if (!city || !state) {
      return Response.json(
        { error: "Cidade e estado são obrigatórios" },
        { status: 400 }
      );
    }

    // Buscar IBGE e geocode em paralelo
    const [ibgeData, cityCoords] = await Promise.all([
      fetchIBGECityData(city, state),
      geocodeCity(city, state),
    ]);

    const population = ibgeData.population || 200000;
    const gdpPerCapita = ibgeData.gdpPerCapita || 30000;

    // Buscar concorrentes (cache ou Google Places + carregados.com.br)
    console.log("=== BUSCANDO CONCORRENTES ===");
    const supabase = await createClient();
    let allCompetitors: CompetitorStation[] = [];
    let carregadosTotal: number | null = null;
    let competitorGoogleQueries = 0;
    try {
      const result = await getCachedOrFetch(
        city,
        state,
        cityCoords.lat,
        cityCoords.lng,
        supabase,
        population
      );
      allCompetitors = result.competitors;
      carregadosTotal = result.carregadosTotal;
      competitorGoogleQueries = result.queryStats.cache ? 0 : 5; // 5 queries if cache miss
    } catch (err) {
      console.error("=== ERRO BUSCANDO CONCORRENTES ===", err);
    }

    const chargerInfo = classifyCompetitors(allCompetitors);

    const chargerSummary = `- Total de carregadores na região: ${chargerInfo.total} (Google Places + carregados.com.br)
- Carregadores DC rápidos (≥40kW): ${chargerInfo.dc}
- Carregadores AC (lentos): ${chargerInfo.ac}
- Operacionais: ${chargerInfo.operational}
- Operadores: ${chargerInfo.operators.join(", ") || "Nenhum"}
${carregadosTotal !== null ? `- Total no carregados.com.br: ${carregadosTotal} (referência)\n` : ""}${allCompetitors.slice(0, 15).map((c) => `- ${c.name} (${c.operator}, ${c.powerKW}kW, ${c.isFastCharge ? "DC" : "AC"}, fonte: ${c.source}) — ${c.address}`).join("\n")}`;

    // Calcular regiões baseado na população
    const regions = getRegions(city, population, zone || null);

    // Stream: enviar resultados conforme cada região termina
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Enviar metadados iniciais
        const meta = JSON.stringify({
          type: "meta",
          city,
          state,
          population,
          totalRegions: regions.length,
          regions: regions.map((r) => r.region),
        });
        controller.enqueue(encoder.encode(meta + "\n"));

        let allPoints: any[] = [];
        let totalClaudeIn = 0;
        let totalClaudeOut = 0;
        let totalGoogleQueries = competitorGoogleQueries;

        // Processar regiões sequencialmente (evita rate limit)
        for (let i = 0; i < regions.length; i++) {
          const { region, pointCount } = regions[i];

          // Enviar progresso
          const progress = JSON.stringify({
            type: "progress",
            region,
            regionIndex: i,
            totalRegions: regions.length,
          });
          controller.enqueue(encoder.encode(progress + "\n"));

          try {
            const prompt = buildRegionPrompt(
              city,
              state,
              region,
              pointCount,
              population,
              chargerSummary
            );

            const message = await callClaudeWithRetry({
              model: "claude-sonnet-4-20250514",
              max_tokens: 8192,
              messages: [{ role: "user", content: prompt }],
            });

            // Track Claude usage
            totalClaudeIn += message.usage?.input_tokens || 0;
            totalClaudeOut += message.usage?.output_tokens || 0;

            const textBlock = message.content.find((b) => b.type === "text");
            if (textBlock && textBlock.type === "text") {
              const parsed = parseClaudeJSON(textBlock.text);
              let rawPoints: Record<string, unknown>[] = Array.isArray(parsed)
                ? parsed
                : parsed?.points || [];

              // Validar coordenadas via Google Places (máx 50 por região)
              const pointsToValidate = Math.min(rawPoints.length, 50);
              totalGoogleQueries += pointsToValidate; // Each validation = 1 Google query
              rawPoints = await validateCoordinates(rawPoints, city, state);

              const scoredPoints = scorePoints(
                rawPoints,
                region,
                population,
                gdpPerCapita,
                chargerInfo,
                allCompetitors
              );

              allPoints = [...allPoints, ...scoredPoints];

              // Enviar pontos desta região
              const regionResult = JSON.stringify({
                type: "region_complete",
                region,
                regionIndex: i,
                points: scoredPoints,
                totalPointsSoFar: allPoints.length,
              });
              controller.enqueue(encoder.encode(regionResult + "\n"));
            }
          } catch (err) {
            console.error(
              `analyze-city: erro na região ${region}:`,
              err instanceof Error ? err.message : err
            );
            // Enviar erro da região mas continuar com as outras
            const errMsg = JSON.stringify({
              type: "region_error",
              region,
              regionIndex: i,
              error: err instanceof Error ? err.message : "Erro desconhecido",
            });
            controller.enqueue(encoder.encode(errMsg + "\n"));
          }
        }

        // Deduplicar pontos muito próximos (< 100m)
        const deduped = deduplicatePoints(allPoints);

        // Mapear concorrentes para o formato do frontend (com campos extras)
        const competitors = allCompetitors.map((c) => ({
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
          connectionType: "Não identificado",
          totalConnections: 0,
          usageCost: "Não informado",
          levelName: c.type,
        }));

        console.log("Concorrentes (3 fontes): enviando", competitors.length, "no resultado final");

        // Enviar resultado final
        const final = JSON.stringify({
          type: "complete",
          city,
          state,
          population,
          points: deduped,
          competitors,
          totalPoints: deduped.length,
        });
        controller.enqueue(encoder.encode(final + "\n"));

        // Salvar no banco
        try {
          const {
            data: { user },
          } = await supabase.auth.getUser();

          if (user) {
            await supabase.from("city_analyses").insert({
              user_id: user.id,
              city,
              state,
              population,
              charger_count: chargerInfo.total,
              points_json: deduped,
              status: "done",
            });
          }
        } catch (dbErr) {
          console.error("analyze-city: erro ao salvar no banco:", dbErr);
        }

        // Log usage
        await logUsage({
          module: "heatmap",
          city: `${city}/${state}`,
          claudeTokensIn: totalClaudeIn,
          claudeTokensOut: totalClaudeOut,
          googlePlacesQueries: totalGoogleQueries,
        });

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("analyze-city: erro geral:", {
      message: errorMessage,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}

// ---------- Deduplicate points within 100m ----------

function deduplicatePoints(points: any[]): any[] {
  const result: any[] = [];
  for (const point of points) {
    const isDuplicate = result.some((existing) => {
      const dlat = Math.abs(existing.lat - point.lat);
      const dlng = Math.abs(existing.lng - point.lng);
      return dlat < 0.001 && dlng < 0.001; // ~100m
    });
    if (!isDuplicate) {
      result.push(point);
    }
  }
  return result;
}
