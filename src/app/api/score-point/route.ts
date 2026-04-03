import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

const anthropic = new Anthropic();
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

// ---------- Geocode address ----------

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
      if (comp.types.includes("administrative_area_level_2")) city = comp.long_name;
      if (comp.types.includes("administrative_area_level_1")) state = comp.short_name;
    }

    return { lat: loc.lat, lng: loc.lng, city, state };
  } catch {
    return null;
  }
}

// ---------- Search nearby places (Google Places New API) ----------

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
      .map(
        (p: {
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
        }
      )
      .filter((p: NearbyPlace) => p.distance_m <= radiusM);
  } catch {
    return [];
  }
}

// ---------- Fetch IBGE city data ----------

interface IBGEData {
  population: number | null;
  gdp_total: number | null;
  gdp_per_capita: number | null;
  idhm: number | null;
  fleet_total: number | null;
}

async function fetchIBGEData(city: string, state: string): Promise<IBGEData> {
  const result: IBGEData = {
    population: null,
    gdp_total: null,
    gdp_per_capita: null,
    idhm: null,
    fleet_total: null,
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

    // Population
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

    // PIB total (variável 37 retorna PIB em R$ 1.000)
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
            result.gdp_total = pibEmMil * 1000; // Converter de R$ 1.000 para R$
            // Calcular PIB per capita = PIB total / população
            if (result.population && result.population > 0) {
              result.gdp_per_capita = Math.round(result.gdp_total / result.population);
            }
          }
        }
      }
    } catch {
      // continue
    }

    // IDHM
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

// ---------- Build Claude system prompt ----------

function buildSystemPrompt(): string {
  return `Você é a PLUGGON, plataforma líder em inteligência para eletromobilidade no Brasil. Analise este ponto para instalação de eletroposto DC rápido (150kW+).

Analise as 80 variáveis abaixo organizadas em 8 categorias. Dê nota 0-10 em CADA variável com justificativa curta. O peso de cada variável está indicado: Alto(x3), Médio(x2), Baixo(x1). Score final ponderado 0-100.

CATEGORIAS E VARIÁVEIS (80 total):

1. DEMANDA E MOBILIDADE (15 variáveis):
   - volume_veiculos_dia: Volume estimado de veículos/dia na via [Alto]
   - fluxo_motoristas_app: Fluxo de motoristas de app (Uber/99) na região [Médio]
   - proximidade_corredores: Proximidade a corredores viários principais [Alto]
   - fluxo_pico_manha: Intensidade do fluxo no pico da manhã (7-9h) [Médio]
   - fluxo_pico_noite: Intensidade do fluxo no pico da noite (17-20h) [Médio]
   - fluxo_noturno: Fluxo de veículos no período noturno (22-6h) [Baixo]
   - fluxo_fim_semana: Fluxo de veículos nos fins de semana [Médio]
   - padrao_trafego: Padrão de tráfego (passagem vs destino) [Médio]
   - proximidade_rodovias: Distância a rodovias estaduais/federais [Alto]
   - distancia_centro: Distância ao centro da cidade [Médio]
   - pontos_taxi_uber: Pontos de taxi/Uber concentrados próximos [Baixo]
   - proximidade_terminal_onibus: Proximidade a terminais de ônibus [Baixo]
   - proximidade_aeroporto: Proximidade a aeroporto [Médio]
   - proximidade_rodoviaria: Proximidade a rodoviária [Médio]
   - veiculos_por_habitante: Razão veículos/habitante na cidade [Baixo]

2. FROTA DE EVs (10 variáveis):
   - total_evs_cidade: Total de veículos elétricos registrados na cidade [Alto]
   - crescimento_frota_12m: Crescimento da frota de EVs nos últimos 12 meses [Alto]
   - evs_por_carregador_rapido: Razão EVs/carregador DC rápido [Alto]
   - vendas_mensais_evs: Estimativa de vendas mensais de EVs na região [Médio]
   - concessionarias_ev: Número de concessionárias de EVs na cidade [Médio]
   - market_share_evs: Market share de EVs na frota total [Médio]
   - projecao_frota_5anos: Projeção de crescimento da frota em 5 anos [Médio]
   - frotas_corporativas_ev: Presença de frotas corporativas elétricas [Baixo]
   - locadoras_com_evs: Presença de locadoras com EVs na frota [Baixo]
   - densidade_evs_km2: Densidade de EVs por km² na região [Médio]

3. CONCORRÊNCIA E SATURAÇÃO (10 variáveis):
   - total_carregadores_cidade: Total de carregadores na cidade [Alto]
   - carregadores_dc_rapidos: Quantidade de carregadores DC rápidos (50kW+) [Alto]
   - carregadores_ac: Quantidade de carregadores AC (lentos) [Médio]
   - carregadores_raio_2km: Carregadores existentes num raio de 2km [Alto]
   - carregadores_raio_5km: Carregadores existentes num raio de 5km [Médio]
   - tipo_concorrentes: Tipo/qualidade dos concorrentes próximos [Médio]
   - preco_medio_kwh: Preço médio por kWh praticado na região [Médio]
   - disponibilidade_concorrentes: Disponibilidade/uptime dos concorrentes [Baixo]
   - operadores_cidade: Número de operadores de recarga na cidade [Baixo]
   - saturacao_mercado: Índice de saturação do mercado local [Alto]

4. INFRAESTRUTURA DO LOCAL (10 variáveis):
   - rede_eletrica: Capacidade da rede elétrica disponível [Alto]
   - custo_conexao: Custo estimado de conexão/ampliação elétrica [Alto]
   - acessibilidade_entrada_saida: Facilidade de entrada e saída de veículos [Alto]
   - espaco_fisico: Espaço físico disponível para instalação [Alto]
   - seguranca_local: Índice de segurança do local e entorno [Alto]
   - iluminacao: Qualidade da iluminação do local [Médio]
   - acessibilidade_pne: Acessibilidade para PNE [Baixo]
   - operacao_24h: Possibilidade de operação 24 horas [Alto]
   - cobertura_chuva: Cobertura contra chuva/intempéries [Médio]
   - distancia_quadro_eletrico: Distância ao quadro elétrico mais próximo [Médio]

5. AMENIDADES E CONVENIÊNCIA (10 variáveis):
   - tempo_permanencia: Atividades disponíveis durante o tempo de carga [Alto]
   - conveniencia: Serviços de conveniência no local [Médio]
   - visibilidade: Visibilidade do ponto para quem passa [Alto]
   - tipo_estabelecimento_score: Adequação do tipo de estabelecimento [Alto]
   - servicos_raio_200m: Quantidade de serviços num raio de 200m [Médio]
   - restaurantes_raio_300m: Restaurantes/cafés num raio de 300m [Médio]
   - farmacias_24h_raio_500m: Farmácias 24h num raio de 500m [Baixo]
   - wifi_disponivel: Disponibilidade de Wi-Fi no local [Baixo]
   - estacionamento_vigilancia: Estacionamento com vigilância/câmeras [Médio]
   - loja_conveniencia: Presença de loja de conveniência [Médio]

6. DEMOGRAFIA E ECONOMIA (10 variáveis):
   - populacao: População total do município [Médio]
   - pib_per_capita: PIB per capita do município [Alto]
   - pib_total: PIB total do município [Médio]
   - idhm: Índice de Desenvolvimento Humano Municipal [Médio]
   - renda_media_bairro: Renda média do bairro/região [Alto]
   - perfil_socioeconomico: Perfil socioeconômico dominante (A/B/C) [Alto]
   - densidade_populacional: Densidade populacional da região [Médio]
   - crescimento_populacional: Taxa de crescimento populacional [Baixo]
   - frota_total_veiculos: Frota total de veículos do município [Médio]
   - veiculos_por_hab: Veículos por habitante [Baixo]

7. POTENCIAL COMERCIAL (10 variáveis):
   - potencial_parceria: Potencial de parceria com o estabelecimento [Alto]
   - diferencial_competitivo: Diferencial competitivo do ponto [Alto]
   - receitas_complementares: Potencial de receitas complementares (mídia, café, etc) [Médio]
   - potencial_b2b_frotas: Potencial de atendimento B2B/frotas [Médio]
   - potencial_clube_assinatura: Potencial para clube de assinatura [Baixo]
   - alinhamento_pluggon: Alinhamento com a estratégia Pluggon [Médio]
   - custo_aluguel_regiao: Custo de aluguel/ocupação da região [Médio]
   - potencial_expansao: Potencial de expansão futura no local [Médio]
   - incentivos_governamentais: Incentivos governamentais disponíveis [Baixo]
   - tarifa_energia: Tarifa de energia da concessionária local [Alto]

8. EXCLUSIVAS BRASIL (5 variáveis):
   - usina_solar_gd: Disponibilidade de usina solar GD na região [Médio]
   - custo_energia_solar_gd: Custo da energia solar GD disponível [Médio]
   - postos_gnv_proximos: Postos GNV próximos (indicador de transição energética) [Baixo]
   - polos_universitarios: Proximidade a polos universitários [Baixo]
   - corredor_eletrovias: Posição em corredor de eletrovias [Alto]

SISTEMA DE PESOS:
- Alto = multiplicador x3
- Médio = multiplicador x2
- Baixo = multiplicador x1
- Score final = soma(nota × peso) / soma(pesos) × 10, normalizado para 0-100

CLASSIFICAÇÕES:
- Premium: 85-100 (verde #00D97E)
- Estratégico: 70-84 (azul #2196F3)
- Viável: 55-69 (amarelo #FFC107)
- Marginal: 40-54 (laranja #FF9800)
- Rejeitado: <40 (vermelho #F44336)

CALIBRAÇÃO OBRIGATÓRIA:
- Uma universidade/faculdade em cidade grande (1M+ habitantes) com PIB per capita alto (>R$ 50.000), sem concorrência de carregadores no raio de 2km, em cidade top 5 em EVs do Brasil, NUNCA pode ter score abaixo de 65.
- Score Marginal (<55) é APENAS para locais em cidades pequenas (<200k hab), sem EVs, com muita concorrência de carregadores ou sem infraestrutura urbana.
- Universidades/faculdades têm público cativo, tempo de permanência alto (2-4h de aula), potencial ESG e estacionamento — isso vale muito nas variáveis de amenidades e potencial comercial.
- Shoppings, supermercados grandes e hospitais em cidades grandes também devem pontuar alto (>65).
- Se a cidade tem PIB per capita acima de R$ 50.000 e mais de 500k habitantes, as variáveis demográficas e econômicas devem refletir isso com notas altas (7-9).
- Se não há carregadores no raio de 2km, a variável de saturação deve ser muito favorável (8-10) pois indica oportunidade de mercado.

IMPORTANTE: Retorne TODAS as 80 variáveis. Responda APENAS com JSON válido, sem markdown, sem texto extra. Formato:
{
  "overall_score": 78,
  "classification": "ESTRATEGICO",
  "variables": [
    {
      "name": "volume_veiculos_dia",
      "category": "Demanda e Mobilidade",
      "score": 8,
      "weight": "alto",
      "justification": "Motivo curto"
    }
  ],
  "strengths": ["Ponto forte 1", "Ponto forte 2", "Ponto forte 3", "Ponto forte 4", "Ponto forte 5"],
  "weaknesses": ["Ponto de atenção 1", "Ponto de atenção 2", "Ponto de atenção 3"],
  "recommendation": "Texto de recomendação detalhada sobre o ponto, incluindo sugestões práticas de implementação."
}`;
}

// ---------- Build user prompt ----------

function buildUserPrompt(
  address: string,
  lat: number,
  lng: number,
  establishmentType: string,
  establishmentName: string,
  nearbyPOIs: NearbyPlace[],
  chargersIn2km: NearbyPlace[],
  chargersIn5km: NearbyPlace[],
  ibgeData: IBGEData,
  city: string,
  state: string,
  poiCounts: Record<string, number>
): string {
  const poiSummary = nearbyPOIs.length
    ? nearbyPOIs
        .map(
          (p) =>
            `- ${p.name} (${p.type}, ${p.distance_m}m, rating: ${p.rating ?? "N/A"})`
        )
        .join("\n")
    : "Nenhum POI encontrado.";

  const charger2kmSummary = chargersIn2km.length
    ? chargersIn2km
        .map(
          (c) =>
            `- ${c.name} (${c.distance_m}m, rating: ${c.rating ?? "N/A"}, reviews: ${c.reviews ?? 0})`
        )
        .join("\n")
    : "Nenhum carregador EV encontrado no raio de 2km.";

  const charger5kmSummary = chargersIn5km.length
    ? chargersIn5km
        .map(
          (c) =>
            `- ${c.name} (${c.distance_m}m, rating: ${c.rating ?? "N/A"}, reviews: ${c.reviews ?? 0})`
        )
        .join("\n")
    : "Nenhum carregador EV encontrado no raio de 5km.";

  return `ANALISE ESTE PONTO:

DADOS REAIS COLETADOS:
- Endereço: ${address}
- Coordenadas: ${lat}, ${lng}
- Cidade: ${city}, ${state}
- Tipo de estabelecimento: ${establishmentType}
${establishmentName ? `- Nome: ${establishmentName}` : ""}

DADOS IBGE DA CIDADE:
- População: ${ibgeData.population?.toLocaleString("pt-BR") ?? "N/D"}
- PIB per capita: R$ ${ibgeData.gdp_per_capita?.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) ?? "N/D"}
- PIB total: R$ ${ibgeData.gdp_total?.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) ?? "N/D"}
- IDHM: ${ibgeData.idhm ?? "N/D"}

CONTAGEM DE POIs POR CATEGORIA:
- Restaurantes em 500m: ${poiCounts.restaurantes} encontrados
- Farmácias em 500m: ${poiCounts.farmacias} encontrados
- Postos de gasolina em 500m: ${poiCounts.postos} encontrados
- Supermercados em 500m: ${poiCounts.supermercados} encontrados
- Shoppings em 1km: ${poiCounts.shoppings} encontrados
- Hospitais em 1km: ${poiCounts.hospitais} encontrados
- Estacionamentos em 500m: ${poiCounts.estacionamentos} encontrados

CARREGADORES EV (CONCORRÊNCIA):
- Carregadores em 2km: ${poiCounts.carregadores_2km} encontrados
- Carregadores em 5km: ${poiCounts.carregadores_5km} encontrados

LISTA DETALHADA DE POIs:
${poiSummary}

CARREGADORES EV NO RAIO DE 2km:
${charger2kmSummary}

CARREGADORES EV NO RAIO DE 5km:
${charger5kmSummary}

Com base NESSES DADOS REAIS, analise as 80 variáveis e retorne o JSON com score, classificação, variáveis detalhadas, pontos fortes, pontos de atenção e recomendação.`;
}

// ---------- Parse Claude JSON response ----------

function parseClaudeResponse(text: string): Record<string, unknown> | null {
  // Strip markdown code fences the model sometimes adds
  const cleaned = text
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // ignore
  }

  const objStart = cleaned.indexOf("{");
  const objEnd = cleaned.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    try {
      return JSON.parse(cleaned.slice(objStart, objEnd + 1));
    } catch {
      // ignore
    }
  }

  // Tentar recuperar JSON incompleto (truncado por max_tokens)
  if (objStart !== -1) {
    let truncated = cleaned.slice(objStart);
    if (!truncated.endsWith('}')) {
      const lastBrace = truncated.lastIndexOf('}');
      if (lastBrace > 0) {
        truncated = truncated.substring(0, lastBrace + 1) + ']}';
        try {
          return JSON.parse(truncated);
        } catch { /* ignore */ }
        // Tentar só fechando o objeto principal
        truncated = cleaned.slice(objStart, cleaned.lastIndexOf('}') + 1) + '}';
        try {
          return JSON.parse(truncated);
        } catch { /* ignore */ }
      }
    }
  }

  return null;
}

// ---------- Main handler ----------

export async function POST(request: Request) {
  try {
    const { address, establishment_type, establishment_name } =
      await request.json();

    if (!address) {
      return Response.json(
        { error: "Endereço é obrigatório" },
        { status: 400 }
      );
    }

    // 1. Geocode
    const geo = await geocodeAddress(address);
    if (!geo) {
      return Response.json(
        { error: "Não foi possível geocodificar o endereço. Verifique e tente novamente." },
        { status: 400 }
      );
    }

    // 2-4. Parallel: POIs (múltiplas categorias), Chargers (2km e 5km), IBGE
    const [
      restaurants, pharmacies, gasStations, supermarkets,
      shoppings, hospitals, parking,
      chargers2km, chargers5km,
      ibgeData,
    ] = await Promise.all([
      searchNearbyPlaces(geo.lat, geo.lng, "restaurante", "restaurante", 500),
      searchNearbyPlaces(geo.lat, geo.lng, "farmácia", "farmacia", 500),
      searchNearbyPlaces(geo.lat, geo.lng, "posto de gasolina", "posto", 500),
      searchNearbyPlaces(geo.lat, geo.lng, "supermercado", "supermercado", 500),
      searchNearbyPlaces(geo.lat, geo.lng, "shopping center", "shopping", 1000),
      searchNearbyPlaces(geo.lat, geo.lng, "hospital", "hospital", 1000),
      searchNearbyPlaces(geo.lat, geo.lng, "estacionamento", "estacionamento", 500),
      searchNearbyPlaces(geo.lat, geo.lng, "eletroposto OR ev charging", "carregador_ev", 2000),
      searchNearbyPlaces(geo.lat, geo.lng, "eletroposto OR ev charging", "carregador_ev", 5000),
      fetchIBGEData(geo.city, geo.state),
    ]);

    // Deduplicate POIs
    const allPOIs: NearbyPlace[] = [];
    const seen = new Set<string>();
    for (const list of [restaurants, pharmacies, gasStations, supermarkets, shoppings, hospitals, parking]) {
      for (const p of list) {
        const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
        if (!seen.has(key)) {
          seen.add(key);
          allPOIs.push(p);
        }
      }
    }

    // Deduplicate chargers 5km (includes 2km results)
    const allChargers: NearbyPlace[] = [];
    const seenChargers = new Set<string>();
    for (const list of [chargers2km, chargers5km]) {
      for (const c of list) {
        const key = `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`;
        if (!seenChargers.has(key)) {
          seenChargers.add(key);
          allChargers.push(c);
        }
      }
    }
    const chargersIn2km = allChargers.filter((c) => c.distance_m <= 2000);
    const chargersIn5km = allChargers.filter((c) => c.distance_m <= 5000);

    // POI counts by category
    const poiCounts = {
      restaurantes: restaurants.length,
      farmacias: pharmacies.length,
      postos: gasStations.length,
      supermercados: supermarkets.length,
      shoppings: shoppings.length,
      hospitais: hospitals.length,
      estacionamentos: parking.length,
      carregadores_2km: chargersIn2km.length,
      carregadores_5km: chargersIn5km.length,
    };

    // 5. Claude analysis
    const userPrompt = buildUserPrompt(
      address,
      geo.lat,
      geo.lng,
      establishment_type || "outro",
      establishment_name || "",
      allPOIs,
      chargersIn2km,
      chargersIn5km,
      ibgeData,
      geo.city,
      geo.state,
      poiCounts
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    let analysisResult: Record<string, unknown> | null = null;
    try {
      const message = await anthropic.messages.create(
        {
          model: "claude-sonnet-4-20250514",
          max_tokens: 16000,
          system: buildSystemPrompt(),
          messages: [{ role: "user", content: userPrompt }],
        },
        { signal: controller.signal }
      );

      const textBlock = message.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        return Response.json({ error: "Resposta vazia da IA" }, { status: 500 });
      }

      analysisResult = parseClaudeResponse(textBlock.text);
      if (!analysisResult) {
        console.error("score-point: parse error. Response:", textBlock.text.slice(0, 500));
        return Response.json(
          { error: "Erro ao processar resposta da IA. Tente novamente." },
          { status: 500 }
        );
      }
    } catch (err) {
      const errorName = (err as Error).name || "";
      if (errorName === "AbortError" || controller.signal.aborted) {
        return Response.json(
          { error: "Análise demorou mais que o esperado. Tente novamente." },
          { status: 504 }
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    // 6. Save to DB
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const responseData = {
      address,
      lat: geo.lat,
      lng: geo.lng,
      city: geo.city,
      state: geo.state,
      establishment_type: establishment_type || "outro",
      establishment_name: establishment_name || "",
      overall_score: analysisResult.overall_score as number,
      classification: analysisResult.classification as string,
      variables: analysisResult.variables as unknown[],
      strengths: analysisResult.strengths as string[],
      weaknesses: analysisResult.weaknesses as string[],
      recommendation: analysisResult.recommendation as string,
      nearby_pois: allPOIs,
      nearby_chargers: chargersIn5km,
      ibge_data: ibgeData,
    };

    if (user) {
      await supabase.from("point_scores").insert({
        user_id: user.id,
        address,
        lat: geo.lat,
        lng: geo.lng,
        city: geo.city,
        state: geo.state,
        establishment_type: establishment_type || "outro",
        establishment_name: establishment_name || "",
        overall_score: analysisResult.overall_score,
        classification: analysisResult.classification,
        variables_json: analysisResult.variables,
        strengths: analysisResult.strengths,
        weaknesses: analysisResult.weaknesses,
        recommendation: analysisResult.recommendation,
        status: "done",
      });
    }

    return Response.json(responseData);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("score-point: erro geral:", errorMessage);
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
