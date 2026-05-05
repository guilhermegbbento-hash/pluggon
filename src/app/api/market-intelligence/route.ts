import Anthropic from "@anthropic-ai/sdk";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  getCachedOrFetch,
  classifyCompetitors,
} from "@/lib/competitors";
import type { CompetitorStation } from "@/lib/competitors";
import { searchPlaces, deduplicatePlaces } from "@/lib/google-places";
import type { PlaceResult } from "@/lib/google-places";
import { ABVE_DATA, estimateEVs } from "@/lib/abve-data";
import {
  getABVEData,
  getCityEVDataAsync,
  upsertCityEVCache,
  ABVE_NATIONAL,
  type ManualCityEVInput,
} from "@/lib/abve-real-data";
import { logUsage } from "@/lib/usage-logger";

const STATE_NAMES: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia",
  CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás",
  MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais",
  PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí",
  RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul",
  RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo",
  SE: "Sergipe", TO: "Tocantins",
};

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

function estimateFleet(
  city: string,
  state: string,
  population: number,
  gdpPerCapita: number
): { totalVehicles: number; evs: number; vendasAno: number; fonteEVs: string; isEstimate: boolean } {
  // Brasil: ~1 veículo para cada 4 habitantes (frota ~60M, pop ~215M)
  const totalVehicles = Math.round(population * 0.28);
  // EVs: dados diretos ABVE quando disponíveis; senão estima por PIB/população
  const ev = estimateEVs(city, state, population, gdpPerCapita);
  return {
    totalVehicles,
    evs: ev.acumulados,
    vendasAno: ev.vendasAno,
    fonteEVs: ev.fonte,
    isEstimate: ev.isEstimate,
  };
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
  const growthRate = ABVE_DATA.taxaCrescimentoAnual; // 26% ao ano (real ABVE 2025)
  const ratio = ABVE_DATA.ratioIdealEVsPorCarregador; // 10 EVs por carregador (padrão IEA/AFIR)
  const anoInicio = 2026;
  const anoFim = 2031;

  for (let year = anoInicio; year <= anoFim; year++) {
    const yearsFromNow = year - anoInicio;
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
  // Cada subscore é 0-100. Mesmo input = mesmo output.

  // População (0-100)
  let popScore: number;
  if (population > 1000000) popScore = 100;
  else if (population > 500000) popScore = 80;
  else if (population > 200000) popScore = 60;
  else if (population > 100000) popScore = 40;
  else popScore = 20;

  // PIB per capita (0-100)
  const gdp = gdpPerCapita || 30000;
  let gdpScore: number;
  if (gdp > 60000) gdpScore = 100;
  else if (gdp > 45000) gdpScore = 80;
  else if (gdp > 30000) gdpScore = 60;
  else if (gdp > 20000) gdpScore = 40;
  else gdpScore = 20;

  // Ratio EV/Carregador — mais alto = mais oportunidade (0-100)
  const ratio = currentChargers > 0 ? evs / currentChargers : 999;
  let evRatioScore: number;
  if (ratio > 100) evRatioScore = 100;
  else if (ratio > 70) evRatioScore = 80;
  else if (ratio > 50) evRatioScore = 60;
  else if (ratio > 30) evRatioScore = 40;
  else evRatioScore = 20;

  // Gaps de cobertura (0-100)
  const gapPercentage = totalCells > 0 ? opportunityCells / totalCells : 0;
  let gapScore: number;
  if (gapPercentage > 0.7) gapScore = 100;
  else if (gapPercentage > 0.5) gapScore = 80;
  else if (gapPercentage > 0.3) gapScore = 60;
  else if (gapPercentage > 0.15) gapScore = 40;
  else gapScore = 20;

  // Zonas premium sem carregador (0-100)
  let premiumScore: number;
  if (premiumZones > 10) premiumScore = 100;
  else if (premiumZones > 6) premiumScore = 80;
  else if (premiumZones > 3) premiumScore = 60;
  else if (premiumZones > 1) premiumScore = 40;
  else premiumScore = 20;

  // Pesos: pop 15, gdp 20, ev ratio 25, gap 25, premium 15 (total 100)
  const cityScore =
    Math.round(
      popScore * 15 + gdpScore * 20 + evRatioScore * 25 + gapScore * 25 + premiumScore * 15
    ) / 100;
  return Math.min(100, cityScore);
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
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  try {
    const anthropic = new Anthropic();
    const prompt = `Você é um analista de mercado de eletromobilidade no Brasil. Gere um relatório executivo sobre o mercado de carregadores de veículos elétricos em ${city}/${state}.

DADOS REAIS:
- População: ${data.population.toLocaleString("pt-BR")}
- PIB per capita: R$ ${(data.gdpPerCapita || 30000).toLocaleString("pt-BR")}
- Veículos plug-in (BEV+PHEV — os que CARREGAM): ${data.evs.toLocaleString("pt-BR")}
- Carregadores existentes: ${data.totalChargers}
- Ratio plug-in/carregador: ${data.ratio}
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
    const text = textBlock && textBlock.type === "text" ? textBlock.text : "Erro ao gerar relatório.";
    return {
      text,
      tokensIn: message.usage?.input_tokens || 0,
      tokensOut: message.usage?.output_tokens || 0,
    };
  } catch (err) {
    console.error("Claude executive report error:", err);
    return { text: "Não foi possível gerar o relatório executivo. Tente novamente.", tokensIn: 0, tokensOut: 0 };
  }
}

// ---------- Main handler ----------

export async function POST(request: Request) {
  try {
    const reqBody = await request.json();
    const { city, state } = reqBody as { city?: string; state?: string };
    const manualData: ManualCityEVInput | null =
      (reqBody as { manualData?: ManualCityEVInput }).manualData ?? null;
    if (!city || !state) {
      return Response.json({ error: "Cidade e estado são obrigatórios" }, { status: 400 });
    }

    const supabase = await createSupabaseClient();
    if (manualData) {
      let userEmail: string | null = null;
      try {
        const { data: { user } } = await supabase.auth.getUser();
        userEmail = user?.email ?? null;
      } catch {}
      await upsertCityEVCache(supabase as never, city, state, manualData, userEmail);
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
        const fleet = estimateFleet(city, state, population, gdpPerCapita || 30000);
        const evData = await getCityEVDataAsync(
          city,
          state,
          population,
          gdpPerCapita || 30000,
          manualData,
          supabase as never
        );
        const stateAbbrForAbve = state.replace(/\s*\(.*\)/, '').trim().substring(0, 2).toUpperCase();
        const vendasEstado2025 =
          ABVE_DATA.topEstados[stateAbbrForAbve as keyof typeof ABVE_DATA.topEstados] || null;

        console.log("=== EV DATA ===", city, state);
        console.log("Total EVs:", evData.totalEVs, "| BEV:", evData.bev, "| PHEV:", evData.phev);
        console.log("BEV+PHEV (carregam):", evData.bevPlusPHEV, "| DC:", evData.dcChargers, "| Ratio:", evData.ratioEVperDC);
        console.log("Fonte:", evData.source);
        console.log("ABVE Nacional:", ABVE_NATIONAL.totalBEVPHEV, "veículos plug-in (BEV+PHEV)");

        // ABVE — carregadores reais por cidade (fev/2026)
        // Prioridade efetiva (manual > cache > ABVE) já é resolvida em evData.
        const abveCity = getABVEData(city, state);
        const abveDc = evData.dcChargers > 0 ? evData.dcChargers : (abveCity?.dc ?? 0);
        const abveAc = evData.acChargers > 0 ? evData.acChargers : (abveCity?.ac ?? 0);
        const abveTotalChargers = evData.totalChargers > 0 ? evData.totalChargers : (abveCity?.total ?? 0);
        const abveSource = evData.chargersSource;
        console.log("=== ABVE DATA ===", city, state, abveCity);
        console.log("EVs:", evData.bevPlusPHEV, "DC:", abveDc, "Fonte EVs:", evData.source, "| Fonte chargers:", abveSource);

        // Scrape carregados.com.br para obter número total registrado
        let totalCarregadosComBr: number | null = null;
        try {
          const stateAbbr = state;
          const stateFull = STATE_NAMES[state.toUpperCase()] || state;
          const crrUrl =
            'https://carregados.com.br/estacoes?cidade=' +
            encodeURIComponent(city.toLowerCase()) +
            '&estado=' +
            encodeURIComponent(stateFull.toLowerCase() + ' (' + stateAbbr.toLowerCase() + ')');
          const crrRes = await fetch(crrUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });
          if (crrRes.ok) {
            const html = await crrRes.text();
            const match = html.match(/conta com (\d+) eletropostos/);
            if (match) {
              totalCarregadosComBr = parseInt(match[1]);
              console.log('carregados.com.br total:', totalCarregadosComBr);
            }
          }
        } catch (err) {
          console.error('carregados scrape erro:', err);
        }

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
            totalEVs: evData.totalEVs,
            bev: evData.bev,
            phev: evData.phev,
            bevPlusPHEV: evData.bevPlusPHEV,
            evsSource: evData.source,
            vendasAno: fleet.vendasAno,
            fonteEVs: fleet.fonteEVs,
            isEstimateEVs: fleet.isEstimate,
            vendasEstado2025,
            stateAbbr: stateAbbrForAbve,
            abveNacional: {
              vendas2025: ABVE_DATA.vendas2025,
              crescimento2025pct: ABVE_DATA.crescimento2025pct,
              marketShareFev2026pct: ABVE_DATA.marketShareFev2026pct,
              projecaoABVE2026: ABVE_DATA.projecaoABVE2026,
              projecaoMercado2026: ABVE_DATA.projecaoMercado2026,
              lastUpdate: ABVE_DATA.lastUpdate,
              fonte: ABVE_DATA.fonte,
              totalBEVPHEV: ABVE_NATIONAL.totalBEVPHEV,
            },
            chargersExisting: 0, // updated after step 2
            totalCarregadosComBr,
            abveCity: {
              dc: abveDc,
              ac: abveAc,
              total: abveTotalChargers,
              evsSold: abveCity?.evsSold ?? 0,
              source: abveSource,
              evsSourceTag: evData.evsSourceTag,
              chargersSourceTag: evData.chargersSourceTag,
              cacheUpdatedAt: evData.cacheUpdatedAt,
            },
            ratio: "Calculando...",
            marketPhase: "Calculando...",
            cityScore: null,
          },
        });

        // Step 2: Competitors (with cache)
        send({ type: "progress", step: 2, total: 8, label: "Mapeando concorrentes..." });
        let allCompetitors: CompetitorStation[] = [];
        let competitorGoogleQueries = 0;
        try {
          const result = await getCachedOrFetch(city, state, geoData.lat, geoData.lng, supabase, population);
          allCompetitors = result.competitors;
          competitorGoogleQueries = result.queryStats.cache ? 0 : 5;
        } catch (err) {
          console.error("Competitors error:", err);
        }

        const chargerInfo = classifyCompetitors(allCompetitors);
        // Quantidade oficial = ABVE; Google só preenche cidades fora da base.
        const dcForMath = abveDc > 0 ? abveDc : chargerInfo.realCompetition;
        const totalForMath = abveTotalChargers > 0 ? abveTotalChargers : chargerInfo.total;
        // Ratio e fase do mercado baseados em BEV+PHEV (HEV não carrega na tomada).
        const plugInForMath = evData.bevPlusPHEV;
        const evChargerRatio = dcForMath > 0
          ? (plugInForMath / dcForMath).toFixed(1)
          : "∞ (sem DC)";
        const marketPhase = dcForMath === 0
          ? "Início"
          : plugInForMath / dcForMath > 70
            ? "Início"
            : plugInForMath / dcForMath > 30
              ? "Crescimento"
              : "Maduro";

        console.log("=== CARREGADORES ===");
        console.log(
          "ABVE:",
          abveDc,
          "DC,",
          abveAc,
          "AC,",
          abveTotalChargers,
          "total"
        );
        console.log(
          "Google/Banco:",
          chargerInfo.dc,
          "DC classificados,",
          chargerInfo.total,
          "total localizados"
        );
        console.log("Usando ABVE pra contagem, Google pra localização");
        if (!abveCity) {
          console.log(
            "Cidade não encontrada na ABVE - usando apenas Google Places"
          );
        }

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
            totalEVs: evData.totalEVs,
            bev: evData.bev,
            phev: evData.phev,
            bevPlusPHEV: evData.bevPlusPHEV,
            evsSource: evData.source,
            vendasAno: fleet.vendasAno,
            fonteEVs: fleet.fonteEVs,
            isEstimateEVs: fleet.isEstimate,
            vendasEstado2025,
            stateAbbr: stateAbbrForAbve,
            abveNacional: {
              vendas2025: ABVE_DATA.vendas2025,
              crescimento2025pct: ABVE_DATA.crescimento2025pct,
              marketShareFev2026pct: ABVE_DATA.marketShareFev2026pct,
              projecaoABVE2026: ABVE_DATA.projecaoABVE2026,
              projecaoMercado2026: ABVE_DATA.projecaoMercado2026,
              lastUpdate: ABVE_DATA.lastUpdate,
              fonte: ABVE_DATA.fonte,
              totalBEVPHEV: ABVE_NATIONAL.totalBEVPHEV,
            },
            chargersExisting: chargerInfo.total,
            totalCarregadosComBr,
            abveCity: {
              dc: abveDc,
              ac: abveAc,
              total: abveTotalChargers,
              evsSold: abveCity?.evsSold ?? 0,
              source: abveSource,
              evsSourceTag: evData.evsSourceTag,
              chargersSourceTag: evData.chargersSourceTag,
              cacheUpdatedAt: evData.cacheUpdatedAt,
            },
            ratio: evChargerRatio,
            marketPhase,
            cityScore: null,
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
            dcConfirmed: chargerInfo.dcConfirmed,
            dcEstimated: chargerInfo.dcEstimated,
            acConfirmed: chargerInfo.acConfirmed,
            acEstimated: chargerInfo.acEstimated,
            unknown: chargerInfo.unknown,
            realCompetition: chargerInfo.realCompetition,
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

        // Step 7: Projections — base oficial = ABVE total da cidade.
        // Projeção sobre BEV+PHEV (mercado real de eletropostos), 26% a.a.
        send({ type: "progress", step: 7, total: 8, label: "Calculando projeções..." });
        const projections = calculateProjections(plugInForMath, totalForMath);

        send({
          type: "panel",
          panel: 7,
          label: "Projeção de Demanda",
          data: {
            projections,
            currentEVs: plugInForMath,
            currentChargers: totalForMath,
            evsSource: evData.source,
            note: "Projeção sobre BEV+PHEV — veículos que CARREGAM, mercado real de eletropostos.",
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
          plugInForMath,
          dcForMath,
          opportunityCells,
          coverageGrid.length,
          premiumWithoutCharger
        );

        // Re-emit Panel 1 with final cityScore (silent — don't switch tabs)
        send({
          type: "panel-update",
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
            totalEVs: evData.totalEVs,
            bev: evData.bev,
            phev: evData.phev,
            bevPlusPHEV: evData.bevPlusPHEV,
            evsSource: evData.source,
            vendasAno: fleet.vendasAno,
            fonteEVs: fleet.fonteEVs,
            isEstimateEVs: fleet.isEstimate,
            vendasEstado2025,
            stateAbbr: stateAbbrForAbve,
            abveNacional: {
              vendas2025: ABVE_DATA.vendas2025,
              crescimento2025pct: ABVE_DATA.crescimento2025pct,
              marketShareFev2026pct: ABVE_DATA.marketShareFev2026pct,
              projecaoABVE2026: ABVE_DATA.projecaoABVE2026,
              projecaoMercado2026: ABVE_DATA.projecaoMercado2026,
              lastUpdate: ABVE_DATA.lastUpdate,
              fonte: ABVE_DATA.fonte,
              totalBEVPHEV: ABVE_NATIONAL.totalBEVPHEV,
            },
            chargersExisting: chargerInfo.total,
            totalCarregadosComBr,
            abveCity: {
              dc: abveDc,
              ac: abveAc,
              total: abveTotalChargers,
              evsSold: abveCity?.evsSold ?? 0,
              source: abveSource,
              evsSourceTag: evData.evsSourceTag,
              chargersSourceTag: evData.chargersSourceTag,
              cacheUpdatedAt: evData.cacheUpdatedAt,
            },
            ratio: evChargerRatio,
            marketPhase,
            cityScore,
          },
        });

        const reportResult = await generateExecutiveReport(city, state, {
          population,
          gdpPerCapita,
          evs: plugInForMath,
          totalChargers: totalForMath,
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
            report: reportResult.text,
            cityScore,
            marketPhase,
          },
        });

        // Count Google Places queries: POI categories (10 cats * ~2 queries avg) + corridors (4) + competitor queries
        const poiGoogleQueries = POI_CATEGORIES.reduce((sum, cat) => sum + cat.queries.length, 0) + 4;
        await logUsage({
          module: "market",
          city: `${city}/${state}`,
          claudeTokensIn: reportResult.tokensIn,
          claudeTokensOut: reportResult.tokensOut,
          googlePlacesQueries: competitorGoogleQueries + poiGoogleQueries,
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
