import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

const anthropic = new Anthropic();

// ---------- IBGE Population ----------

async function fetchPopulation(
  city: string,
  state: string
): Promise<number | null> {
  try {
    const searchUrl = `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state}/municipios`;
    const res = await fetch(searchUrl);
    if (!res.ok) return null;
    const municipalities = await res.json();
    const found = municipalities.find(
      (m: { nome: string }) => m.nome.toLowerCase() === city.toLowerCase()
    );
    if (!found) return null;

    const popUrl = `https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos/-1/variaveis/9324?localidades=N6[${found.id}]`;
    const popRes = await fetch(popUrl);
    if (!popRes.ok) return null;
    const popData = await popRes.json();
    const series = popData?.[0]?.resultados?.[0]?.series?.[0]?.serie;
    if (!series) return null;
    const latestKey = Object.keys(series).sort().pop();
    return latestKey ? parseInt(series[latestKey], 10) : null;
  } catch {
    return null;
  }
}

// ---------- Normalize Claude response ----------

function normalizePoint(raw: Record<string, unknown>) {
  return {
    name: (raw.nome ?? raw.name ?? "") as string,
    lat: raw.lat as number,
    lng: raw.lng as number,
    address: (raw.endereco ?? raw.address ?? "") as string,
    category: (raw.categoria ?? raw.category ?? "outro") as string,
    subcategory: (raw.subcategoria ?? raw.subcategory ?? "") as string,
    score: typeof raw.score === "number" ? raw.score : 0,
    classification: normalizeClassification(
      (raw.classificacao ?? raw.classification ?? "VIAVEL") as string
    ),
    justification: (raw.justificativa ?? raw.justification ?? "") as string,
    operacao_24h: (raw.operacao_24h ?? false) as boolean,
    tempo_permanencia: (raw.tempo_permanencia ?? "") as string,
    pontos_fortes: (raw.pontos_fortes ?? []) as string[],
    pontos_atencao: (raw.pontos_atencao ?? []) as string[],
  };
}

function normalizeClassification(c: string): string {
  const upper = c
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (upper.includes("PREMIUM")) return "PREMIUM";
  if (upper.includes("ESTRATEG")) return "ESTRATEGICO";
  if (upper.includes("VIAVEL") || upper.includes("VIÁVEL")) return "VIAVEL";
  if (upper.includes("MARGINAL")) return "MARGINAL";
  if (upper.includes("REJEITADO")) return "REJEITADO";
  return "VIAVEL";
}

// ---------- Build Claude prompt ----------

function buildClaudePrompt(city: string, state: string, population: number | null): string {
  const popInfo = population ? ` (população: ${population.toLocaleString("pt-BR")})` : "";
  return `Retorne um JSON array com no mínimo 30 e no máximo 40 pontos para eletropostos rápidos DC em ${city}-${state}${popInfo}. Inclua os principais postos de combustível 24h, shoppings, hospitais 24h, supermercados grandes, rodoviárias e aeroportos, hotéis, universidades e farmácias 24h. Cada objeto: {"nome": "Nome real", "lat": -23.55, "lng": -46.63, "endereco": "Endereço real completo", "categoria": "posto_24h", "subcategoria": "Rede ou detalhe", "score": 85, "classificacao": "PREMIUM", "justificativa": "Motivo curto", "operacao_24h": true, "tempo_permanencia": "15-45min", "pontos_fortes": ["ponto1"], "pontos_atencao": ["ponto1"]}. Categorias: posto_24h, posto_combustivel, shopping, hospital_24h, farmacia_24h, rodoviaria, aeroporto, universidade, supermercado, atacadao, hotel, academia, estacionamento, concessionaria, centro_comercial, restaurante, outro. Classificações por score: PREMIUM(80-100), ESTRATEGICO(60-79), VIAVEL(40-59), MARGINAL(20-39). Coordenadas REAIS de locais que EXISTEM. Responda APENAS o JSON array, sem markdown, sem texto extra.`;
}

// ---------- Parse Claude JSON response ----------

function parseClaudeJSON(raw: string): any {
  let text = raw;
  // Remover markdown code blocks
  text = text.replace(/```json\s*/gi, '');
  text = text.replace(/```\s*/gi, '');
  text = text.trim();
  // Encontrar o primeiro { ou [
  const startBrace = text.indexOf('{');
  const startBracket = text.indexOf('[');
  let start = -1;
  if (startBrace === -1) start = startBracket;
  else if (startBracket === -1) start = startBrace;
  else start = Math.min(startBrace, startBracket);
  if (start > 0) text = text.substring(start);
  // Encontrar o último } ou ]
  const endBrace = text.lastIndexOf('}');
  const endBracket = text.lastIndexOf(']');
  const end = Math.max(endBrace, endBracket);
  if (end > 0) text = text.substring(0, end + 1);
  try {
    return JSON.parse(text);
  } catch(e) {
    // Tentar fechar JSON incompleto
    if (text.includes('"sections"')) {
      const lastComplete = text.lastIndexOf('}');
      if (lastComplete > 0) {
        const fixed = text.substring(0, lastComplete + 1) + ']}';
        return JSON.parse(fixed);
      }
    }
    console.error('JSON raw:', text.substring(0, 200));
    throw new Error('Failed to parse JSON: ' + (e as Error).message);
  }
}

// ---------- Claude retry helper ----------

async function callClaudeWithRetry(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 110000);
    try {
      const msg = await anthropic.messages.create(params, { signal: controller.signal });
      return msg;
    } catch (err) {
      console.warn(`Chamada Claude falhou (tentativa ${attempt + 1}):`, err instanceof Error ? err.message : err);
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
    const { city, state } = await request.json();

    if (!city || !state) {
      return Response.json(
        { error: "Cidade e estado são obrigatórios" },
        { status: 400 }
      );
    }

    // Buscar população (necessária pro prompt do Claude)
    const population = await fetchPopulation(city, state);

    // Chamada ao Claude com retry
    const claudePrompt = buildClaudePrompt(city, state, population);

    let rawPoints: Record<string, unknown>[] = [];
    try {
      const message = await callClaudeWithRetry({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: claudePrompt,
          },
        ],
      });

      const textBlock = message.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        return Response.json({ error: "Resposta vazia da IA" }, { status: 500 });
      }

      const parsed = parseClaudeJSON(textBlock.text);
      rawPoints = Array.isArray(parsed) ? parsed : parsed?.points || [];
      if (rawPoints.length === 0) {
        console.error("analyze-city: Claude retornou 0 pontos. Resposta:", textBlock.text.slice(0, 500));
        return Response.json(
          { error: "Não foi possível gerar pontos para esta cidade. Tente novamente." },
          { status: 500 }
        );
      }
    } catch (err) {
      console.error("analyze-city: erro na chamada Claude:", err instanceof Error ? err.message : err);
      return Response.json(
        { error: "Tente novamente em 1 minuto." },
        { status: 500 }
      );
    }

    // Normalizar pontos
    const points = rawPoints.map((p) => normalizePoint(p));

    // Salvar no banco (sem esperar concorrentes/mobilidade)
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await supabase.from("city_analyses").insert({
        user_id: user.id,
        city,
        state,
        population,
        charger_count: 0,
        points_json: points,
        status: "done",
      });
    }

    return Response.json({
      city,
      state,
      population,
      points,
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("analyze-city: erro geral:", {
      message: errorMessage,
      stack: err instanceof Error ? err.stack : undefined,
      raw: err,
    });
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
