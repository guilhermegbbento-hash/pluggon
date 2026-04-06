import { fetchChargers } from "@/lib/openchargemap";
import type { SupabaseClient } from "@supabase/supabase-js";

export type TypeConfidence = "confirmed" | "estimated" | "unknown";

export interface CompetitorStation {
  name: string;
  lat: number;
  lng: number;
  address: string;
  source: string;
  operator: string;
  powerKW: number;
  type: string;
  isFastCharge: boolean;
  typeConfidence: TypeConfidence;
  isOperational: boolean;
  rating: number;
  reviews: number;
}

/** Classify a station by its name using known operator keywords. */
export function classifyByName(
  name: string
): { type: string; estimatedPower: number; isFastCharge: boolean } {
  const nameLower = name.toLowerCase();
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
    "ipiranga",
  ];
  const acKeywords = [
    "byd",
    "bmw",
    "volvo",
    "audi",
    "porsche",
    "mercedes",
    "condor",
    "shopping",
    "patio",
    "pátio",
    "mall",
  ];

  if (dcKeywords.some((k) => nameLower.includes(k))) {
    return { type: "DC Rápido (estimado)", estimatedPower: 60, isFastCharge: true };
  }
  if (acKeywords.some((k) => nameLower.includes(k))) {
    return { type: "AC Lento (estimado)", estimatedPower: 7, isFastCharge: false };
  }
  return { type: "Não identificado", estimatedPower: 0, isFastCharge: false };
}

export interface CompetitorResult {
  competitors: CompetitorStation[];
  carregadosTotal: number | null;
  queryStats: Record<string, number>;
}

export async function fetchAllCompetitors(
  city: string,
  state: string,
  lat: number,
  lng: number,
  population?: number
): Promise<CompetitorResult> {
  const allResults: CompetitorStation[] = [];
  const queryStats: Record<string, number> = {};

  function isDuplicate(newLat: number, newLng: number): boolean {
    return allResults.some((e) => {
      const d = Math.sqrt(
        Math.pow((e.lat - newLat) * 111000, 2) +
          Math.pow((e.lng - newLng) * 111000, 2)
      );
      return d < 100;
    });
  }

  function addFromGoogle(places: any[], queryLabel: string) {
    let added = 0;
    for (const p of places) {
      if (!p.location) continue;
      if (isDuplicate(p.location.latitude, p.location.longitude)) continue;
      allResults.push({
        name: p.displayName?.text || "Sem nome",
        lat: p.location.latitude,
        lng: p.location.longitude,
        address: p.formattedAddress || "",
        source: "Google Places",
        operator: "Verificar",
        powerKW: 0,
        type: "Verificar in loco",
        isFastCharge: false,
        typeConfidence: "unknown",
        isOperational: p.businessStatus === "OPERATIONAL",
        rating: p.rating || 0,
        reviews: p.userRatingCount || 0,
      });
      added++;
    }
    queryStats[queryLabel] = added;
  }

  async function searchGoogle(query: string, queryLabel: string, maxResults = 20) {
    try {
      const res = await fetch(
        "https://places.googleapis.com/v1/places:searchText",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey!,
            "X-Goog-FieldMask":
              "places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types,places.businessStatus",
          },
          body: JSON.stringify({
            textQuery: query,
            locationBias: {
              circle: {
                center: { latitude: lat, longitude: lng },
                radius: 50000,
              },
            },
            maxResultCount: maxResults,
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        addFromGoogle(data.places || [], queryLabel);
      }
    } catch (err) {
      console.error("Google Places erro:", queryLabel, err);
      queryStats[queryLabel] = 0;
    }
  }

  // FONTE 1: Google Places - 5 queries otimizadas (reduzido de 16)
  const googleQueries = [
    "eletroposto",
    "carregador veiculo eletrico",
    "ev charging station",
    "estacao recarga",
    "ponto recarga",
  ];

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (apiKey) {
    for (const query of googleQueries) {
      await searchGoogle(
        query + " em " + city + " " + state,
        "google:" + query
      );
    }

    // FONTE 3: Subáreas para cidades grandes (pop > 500k)
    if (population && population > 500000) {
      const subAreas = ["centro", "zona norte", "zona sul", "zona leste", "zona oeste"];
      for (const subArea of subAreas) {
        await searchGoogle(
          "eletroposto " + subArea + " " + city,
          "subarea:" + subArea,
          10
        );
      }
    }
  }

  // FONTE 4: Tentar carregados.com.br API interna
  try {
    const crrUrl =
      "https://carregados.com.br/api/stations?lat=" +
      lat +
      "&lng=" +
      lng +
      "&radius=50";
    const crrRes = await fetch(crrUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        Accept: "application/json",
        Referer: "https://carregados.com.br/mapa",
      },
    });
    console.log("carregados.com.br API status:", crrRes.status);
    if (crrRes.ok) {
      const crrData = await crrRes.json();
      const stations = Array.isArray(crrData)
        ? crrData
        : crrData.stations || crrData.data || [];
      let added = 0;
      for (const s of stations) {
        const sLat = s.latitude || s.lat;
        const sLng = s.longitude || s.lng;
        if (!sLat || !sLng) continue;
        if (isDuplicate(sLat, sLng)) continue;
        const pw = s.power || s.potencia || 0;
        allResults.push({
          name: s.name || s.title || "Sem nome",
          lat: sLat,
          lng: sLng,
          address: s.address || s.endereco || "",
          source: "carregados.com.br",
          operator: s.operator || s.operador || s.network || "Desconhecido",
          powerKW: pw,
          type: pw >= 40 ? "DC Rápido" : pw > 0 ? "AC Lento" : "Verificar",
          isFastCharge: pw >= 40,
          typeConfidence: pw > 0 ? "confirmed" : "unknown",
          isOperational: true,
          rating: s.rating || 0,
          reviews: s.reviews || 0,
        });
        added++;
      }
      queryStats["carregados.com.br API"] = added;
    }
  } catch (err) {
    console.error("carregados.com.br API erro:", err);
  }

  // FONTE 5: Scrape contagem total do carregados.com.br como referência
  let carregadosTotal: number | null = null;
  try {
    const url =
      "https://carregados.com.br/estacoes?cidade=" +
      encodeURIComponent(city.toLowerCase()) +
      "&estado=" +
      encodeURIComponent(state.toLowerCase());
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    if (res.ok) {
      const html = await res.text();
      const match = html.match(/conta com (\d+) eletropostos/);
      if (match) {
        carregadosTotal = parseInt(match[1]);
        console.log("carregados.com.br total referência:", carregadosTotal);
      }
    }
  } catch (err) {
    console.error("carregados.com.br scrape erro:", err);
  }

  // FONTE 6: OpenChargeMap — dados confirmados de potência/tipo
  let ocmStations: Awaited<ReturnType<typeof fetchChargers>> = [];
  try {
    ocmStations = await fetchChargers(lat, lng, 50);
    // Adicionar estações OCM como concorrentes novos (se não duplicadas)
    let addedFromOcm = 0;
    for (const s of ocmStations) {
      if (!s.lat || !s.lng) continue;
      if (isDuplicate(s.lat, s.lng)) continue;
      allResults.push({
        name: s.name || "Sem nome",
        lat: s.lat,
        lng: s.lng,
        address: s.address || "",
        source: "OpenChargeMap",
        operator: s.operator || "Desconhecido",
        powerKW: s.powerKW || 0,
        type: s.powerKW >= 40 ? "DC Rápido" : s.powerKW > 0 ? "AC Lento" : "Verificar",
        isFastCharge: s.isFastCharge,
        typeConfidence: s.powerKW > 0 ? "confirmed" : "unknown",
        isOperational: s.isOperational,
        rating: 0,
        reviews: 0,
      });
      addedFromOcm++;
    }
    queryStats["OpenChargeMap"] = addedFromOcm;
  } catch (err) {
    console.error("OpenChargeMap erro:", err);
  }

  // ENRIQUECIMENTO: para cada concorrente sem potência, procurar OCM num raio de 100m
  for (const c of allResults) {
    if (c.typeConfidence === "confirmed") continue;
    const match = ocmStations.find((s) => {
      const d = Math.sqrt(
        Math.pow((s.lat - c.lat) * 111000, 2) +
          Math.pow((s.lng - c.lng) * 111000, 2)
      );
      return d < 100 && (s.powerKW || 0) > 0;
    });
    if (match) {
      c.powerKW = match.powerKW;
      c.isFastCharge = match.isFastCharge;
      c.type = match.powerKW >= 40 ? "DC Rápido" : "AC Lento";
      c.typeConfidence = "confirmed";
      if (c.operator === "Verificar" || c.operator === "Desconhecido") {
        c.operator = match.operator || c.operator;
      }
      continue;
    }
    // Fallback: classificar por nome
    const byName = classifyByName(c.name);
    if (byName.estimatedPower > 0) {
      c.powerKW = byName.estimatedPower;
      c.isFastCharge = byName.isFastCharge;
      c.type = byName.type;
      c.typeConfidence = "estimated";
    }
  }

  // LOG detalhado
  console.log("=== DETALHAMENTO POR QUERY ===");
  for (const [key, count] of Object.entries(queryStats)) {
    console.log(`  ${key}: ${count} novos resultados`);
  }
  console.log("=== TOTAL CONCORRENTES ===", allResults.length);
  console.log(
    "Google Places:",
    allResults.filter((r) => r.source === "Google Places").length
  );
  console.log(
    "carregados.com.br:",
    allResults.filter((r) => r.source === "carregados.com.br").length
  );
  if (carregadosTotal !== null) {
    console.log("carregados.com.br total (referência site):", carregadosTotal);
  }

  return { competitors: allResults, carregadosTotal, queryStats };
}

/** Count competitors within a radius (in meters) of a point */
export function countNearby(pointLat: number, pointLng: number, competitors: CompetitorStation[], radiusMeters: number): number {
  return competitors.filter(c => {
    const d = Math.sqrt(Math.pow((c.lat - pointLat) * 111000, 2) + Math.pow((c.lng - pointLng) * 111000 * Math.cos(pointLat * Math.PI / 180), 2));
    return d < radiusMeters;
  }).length;
}

/** Convert CompetitorStation[] to the ChargerStation-compatible format used by scoring */
export function competitorsToChargerFormat(competitors: CompetitorStation[]) {
  return competitors.map((c) => ({
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    address: c.address,
    city: "",
    state: "",
    operator: c.operator,
    powerKW: c.powerKW,
    connectionType: "Não identificado",
    level: 0,
    levelName: c.type,
    isOperational: c.isOperational,
    isFastCharge: c.isFastCharge,
    totalConnections: 0,
    usageCost: "Não informado",
    dateLastVerified: null,
  }));
}

/** Get competitors from cache or fetch fresh + save to cache */
export async function getCachedOrFetch(
  city: string,
  state: string,
  lat: number,
  lng: number,
  supabase: SupabaseClient,
  population?: number
): Promise<CompetitorResult> {
  // Check cache (7-day TTL)
  try {
    const { data: cached } = await supabase
      .from("chargers_cache")
      .select("*")
      .eq("city", city)
      .eq("state", state)
      .gte("fetched_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .limit(1)
      .single();

    if (cached && cached.stations_json) {
      console.log("CACHE HIT:", city, cached.total_stations, "estações");
      const competitors: CompetitorStation[] =
        typeof cached.stations_json === "string"
          ? JSON.parse(cached.stations_json)
          : cached.stations_json;
      return { competitors, carregadosTotal: null, queryStats: { cache: competitors.length } };
    }
  } catch {
    // No cache hit - continue to fetch
  }

  console.log("CACHE MISS:", city, "- buscando no Google Places");
  const result = await fetchAllCompetitors(city, state, lat, lng, population);

  // Save to cache
  try {
    await supabase.from("chargers_cache").upsert(
      {
        city,
        state,
        total_stations: result.competitors.length,
        dc_fast: result.competitors.filter((c) => c.isFastCharge).length,
        stations_json: JSON.stringify(result.competitors),
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "city,state" }
    );
  } catch (err) {
    console.error("Cache save error:", err);
  }

  return result;
}

/** Classify competitors for summary stats (mirrors classifyChargers) */
export function classifyCompetitors(competitors: CompetitorStation[]) {
  const total = competitors.length;
  const dcConfirmed = competitors.filter(
    (c) => c.isFastCharge && c.typeConfidence === "confirmed"
  ).length;
  const dcEstimated = competitors.filter(
    (c) => c.isFastCharge && c.typeConfidence === "estimated"
  ).length;
  const acConfirmed = competitors.filter(
    (c) => !c.isFastCharge && c.typeConfidence === "confirmed"
  ).length;
  const acEstimated = competitors.filter(
    (c) => !c.isFastCharge && c.typeConfidence === "estimated"
  ).length;
  const unknown = competitors.filter((c) => c.typeConfidence === "unknown").length;

  const dc = dcConfirmed + dcEstimated;
  const ac = acConfirmed + acEstimated;
  // Só DC conta como concorrência real para o score
  const realCompetition = dc;

  const operational = competitors.filter((c) => c.isOperational).length;
  const operators = [...new Set(competitors.map((c) => c.operator))];

  return {
    total,
    dc,
    ac,
    dcConfirmed,
    dcEstimated,
    acConfirmed,
    acEstimated,
    unknown,
    realCompetition,
    operational,
    operators,
  };
}
