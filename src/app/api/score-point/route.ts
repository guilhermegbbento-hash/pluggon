import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import {
  fetchAllCompetitors,
  classifyCompetitors,
  countNearby,
} from "@/lib/competitors";
import { calculateScore } from "@/lib/scoring-engine";
import type { ScoreInput } from "@/lib/scoring-engine";

export const maxDuration = 300;

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

// ---------- Build Claude system prompt (justificativas das 80 variáveis) ----------

function buildSystemPrompt(totalCompetitors: number, population: number | null): string {
  const popText = population ? `${population.toLocaleString("pt-BR")} habitantes` : "população da cidade";
  return `Você é a BLEV, plataforma líder em inteligência para eletromobilidade no Brasil. Analise este ponto para instalação de eletroposto DC (40kW a 80kW).

O SCORE GERAL JÁ FOI CALCULADO pelo sistema. Sua tarefa é APENAS gerar as justificativas detalhadas das 80 variáveis.

REGRA CRÍTICA SOBRE CONCORRENTES (PRIORIDADE MÁXIMA — LEIA ANTES DE QUALQUER OUTRA COISA):
- Encontramos ${totalCompetitors} carregadores na cidade via Google Places.
- NÃO sabemos quantos são DC ou AC (Google Places não informa tipo).
- NUNCA diga "apenas X carregadores DC" ou "X carregadores rápidos". Você NÃO sabe esse número.
- O que pode dizer: "Foram identificados ${totalCompetitors} pontos de recarga na cidade. A cidade tem potencial para muito mais, considerando a população de ${popText}."
- NUNCA invente um número específico de DC. Se não sabe, não diga.
- Nos pontos fortes, em vez de "apenas 10 DC rápidos", dizer "mercado com espaço para crescimento de carregadores rápidos DC".
- PROIBIDO usar a palavra "apenas" seguida de um número de carregadores que você não tem certeza.

REGRAS INVIOLÁVEIS DE INTEGRIDADE DE DADOS:
- NUNCA invente dados de carregadores. Use APENAS os dados que foram coletados e fornecidos neste prompt.
- Se encontramos ${totalCompetitors} concorrentes via Google Places, diga ${totalCompetitors}. NUNCA diga um número diferente.
- Nos pontos fortes e de atenção (strengths/weaknesses), use APENAS dados que foram fornecidos nas APIs. NÃO invente estatísticas. Se o dado não foi coletado, NÃO mencione.
- NUNCA crie números, percentuais, quantidades ou rankings que não estejam explicitamente nos dados fornecidos.

REGRAS DE RECOMENDAÇÃO INVIOLÁVEIS (campo "recommendation"):
- NUNCA recomendar carregadores acima de 80kW. É PROIBIDO mencionar 150kW, 120kW, 100kW ou qualquer potência superior a 80kW.
- A recomendação BLEV é: 1 a 3 carregadores DC de 40kW, 60kW ou 80kW. Pode complementar com 1 AC 7kW.
- A recomendação padrão é: começar com 1x DC 80kW + 1x AC 7kW, validar demanda, depois expandir para 2-3 DC 80kW.
- Se o terreno é grande, máximo 3x DC 80kW na fase inicial.
- NUNCA recomendar 4-6 carregadores logo de início. A filosofia BLEV é começar pequeno, validar, expandir.

Analise as 80 variáveis abaixo organizadas em 8 categorias. Dê nota 0-10 em CADA variável com justificativa curta. O peso de cada variável está indicado: Alto(x3), Médio(x2), Baixo(x1).

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

CLASSIFICAÇÕES:
- Premium: 85-100 (dourado #C9A84C)
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

IMPORTANTE: Retorne TODAS as 80 variáveis. Justificativas com MÁXIMO 10 palavras cada. Seja extremamente conciso. Responda APENAS com JSON válido, sem markdown, sem texto extra. Formato:
{
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
  observations: string,
  nearbyPOIs: NearbyPlace[],
  chargersIn2km: number,
  chargersIn200m: number,
  chargersInCity: number,
  chargerOperators: string[],
  ibgeData: IBGEData,
  city: string,
  state: string,
  poiCounts: Record<string, number>,
  calculatedScore: number,
  calculatedClassification: string
): string {
  const poiSummary = nearbyPOIs.length
    ? nearbyPOIs
        .map(
          (p) =>
            `- ${p.name} (${p.type}, ${p.distance_m}m, rating: ${p.rating ?? "N/A"})`
        )
        .join("\n")
    : "Nenhum POI encontrado.";

  return `ANALISE ESTE PONTO:

SCORE JÁ CALCULADO PELO SISTEMA: ${calculatedScore}/100 — ${calculatedClassification}
(Baseado em dados reais de concorrência OpenChargeMap + dados IBGE + tipo de estabelecimento)

DADOS REAIS COLETADOS:
- Endereço: ${address}
- Coordenadas: ${lat}, ${lng}
- Cidade: ${city}, ${state}
- Tipo de estabelecimento: ${establishmentType}
${observations ? `\nOBSERVAÇÕES IMPORTANTES FORNECIDAS PELO USUÁRIO (considere na análise):\n${observations}\n` : ""}

DADOS IBGE DA CIDADE:
- População: ${ibgeData.population?.toLocaleString("pt-BR") ?? "N/D"}
- PIB per capita: R$ ${ibgeData.gdp_per_capita?.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) ?? "N/D"}
- PIB total: R$ ${ibgeData.gdp_total?.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) ?? "N/D"}
- IDHM: ${ibgeData.idhm ?? "N/D"}

DADOS REAIS DE CONCORRÊNCIA (Google Places + carregados.com.br):
- Total de carregadores na cidade: ${chargersInCity} (tipo DC/AC NÃO é conhecido — Google Places não informa)
- Concorrentes diretos (<200m): ${chargersIn200m}
- Carregadores no raio de 2km: ${chargersIn2km}
- Operadores na cidade: ${chargerOperators.join(", ") || "Nenhum"}

CONTAGEM DE POIs POR CATEGORIA (Google Places):
- Restaurantes em 500m: ${poiCounts.restaurantes} encontrados
- Farmácias em 500m: ${poiCounts.farmacias} encontrados
- Postos de gasolina em 500m: ${poiCounts.postos} encontrados
- Supermercados em 500m: ${poiCounts.supermercados} encontrados
- Shoppings em 1km: ${poiCounts.shoppings} encontrados
- Hospitais em 1km: ${poiCounts.hospitais} encontrados
- Estacionamentos em 500m: ${poiCounts.estacionamentos} encontrados

LISTA DETALHADA DE POIs:
${poiSummary}

Com base NESSES DADOS REAIS, gere as justificativas detalhadas das 80 variáveis. O score geral (${calculatedScore}) já foi calculado — foque nas notas individuais e justificativas de cada variável.`;
}

// ---------- Parse Claude JSON response ----------

function parseClaudeJSON(raw: string): any {
  let text = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  const start = text.indexOf("{");
  if (start > 0) text = text.substring(start);

  try {
    return JSON.parse(text);
  } catch {
    // continue to recovery
  }

  // JSON cortado - recuperar variáveis completas
  try {
    const varsMatch = text.match(/"variables"\s*:\s*\[/);
    if (varsMatch) {
      const variables: Array<{
        name: string;
        category: string;
        score: number;
        weight: string;
        justification: string;
      }> = [];
      const regex =
        /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"category"\s*:\s*"([^"]+)"\s*,\s*"score"\s*:\s*(\d+)\s*,\s*"weight"\s*:\s*"([^"]+)"\s*,\s*"justification"\s*:\s*"([^"]*?)"\s*\}/g;
      let match;
      while ((match = regex.exec(text)) !== null) {
        variables.push({
          name: match[1],
          category: match[2],
          score: parseInt(match[3], 10),
          weight: match[4],
          justification: match[5],
        });
      }

      if (variables.length > 0) {
        console.log(
          "parseClaudeJSON: recuperou " +
            variables.length +
            " variáveis de JSON cortado"
        );

        const overallMatch = text.match(/"overall_score"\s*:\s*(\d+)/);
        const classMatch = text.match(/"classification"\s*:\s*"([^"]+)"/);

        return {
          variables,
          overall_score: overallMatch ? parseInt(overallMatch[1], 10) : null,
          classification: classMatch ? classMatch[1] : null,
          strengths: [],
          weaknesses: [],
          recommendation:
            "Análise gerada com dados parciais. Consulte o Score do Ponto na plataforma para detalhes.",
        };
      }
    }
  } catch (e2) {
    console.error("Recuperação falhou:", e2);
  }

  throw new Error("Failed to parse JSON: " + text.substring(0, 100));
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

// ---------- Main handler ----------

export async function POST(request: Request) {
  try {
    const { address, establishment_type, establishment_name, lat, lng } =
      await request.json();

    if (!address && (lat == null || lng == null)) {
      return Response.json(
        { error: "Endereço ou coordenadas são obrigatórios" },
        { status: 400 }
      );
    }

    // 1. Geocode (skip if lat/lng already provided)
    let geo: { lat: number; lng: number; city: string; state: string } | null = null;
    if (typeof lat === "number" && typeof lng === "number") {
      // Reverse geocode to get city/state from coordinates
      let city = "";
      let state = "";
      if (GOOGLE_MAPS_API_KEY) {
        try {
          const revUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}&language=pt-BR&region=br`;
          const revRes = await fetch(revUrl);
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
          // Continue without city/state - will try geocoding address as fallback
        }
      }
      geo = { lat, lng, city, state };
    } else {
      geo = await geocodeAddress(address);
    }
    if (!geo) {
      return Response.json(
        {
          error:
            "Não foi possível geocodificar o endereço. Verifique e tente novamente.",
        },
        { status: 400 }
      );
    }

    // 2. Validate the point itself via Google Places to get rating/reviews
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
              "X-Goog-FieldMask":
                "places.rating,places.userRatingCount",
            },
            body: JSON.stringify({
              textQuery: address,
              maxResultCount: 1,
            }),
          }
        );
        if (placeRes.ok) {
          const placeData = await placeRes.json();
          const place = placeData.places?.[0];
          if (place) {
            pointRating = place.rating || 0;
            pointReviews = place.userRatingCount || 0;
          }
        }
      } catch {
        // continue without rating
      }
    }

    // 3. Parallel: POIs (Google Places), Competitors (3 fontes), IBGE
    const [
      restaurants,
      pharmacies,
      gasStations,
      supermarkets,
      shoppings,
      hospitals,
      parking,
      allCompetitors,
      ibgeData,
    ] = await Promise.all([
      searchNearbyPlaces(geo.lat, geo.lng, "restaurante", "restaurante", 500),
      searchNearbyPlaces(geo.lat, geo.lng, "farmácia", "farmacia", 500),
      searchNearbyPlaces(
        geo.lat,
        geo.lng,
        "posto de gasolina",
        "posto",
        500
      ),
      searchNearbyPlaces(
        geo.lat,
        geo.lng,
        "supermercado",
        "supermercado",
        500
      ),
      searchNearbyPlaces(
        geo.lat,
        geo.lng,
        "shopping center",
        "shopping",
        1000
      ),
      searchNearbyPlaces(geo.lat, geo.lng, "hospital", "hospital", 1000),
      searchNearbyPlaces(
        geo.lat,
        geo.lng,
        "estacionamento",
        "estacionamento",
        500
      ),
      fetchAllCompetitors(geo.city, geo.state, geo.lat, geo.lng).then(r => r.competitors), // Google Places + carregados.com.br
      fetchIBGEData(geo.city, geo.state),
    ]);

    // Deduplicate POIs
    const allPOIs: NearbyPlace[] = [];
    const seen = new Set<string>();
    for (const list of [
      restaurants,
      pharmacies,
      gasStations,
      supermarkets,
      shoppings,
      hospitals,
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

    // Count competitors by radius
    const chargersIn200m = countNearby(geo.lat, geo.lng, allCompetitors, 200);
    const chargersIn2km = countNearby(geo.lat, geo.lng, allCompetitors, 2000);
    const chargerInfo = classifyCompetitors(allCompetitors);

    // POI counts by category
    const poiCounts = {
      restaurantes: restaurants.length,
      farmacias: pharmacies.length,
      postos: gasStations.length,
      supermercados: supermarkets.length,
      shoppings: shoppings.length,
      hospitais: hospitals.length,
      estacionamentos: parking.length,
      carregadores_200m: chargersIn200m,
      carregadores_2km: chargersIn2km,
    };

    // 3. Calcular score com scoring-engine (MESMA fórmula do heatmap)
    // Inferir qualidade do bairro pelo PIB per capita da cidade
    const gdpPC = ibgeData.gdp_per_capita || 30000;
    const nbQuality =
      gdpPC > 70000
        ? "premium"
        : gdpPC > 50000
          ? "alto"
          : gdpPC > 25000
            ? "medio"
            : "baixo";

    const scoreInput: ScoreInput = {
      population: ibgeData.population || 200000,
      gdpPerCapita: gdpPC,
      establishmentType: establishment_type || "outro",
      is24h: [
        "posto_24h",
        "hospital_24h",
        "farmacia_24h",
        "aeroporto",
      ].includes(establishment_type || ""),
      neighborhoodQuality: nbQuality,
      chargersInCity: chargerInfo.total,
      dcChargersInCity: chargerInfo.dc,
      chargersIn200m,
      chargersIn2km,
      restaurantsNearby: restaurants.length,
      hospitalsNearby: hospitals.length,
      shoppingNearby: shoppings.length,
      gasStationsNearby: gasStations.length,
      parkingNearby: parking.length,
      rating: pointRating,
      reviews: pointReviews,
    };

    const scoreResult = calculateScore(scoreInput);

    // 4. Claude analysis - apenas justificativas das 80 variáveis
    const userPrompt = buildUserPrompt(
      address,
      geo.lat,
      geo.lng,
      establishment_type || "outro",
      establishment_name || "",
      allPOIs,
      chargersIn2km,
      chargersIn200m,
      chargerInfo.total,
      chargerInfo.operators,
      ibgeData,
      geo.city,
      geo.state,
      poiCounts,
      scoreResult.overallScore,
      scoreResult.classification
    );

    let analysisResult: Record<string, unknown> | null = null;
    try {
      const message = await callClaudeWithRetry({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        system: buildSystemPrompt(chargerInfo.total, ibgeData.population),
        messages: [{ role: "user", content: userPrompt }],
      });

      const textBlock = message.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        return Response.json(
          { error: "Resposta vazia da IA" },
          { status: 500 }
        );
      }

      analysisResult = parseClaudeJSON(textBlock.text);
      if (!analysisResult) {
        console.error(
          "score-point: parse error. Response:",
          textBlock.text.slice(0, 500)
        );
        return Response.json(
          { error: "Erro ao processar resposta da IA. Tente novamente." },
          { status: 500 }
        );
      }
    } catch (err) {
      console.error(
        "score-point: erro na chamada Claude:",
        err instanceof Error ? err.message : err
      );
      return Response.json(
        { error: "Tente novamente em 1 minuto." },
        { status: 500 }
      );
    }

    // 5. Montar resposta com score do scoring-engine + variáveis do Claude
    const responseData = {
      address,
      lat: geo.lat,
      lng: geo.lng,
      city: geo.city,
      state: geo.state,
      establishment_type: establishment_type || "outro",
      establishment_name: establishment_name || "",
      overall_score: scoreResult.overallScore,
      classification: scoreResult.classification,
      scoring_variables: scoreResult.variables, // variáveis do scoring-engine
      variables: analysisResult.variables as unknown[], // 80 variáveis detalhadas do Claude
      strengths: analysisResult.strengths as string[],
      weaknesses: analysisResult.weaknesses as string[],
      recommendation: analysisResult.recommendation as string,
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
        })),
      ibge_data: ibgeData,
      charger_summary: {
        total: chargerInfo.total,
        dc: chargerInfo.dc,
        ac: chargerInfo.ac,
        in_200m: chargersIn200m,
        in_2km: chargersIn2km,
        operators: chargerInfo.operators,
      },
    };

    // 6. Save to DB
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let score_id: number | null = null;
    if (user) {
      const { data: inserted } = await supabase
        .from("point_scores")
        .insert({
          user_id: user.id,
          address,
          lat: geo.lat,
          lng: geo.lng,
          city: geo.city,
          state: geo.state,
          establishment_type: establishment_type || "outro",
          establishment_name: establishment_name || "",
          overall_score: scoreResult.overallScore,
          classification: scoreResult.classification,
          variables_json: analysisResult.variables,
          strengths: analysisResult.strengths,
          weaknesses: analysisResult.weaknesses,
          recommendation: analysisResult.recommendation,
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
