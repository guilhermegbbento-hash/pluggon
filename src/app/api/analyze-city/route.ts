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

function parseClaudeResponse(text: string): Record<string, unknown>[] {
  // Try direct parse
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : parsed.points || [];
  } catch {
    // ignore
  }

  // Try extracting array
  const arrStart = text.indexOf("[");
  const arrEnd = text.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) {
    try {
      return JSON.parse(text.slice(arrStart, arrEnd + 1));
    } catch {
      // ignore
    }
  }

  // Try extracting object with points
  const objStart = text.indexOf("{");
  const objEnd = text.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    try {
      const obj = JSON.parse(text.slice(objStart, objEnd + 1));
      return obj.points || [];
    } catch {
      // ignore
    }
  }

  // Last resort: truncated JSON - close at last complete object
  if (arrStart !== -1) {
    let cleaned = text.slice(arrStart);
    const lastComplete = cleaned.lastIndexOf("},");
    if (lastComplete !== -1) {
      cleaned = cleaned.slice(0, lastComplete + 1) + "]";
      try {
        return JSON.parse(cleaned);
      } catch {
        // ignore
      }
    }
  }

  return [];
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

    // Chamada ao Claude com timeout de 120s
    const claudePrompt = buildClaudePrompt(city, state, population);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    let rawPoints: Record<string, unknown>[] = [];
    try {
      const message = await anthropic.messages.create(
        {
          model: "claude-sonnet-4-20250514",
          max_tokens: 16000,
          messages: [
            {
              role: "user",
              content: claudePrompt,
            },
          ],
        },
        { signal: controller.signal }
      );

      const textBlock = message.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        return Response.json({ error: "Resposta vazia da IA" }, { status: 500 });
      }

      rawPoints = parseClaudeResponse(textBlock.text);
      if (rawPoints.length === 0) {
        console.error("analyze-city: Claude retornou 0 pontos. Resposta:", textBlock.text.slice(0, 500));
        return Response.json(
          { error: "Não foi possível gerar pontos para esta cidade. Tente novamente." },
          { status: 500 }
        );
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorName = (err as Error).name || "";
      console.error("analyze-city: erro na chamada Claude:", {
        name: errorName,
        message: errorMessage,
        aborted: controller.signal.aborted,
        stack: err instanceof Error ? err.stack : undefined,
      });
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
