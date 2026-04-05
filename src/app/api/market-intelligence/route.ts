import Anthropic from "@anthropic-ai/sdk";
import {
  fetchAllCompetitors,
  classifyCompetitors,
} from "@/lib/competitors";
import type { CompetitorStation } from "@/lib/competitors";
import { searchPlaces, deduplicatePlaces } from "@/lib/google-places";
import type { PlaceResult } from "@/lib/google-places";

export const maxDuration = 300;

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

// ---------- IBGE ----------

interface IBGEData {
  population: number | null;
  gdpPerCapita: number | null;
  ibgeId: string | null;
}

async function fetchIBGEData(city: string, state: string): Promise<IBGEData> {
  const result: IBGEData = { population: null, gdpPerCapita: null, ibgeId: null };
  try {
    const searchUrl = `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state}/municipios`;
    const res = await fetch(searchUrl);
    if (!res.ok) return result;
    const municipalities = await res.json();
    const found = municipalities.find(
      (m: { nome: string }) => m.nome.toLowerCase() === city.toLowerCase()
    );
    if (!found) return result;
    result.ibgeId = found.id;

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
    } catch { /* continue */ }

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
    } catch { /* continue */ }
  } catch { /* continue */ }
  return result;
}

// ---------- Fleet estimation ----------

function estimateFleet(population: number): { totalVehicles: number; evs: number } {
  // Brasil: ~1 veículo para cada 4 habitantes (frota ~60M, pop ~215M)
  const totalVehicles = Math.round(population * 0.28);
  // EVs no Brasil: ~0.3% da frota (2024 ABVE data, crescendo rápido)
  const evs = Math.round(totalVehicles * 0.003);
  return { totalVehicles, evs };
}

// ---------- Geocode ----------

async function geocodeCity(city: string, state: string): Promise<{
  lat: number;
  lng: number;
  bounds: { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } } | null;
}> {
  if (!GOOGLE_MAPS_API_KEY) return { lat: -15.78, lng: -47.93, bounds: null };
  try {
    const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      `${city}, ${state}, Brasil`
    )}&key=${GOOGLE_MAPS_API_KEY}&language=pt-BR&region=br`;
    const geoRes = await fetch(geoUrl);
    if (geoRes.ok) {
      const geoData = await geoRes.json();
      if (geoData.status === "OK" && geoData.results?.length) {
        const loc = geoData.results[0].geometry.location;
        const vp = geoData.results[0].geometry.viewport;
        return {
          lat: loc.lat,
          lng: loc.lng,
          bounds: vp ? {
            ne: { lat: vp.northeast.lat, lng: vp.northeast.lng },
            sw: { lat: vp.southwest.lat, lng: vp.southwest.lng },
          } : null,
        };
      }
    }
  } catch { /* fallback */ }
  return { lat: -15.78, lng: -47.93, bounds: null };
}

// ---------- POI search by category ----------

interface POICategory {
  key: string;
  label: string;
  queries: string[];
  color: string;
  radius: number; // influence radius in meters
}

const POI_CATEGORIES: POICategory[] = [
  { key: "aeroporto", label: "Aeroporto", queries: ["aeroporto"], color: "#42A5F5", radius: 3000 },
  { key: "rodoviaria", label: "Rodoviária", queries: ["rodoviária", "terminal rodoviário"], color: "#5C6BC0", radius: 2000 },
  { key: "shopping", label: "Shopping", queries: ["shopping center", "shopping mall"], color: "#66BB6A", radius: 1000 },
  { key: "hospital", label: "Hospital 24h", queries: ["hospital 24 horas", "pronto socorro"], color: "#FFC107", radius: 1000 },
  { key: "universidade", label: "Universidade", queries: ["universidade", "faculdade"], color: "#AB47BC", radius: 1000 },
  { key: "logistica", label: "Centro Logístico", queries: ["centro de distribuição", "centro logístico", "galpão logístico"], color: "#FF7043", radius: 2000 },
  { key: "condominio_luxo", label: "Condomínio de Luxo", queries: ["condomínio de luxo", "condomínio fechado alto padrão"], color: "#E91E63", radius: 500 },
  { key: "concessionaria_premium", label: "Concessionária Premium", queries: ["concessionária BMW", "concessionária Audi", "concessionária Mercedes", "concessionária Volvo", "concessionária BYD"], color: "#9C27B0", radius: 500 },
  { key: "escola_particular", label: "Escola Particular", queries: ["escola particular", "colégio particular"], color: "#78909C", radius: 500 },
  { key: "clube", label: "Clube", queries: ["clube recreativo", "country club"], color: "#26A69A", radius: 500 },
];

async function fetchPOIsByCategory(city: string, state: string): Promise<Record<string, PlaceResult[]>> {
  const results: Record<string, PlaceResult[]> = {};
  for (const cat of POI_CATEGORIES) {
    const queryResults: PlaceResult[][] = [];
    for (const q of cat.queries) {
      const places = await searchPlaces(q, city, state, 20);
      queryResults.push(places);
    }
    results[cat.key] = deduplicatePlaces(queryResults);
  }
  return results;
}

// ---------- Fetch corridors (main roads) ----------

async function fetchCorridors(city: string, state: string): Promise<PlaceResult[]> {
  const queries = [
    "posto de gasolina rodovia",
    "posto 24 horas rodovia",
    "shopping avenida principal",
    "restaurante rodovia",
  ];
  const allResults: PlaceResult[][] = [];
  for (const q of queries) {
    const places = await searchPlaces(q, city, state, 10);
    allResults.push(places);
  }
  return deduplicatePlaces(allResults);
}

// ---------- Coverage gaps calculation ----------

interface GridCell {
  row: number;
  col: number;
  centerLat: number;
  centerLng: number;
  chargerCount: number;
  status: "opportunity" | "moderate" | "saturated";
  nearbyPremiumPOIs: string[];
}

function calculateCoverageGaps(
  bounds: { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } },
  competitors: CompetitorStation[],
  premiumPOIs: PlaceResult[]
): GridCell[] {
  const cells: GridCell[] = [];
  // ~1km grid cells
  const latStep = 0.009; // ~1km
  const lngStep = 0.012; // ~1km at typical BR latitudes

  const minLat = bounds.sw.lat;
  const maxLat = bounds.ne.lat;
  const minLng = bounds.sw.lng;
  const maxLng = bounds.ne.lng;

  let row = 0;
  for (let lat = minLat; lat < maxLat; lat += latStep) {
    let col = 0;
    for (let lng = minLng; lng < maxLng; lng += lngStep) {
      const centerLat = lat + latStep / 2;
      const centerLng = lng + lngStep / 2;

      // Count chargers in this cell
      const chargerCount = competitors.filter((c) => {
        return (
          c.lat >= lat &&
          c.lat < lat + latStep &&
          c.lng >= lng &&
          c.lng < lng + lngStep
        );
      }).length;

      // Check nearby premium POIs (within ~500m of cell center)
      const nearbyPremium = premiumPOIs.filter((p) => {
        const dlat = Math.abs(p.lat - centerLat) * 111000;
        const dlng = Math.abs(p.lng - centerLng) * 111000 * Math.cos(centerLat * Math.PI / 180);
        return Math.sqrt(dlat * dlat + dlng * dlng) < 500;
      });

      const status: GridCell["status"] =
        chargerCount === 0 ? "opportunity" : chargerCount <= 2 ? "moderate" : "saturated";

      cells.push({
        row,
        col,
        centerLat,
        centerLng,
        chargerCount,
        status,
        nearbyPremiumPOIs: nearbyPremium.map((p) => p.name),
      });
      col++;
    }
    row++;
  }
  return cells;
}

// ---------- Demand projections ----------

interface ProjectionYear {
  year: number;
  evs: number;
  chargersNeeded: number;
  chargersExisting: number;
  gap: number;
}

function calculateProjections(currentEVs: number, currentChargers: number): ProjectionYear[] {
  const projections: ProjectionYear[] = [];
  const growthRate = 0.50; // 50% ao ano (ABVE)
  const ratio = 50; // 1 carregador DC para cada 50 EVs

  for (let year = 2024; year <= 2030; year++) {
    const yearsFromNow = year - 2024;
    const evs = Math.round(currentEVs * Math.pow(1 + growthRate, yearsFromNow));
    const chargersNeeded = Math.ceil(evs / ratio);
    // Assume chargers grow ~20% ao ano (infraestrutura mais lenta)
    const chargersExisting = Math.round(currentChargers * Math.pow(1.20, yearsFromNow));
    projections.push({
      year,
      evs,
      chargersNeeded,
      chargersExisting,
      gap: Math.max(0, chargersNeeded - chargersExisting),
    });
  }
  return projections;
}

// ---------- City score ----------

function calculateCityScore(
  population: number,
  gdpPerCapita: number | null,
  evs: number,
  currentChargers: number,
  opportunityCells: number,
  totalCells: number,
  premiumZones: number
): number {
  let score = 0;

  // Population (0-20)
  if (population > 1000000) score += 20;
  else if (population > 500000) score += 16;
  else if (population > 200000) score += 12;
  else if (population > 100000) score += 8;
  else score += 4;

  // GDP per capita (0-20)
  const gdp = gdpPerCapita || 30000;
  if (gdp > 60000) score += 20;
  else if (gdp > 45000) score += 16;
  else if (gdp > 30000) score += 12;
  else if (gdp > 20000) score += 8;
  else score += 4;

  // EV/Charger ratio - lower means more opportunity (0-20)
  const ratio = currentChargers > 0 ? evs / currentChargers : 999;
  if (ratio > 100) score += 20;
  else if (ratio > 70) score += 16;
  else if (ratio > 50) score += 12;
  else if (ratio > 30) score += 8;
  else score += 4;

  // Coverage gaps (0-20)
  const gapPercentage = totalCells > 0 ? opportunityCells / totalCells : 0;
  if (gapPercentage > 0.7) score += 20;
  else if (gapPercentage > 0.5) score += 16;
  else if (gapPercentage > 0.3) score += 12;
  else if (gapPercentage > 0.15) score += 8;
  else score += 4;

  // Premium zones without chargers (0-20)
  if (premiumZones > 10) score += 20;
  else if (premiumZones > 6) score += 16;
  else if (premiumZones > 3) score += 12;
  else if (premiumZones > 1) score += 8;
  else score += 4;

  return Math.min(100, score);
}

// ---------- Socioeconomic classification ----------

interface SocioZone {
  lat: number;
  lng: number;
  name: string;
  classification: "Premium" | "Alta" | "Média" | "Popular";
  indicators: string[];
  hasCharger: boolean;
}

function classifySocioZones(
  pois: Record<string, PlaceResult[]>,
  competitors: CompetitorStation[],
  bounds: { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } }
): SocioZone[] {
  const zones: SocioZone[] = [];
  const premiumIndicators = [
    ...(pois.condominio_luxo || []).map((p) => ({ ...p, type: "Condomínio de Luxo" })),
    ...(pois.concessionaria_premium || []).map((p) => ({ ...p, type: "Concessionária Premium" })),
    ...(pois.clube || []).map((p) => ({ ...p, type: "Clube" })),
    ...(pois.escola_particular || []).map((p) => ({ ...p, type: "Escola Particular" })),
  ];

  // Group by ~1km zones
  const latStep = 0.009;
  const lngStep = 0.012;

  for (let lat = bounds.sw.lat; lat < bounds.ne.lat; lat += latStep) {
    for (let lng = bounds.sw.lng; lng < bounds.ne.lng; lng += lngStep) {
      const centerLat = lat + latStep / 2;
      const centerLng = lng + lngStep / 2;

      const nearbyIndicators = premiumIndicators.filter((p) => {
        const dlat = Math.abs(p.lat - centerLat) * 111000;
        const dlng = Math.abs(p.lng - centerLng) * 111000 * Math.cos(centerLat * Math.PI / 180);
        return Math.sqrt(dlat * dlat + dlng * dlng) < 800;
      });

      if (nearbyIndicators.length === 0) continue;

      const hasCharger = competitors.some((c) => {
        const dlat = Math.abs(c.lat - centerLat) * 111000;
        const dlng = Math.abs(c.lng - centerLng) * 111000 * Math.cos(centerLat * Math.PI / 180);
        return Math.sqrt(dlat * dlat + dlng * dlng) < 1000;
      });

      let classification: SocioZone["classification"];
      if (nearbyIndicators.length >= 4) classification = "Premium";
      else if (nearbyIndicators.length >= 2) classification = "Alta";
      else classification = "Média";

      zones.push({
        lat: centerLat,
        lng: centerLng,
        name: nearbyIndicators[0].name,
        classification,
        indicators: nearbyIndicators.map((i) => `${i.type}: ${i.name}`),
        hasCharger,
      });
    }
  }
  return zones;
}

// ---------- Executive report via Claude ----------

async function generateExecutiveReport(
  city: string,
  state: string,
  data: {
    population: number;
    gdpPerCapita: number | null;
    evs: number;
    totalChargers: number;
    ratio: string;
    marketPhase: string;
    opportunityCells: number;
    totalCells: number;
    premiumZonesWithoutCharger: number;
    topDemandZones: string[];
    projections: ProjectionYear[];
    cityScore: number;
  }
): Promise<string> {
  try {
    const anthropic = new Anthropic();
    const prompt = `Você é um analista de mercado de eletromobilidade no Brasil. Gere um relatório executivo sobre o mercado de carregadores de veículos elétricos em ${city}/${state}.

DADOS REAIS:
- População: ${data.population.toLocaleString("pt-BR")}
- PIB per capita: R$ ${(data.gdpPerCapita || 30000).toLocaleString("pt-BR")}
- EVs estimados: ${data.evs.toLocaleString("pt-BR")}
- Carregadores existentes: ${data.totalChargers}
- Ratio EVs/carregador: ${data.ratio}
- Fase do mercado: ${data.marketPhase}
- Células sem cobertura: ${data.opportunityCells} de ${data.totalCells} (${data.totalCells > 0 ? Math.round(data.opportunityCells / data.totalCells * 100) : 0}%)
- Bairros premium sem carregador: ${data.premiumZonesWithoutCharger}
- Zonas de alta demanda: ${data.topDemandZones.join(", ") || "Não identificadas"}
- Projeção 2028: ${data.projections.find(p => p.year === 2028)?.evs.toLocaleString("pt-BR")} EVs, gap de ${data.projections.find(p => p.year === 2028)?.gap} carregadores
- Score da cidade: ${data.cityScore}/100

Escreva EM PORTUGUÊS um relatório com exatamente estas seções (use ## para títulos):

## Diagnóstico do Mercado
(2-3 parágrafos sobre a situação atual)

## Top 5 Zonas de Oportunidade
(Liste as 5 melhores zonas/regiões para instalar carregadores, com justificativa)

## Recomendação Estratégica
(Estratégia de entrada no mercado, timing, tipo de carregador)

## Riscos do Mercado Local
(3-4 riscos específicos desta cidade)

Seja direto, use dados reais fornecidos, não invente números.`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    return textBlock && textBlock.type === "text" ? textBlock.text : "Erro ao gerar relatório.";
  } catch (err) {
    console.error("Claude executive report error:", err);
    return "Não foi possível gerar o relatório executivo. Tente novamente.";
  }
}

// ---------- Main handler ----------

export async function POST(request: Request) {
  try {
    const { city, state } = await request.json();
    if (!city || !state) {
      return Response.json({ error: "Cidade e estado são obrigatórios" }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(data: Record<string, unknown>) {
          controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
        }

        // Step 1: Geocode + IBGE
        send({ type: "progress", step: 1, total: 8, label: "Buscando dados da cidade..." });
        const [geoData, ibgeData] = await Promise.all([
          geocodeCity(city, state),
          fetchIBGEData(city, state),
        ]);

        const population = ibgeData.population || 200000;
        const gdpPerCapita = ibgeData.gdpPerCapita;
        const fleet = estimateFleet(population);

        send({
          type: "panel",
          panel: 1,
          label: "Visão Geral da Cidade",
          data: {
            city,
            state,
            lat: geoData.lat,
            lng: geoData.lng,
            bounds: geoData.bounds,
            population,
            gdpPerCapita: gdpPerCapita || 30000,
            totalVehicles: fleet.totalVehicles,
            evs: fleet.evs,
            chargersExisting: 0, // updated after step 2
            ratio: "Calculando...",
            marketPhase: "Calculando...",
          },
        });

        // Step 2: Competitors
        send({ type: "progress", step: 2, total: 8, label: "Mapeando concorrentes..." });
        let allCompetitors: CompetitorStation[] = [];
        try {
          const result = await fetchAllCompetitors(city, state, geoData.lat, geoData.lng, population);
          allCompetitors = result.competitors;
        } catch (err) {
          console.error("Competitors error:", err);
        }

        const chargerInfo = classifyCompetitors(allCompetitors);
        const evChargerRatio = chargerInfo.total > 0
          ? (fleet.evs / chargerInfo.total).toFixed(1)
          : "∞ (sem carregadores)";
        const marketPhase = chargerInfo.total === 0
          ? "Início"
          : fleet.evs / chargerInfo.total > 70
            ? "Início"
            : fleet.evs / chargerInfo.total > 30
              ? "Crescimento"
              : "Maduro";

        // Update panel 1 with charger data
        send({
          type: "panel",
          panel: 1,
          label: "Visão Geral da Cidade",
          data: {
            city, state,
            lat: geoData.lat, lng: geoData.lng,
            bounds: geoData.bounds,
            population,
            gdpPerCapita: gdpPerCapita || 30000,
            totalVehicles: fleet.totalVehicles,
            evs: fleet.evs,
            chargersExisting: chargerInfo.total,
            ratio: evChargerRatio,
            marketPhase,
          },
        });

        send({
          type: "panel",
          panel: 2,
          label: "Mapa de Concorrentes",
          data: {
            competitors: allCompetitors,
            total: chargerInfo.total,
            dc: chargerInfo.dc,
            ac: chargerInfo.ac,
            operators: chargerInfo.operators,
          },
        });

        // Step 3: Coverage gaps
        send({ type: "progress", step: 3, total: 8, label: "Calculando gaps de cobertura..." });
        let coverageGrid: GridCell[] = [];
        if (geoData.bounds) {
          coverageGrid = calculateCoverageGaps(geoData.bounds, allCompetitors, []);
        }
        const opportunityCells = coverageGrid.filter((c) => c.status === "opportunity").length;

        send({
          type: "panel",
          panel: 3,
          label: "Gaps de Cobertura",
          data: {
            grid: coverageGrid,
            totalCells: coverageGrid.length,
            opportunityCells,
            moderateCells: coverageGrid.filter((c) => c.status === "moderate").length,
            saturatedCells: coverageGrid.filter((c) => c.status === "saturated").length,
          },
        });

        // Step 4: POIs + Corridors
        send({ type: "progress", step: 4, total: 8, label: "Buscando pontos de interesse..." });
        const [pois, corridors] = await Promise.all([
          fetchPOIsByCategory(city, state),
          fetchCorridors(city, state),
        ]);

        send({
          type: "panel",
          panel: 4,
          label: "Corredores de Tráfego",
          data: {
            corridors,
            totalCorridorPOIs: corridors.length,
          },
        });

        // Step 5: Demand zones
        send({ type: "progress", step: 5, total: 8, label: "Mapeando zonas de demanda..." });
        const demandZones: { category: string; label: string; color: string; radius: number; places: PlaceResult[] }[] = [];
        for (const cat of POI_CATEGORIES.filter((c) => ["aeroporto", "rodoviaria", "shopping", "hospital", "universidade", "logistica"].includes(c.key))) {
          demandZones.push({
            category: cat.key,
            label: cat.label,
            color: cat.color,
            radius: cat.radius,
            places: pois[cat.key] || [],
          });
        }

        send({
          type: "panel",
          panel: 5,
          label: "Zonas de Demanda",
          data: { demandZones },
        });

        // Step 6: Socioeconomic
        send({ type: "progress", step: 6, total: 8, label: "Analisando perfil socioeconômico..." });
        let socioZones: SocioZone[] = [];
        if (geoData.bounds) {
          socioZones = classifySocioZones(pois, allCompetitors, geoData.bounds);
        }
        const premiumWithoutCharger = socioZones.filter((z) => (z.classification === "Premium" || z.classification === "Alta") && !z.hasCharger).length;

        send({
          type: "panel",
          panel: 6,
          label: "Perfil Socioeconômico",
          data: {
            zones: socioZones,
            premiumCount: socioZones.filter((z) => z.classification === "Premium").length,
            altaCount: socioZones.filter((z) => z.classification === "Alta").length,
            mediaCount: socioZones.filter((z) => z.classification === "Média").length,
            premiumWithoutCharger,
          },
        });

        // Step 7: Projections
        send({ type: "progress", step: 7, total: 8, label: "Calculando projeções..." });
        const projections = calculateProjections(fleet.evs, chargerInfo.total);

        send({
          type: "panel",
          panel: 7,
          label: "Projeção de Demanda",
          data: {
            projections,
            currentEVs: fleet.evs,
            currentChargers: chargerInfo.total,
          },
        });

        // Step 8: Executive report
        send({ type: "progress", step: 8, total: 8, label: "Gerando relatório executivo..." });
        const topDemandZones = demandZones
          .filter((d) => d.places.length > 0)
          .map((d) => `${d.label} (${d.places.length} locais)`);

        const cityScore = calculateCityScore(
          population,
          gdpPerCapita,
          fleet.evs,
          chargerInfo.total,
          opportunityCells,
          coverageGrid.length,
          premiumWithoutCharger
        );

        const report = await generateExecutiveReport(city, state, {
          population,
          gdpPerCapita,
          evs: fleet.evs,
          totalChargers: chargerInfo.total,
          ratio: evChargerRatio,
          marketPhase,
          opportunityCells,
          totalCells: coverageGrid.length,
          premiumZonesWithoutCharger: premiumWithoutCharger,
          topDemandZones,
          projections,
          cityScore,
        });

        send({
          type: "panel",
          panel: 8,
          label: "Relatório Executivo",
          data: {
            report,
            cityScore,
            marketPhase,
          },
        });

        // Final
        send({ type: "complete" });
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
    console.error("market-intelligence error:", errorMessage);
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
