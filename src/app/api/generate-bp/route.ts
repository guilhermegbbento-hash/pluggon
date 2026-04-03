import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { searchPlaces, deduplicatePlaces } from "@/lib/google-places";

export const maxDuration = 90;

const anthropic = new Anthropic();

// ---------- Fetch IBGE city data ----------

interface IBGEData {
  population: number | null;
  gdp_per_capita: number | null;
  idhm: number | null;
  fleet_total: number | null;
}

async function fetchIBGEData(city: string, state: string): Promise<IBGEData> {
  const result: IBGEData = {
    population: null,
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
    } catch { /* continue */ }

    // PIB per capita
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
              result.gdp_per_capita = Math.round(gdpTotal / result.population);
            }
          }
        }
      }
    } catch { /* continue */ }

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
    } catch { /* continue */ }
  } catch { /* continue */ }

  return result;
}

// ---------- Fetch chargers via Google Places ----------

async function fetchChargers(city: string, state: string) {
  const queries = ["eletroposto", "ev charging station", "carregador veículo elétrico"];
  const lists = await Promise.all(
    queries.map((q) => searchPlaces(q, city, state, 20))
  );
  return deduplicatePlaces(lists);
}

// ---------- Types ----------

interface FormData {
  client_name: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  objective: string;
  resources: string;
  capital: string;
  financing: string;
  strategy: string;
  timeline: string;
  market_moment: string;
  demand_identified: string;
  priorities: string[];
  challenges: string;
}

// ---------- Parse Tally free-text via Claude ----------

async function parseTallyText(rawText: string): Promise<FormData> {
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    system: `Extraia campos de um formulário colado pelo usuário. Retorne APENAS JSON sem markdown.
Campos: client_name, phone, email, city, state (sigla UF), objective, resources, capital, financing, strategy, timeline, market_moment, demand_identified, priorities (array de strings), challenges.
Se não encontrar um campo, use string vazia (ou array vazio para priorities). Deduza o que puder do contexto.`,
    messages: [{ role: "user", content: rawText }],
  });
  const textBlock = msg.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("Falha ao parsear texto Tally");
  const parsed = parseClaudeResponse(textBlock.text);
  if (!parsed) throw new Error("Falha ao parsear JSON do texto Tally");
  return {
    client_name: String(parsed.client_name || ""),
    phone: String(parsed.phone || ""),
    email: String(parsed.email || ""),
    city: String(parsed.city || ""),
    state: String(parsed.state || ""),
    objective: String(parsed.objective || ""),
    resources: String(parsed.resources || ""),
    capital: String(parsed.capital || ""),
    financing: String(parsed.financing || ""),
    strategy: String(parsed.strategy || ""),
    timeline: String(parsed.timeline || ""),
    market_moment: String(parsed.market_moment || ""),
    demand_identified: String(parsed.demand_identified || ""),
    priorities: Array.isArray(parsed.priorities) ? parsed.priorities.map(String) : [],
    challenges: String(parsed.challenges || ""),
  };
}

// ---------- Parse Claude JSON response ----------

function parseClaudeResponse(text: string): Record<string, unknown> | null {
  const cleaned = text
    .replace(/^```json\s*/g, "")
    .replace(/^```\s*/g, "")
    .replace(/\s*```$/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch { /* ignore */ }

  const objStart = cleaned.indexOf("{");
  const objEnd = cleaned.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    try {
      return JSON.parse(cleaned.slice(objStart, objEnd + 1));
    } catch { /* ignore */ }
  }

  // Tentar recuperar JSON incompleto (truncado por max_tokens)
  if (objStart !== -1) {
    let truncated = cleaned.slice(objStart);
    if (!truncated.endsWith(']}')) {
      const lastBrace = truncated.lastIndexOf('}');
      if (lastBrace > 0) {
        truncated = truncated.substring(0, lastBrace + 1) + ']}';
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
    const body = await request.json();

    let form: FormData;

    if (body.tally_text) {
      // Tally paste mode — parse free text via Claude
      form = await parseTallyText(body.tally_text);
    } else {
      form = {
        client_name: body.client_name || "",
        phone: body.phone || "",
        email: body.email || "",
        city: body.city || "",
        state: body.state || "",
        objective: body.objective || "",
        resources: body.resources || "",
        capital: body.capital || "",
        financing: body.financing || "",
        strategy: body.strategy || "",
        timeline: body.timeline || "",
        market_moment: body.market_moment || "",
        demand_identified: body.demand_identified || "",
        priorities: body.priorities || [],
        challenges: body.challenges || "",
      };
    }

    if (!form.client_name || !form.city || !form.state) {
      return Response.json(
        { error: "Nome, cidade e estado são obrigatórios. Certifique-se de que o texto contém esses dados." },
        { status: 400 }
      );
    }

    // 1. Fetch IBGE data and chargers in parallel
    const [ibgeData, chargers] = await Promise.all([
      fetchIBGEData(form.city, form.state),
      fetchChargers(form.city, form.state),
    ]);

    const chargersList = chargers.map((c) => ({
      name: c.name,
      address: c.address,
    }));

    const chargerListText = chargersList.length
      ? chargersList.map((c) => `- ${c.name} — ${c.address}`).join("\n")
      : "Nenhum carregador encontrado.";

    // 2. Determine charger config based on capital
    const capitalStr = form.capital.replace(/[^\d]/g, "");
    const capitalNum = parseInt(capitalStr, 10) || 55000;
    let chargerConfig = "1x DC 40kW";
    let capexTotal = 55000;
    if (capitalNum >= 500000) { chargerConfig = "5x DC 80kW"; capexTotal = 500000; }
    else if (capitalNum >= 300000) { chargerConfig = "3x DC 80kW"; capexTotal = 300000; }
    else if (capitalNum >= 200000) { chargerConfig = "2x DC 80kW"; capexTotal = 200000; }
    else if (capitalNum >= 100000) { chargerConfig = "1x DC 80kW"; capexTotal = 100000; }

    const baseSystemPrompt = `Você é um consultor especialista em eletropostos no Brasil. Responda APENAS JSON válido sem markdown code blocks. Formato: {"sections":[{"title":"...","content":"..."}]}. O content deve ser em markdown rico.`;

    const clientContext = `CLIENTE: ${form.client_name}
CIDADE: ${form.city}/${form.state}
OBJETIVO: ${form.objective}
CAPITAL: ${form.capital}
ESTRATÉGIA: ${form.strategy}
TIMELINE: ${form.timeline}
DESAFIOS: ${form.challenges || "Não informado"}
RECURSOS: ${form.resources || "Não informado"}
CONFIGURAÇÃO: ${chargerConfig} (CAPEX total: R$${capexTotal.toLocaleString("pt-BR")})`;

    // ---------- Chamada 1: Seções Institucionais ----------
    const call1Promise = anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: baseSystemPrompt,
      messages: [{
        role: "user",
        content: `${clientContext}

Gere EXATAMENTE estas 4 seções no JSON {"sections":[...]}, com content em markdown:

1. "Capa" — Título: "Business Plan — Eletroposto ${form.city}/${form.state}". Subtítulo: "Preparado para ${form.client_name}". Data: Abril 2026. Rodapé: "PLUGGON — Inteligência para Eletromobilidade". Apresentação visual e profissional.

2. "Sobre a BLEV" — A BLEV Energia é especialista em eletromobilidade no Brasil. Fundada com a missão de acelerar a transição energética no transporte, a BLEV atua desde consultoria estratégica até implantação e operação de eletropostos. A empresa combina tecnologia de ponta com conhecimento profundo do mercado brasileiro, oferecendo soluções turnkey para investidores e empresas que desejam participar da revolução dos veículos elétricos. Parceira de fabricantes internacionais de carregadores, a BLEV garante equipamentos de alta performance e suporte técnico especializado.

3. "Guilherme Bento — Sócio Fundador" — Guilherme Bento é engenheiro e empreendedor com mais de 10 anos de experiência no setor de energia e inovação. Sócio fundador da BLEV Energia, lidera a estratégia de expansão da rede de eletropostos no Brasil. Com visão de mercado e experiência prática em projetos de infraestrutura de recarga, Guilherme se especializou em viabilizar negócios de eletromobilidade para investidores, franqueados e empresas. Sua abordagem combina análise de dados, inteligência de mercado e execução prática.

4. "Sumário Executivo" — Personalizado para ${form.client_name}. Contexto do mercado EV no Brasil (crescimento de 90%+ ao ano, projeção de 1M de EVs até 2030). Por que investir agora em ${form.city}/${form.state}. Configuração recomendada: ${chargerConfig}. Investimento total: R$${capexTotal.toLocaleString("pt-BR")}. Resumo do retorno esperado. Tom profissional e persuasivo.`,
      }],
    });

    // ---------- Chamada 2: Análise ----------
    const call2Promise = anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: baseSystemPrompt,
      messages: [{
        role: "user",
        content: `${clientContext}

DADOS IBGE:
- População: ${ibgeData.population?.toLocaleString("pt-BR") ?? "N/D"}
- PIB per capita: R$ ${ibgeData.gdp_per_capita?.toLocaleString("pt-BR") ?? "N/D"}
- IDHM: ${ibgeData.idhm ?? "N/D"}

CARREGADORES EXISTENTES (${chargers.length} encontrados):
${chargerListText}

Gere EXATAMENTE estas 4 seções no JSON {"sections":[...]}, com content em markdown:

1. "Análise de Mercado" — Dados socioeconômicos da cidade (use os dados IBGE acima), panorama do mercado EV no Brasil (vendas crescendo 90%+ ao ano, frota estimada em 200k+ em 2025), tendências de eletrificação, oportunidade específica em ${form.city}.

2. "Análise de Concorrência" — Liste TODOS os ${chargers.length} carregadores existentes encontrados acima. Analise a cobertura, gaps geográficos, tipos de carregadores (AC vs DC), operadores presentes. Se poucos/nenhum, destacar a oportunidade de first-mover.

3. "Diferencial Competitivo BLEV" — Tecnologia de ponta (carregadores DC rápidos 40-80kW), app próprio com localização e pagamento, suporte técnico 24/7, modelo turnkey (do projeto à operação), parceria com fabricantes internacionais, plataforma PLUGGON de inteligência de dados.

4. "Vantagem Competitiva do Ponto" — Por que ${form.city} especificamente, baseado nos dados reais. Vantagens sobre a concorrência existente. Timing de mercado. Potencial de crescimento da demanda.`,
      }],
    });

    const financialSystemPrompt = `${baseSystemPrompt}

PREMISSAS FINANCEIRAS EXATAS — use SOMENTE estes valores, NÃO invente números:

CAPEX:
- Carregador DC 40kW: R$35.000 equipamento + R$12.000 instalação + R$5.000 civil + R$3.000 licenças = R$55.000 TOTAL
- Carregador DC 80kW: R$70.000 equipamento + R$18.000 instalação + R$8.000 civil + R$4.000 licenças = R$100.000 TOTAL

OPEX FIXO: R$474/mês por carregador (seguro R$150 + internet R$125 + manutenção R$199)
OPEX VARIÁVEL: 14% do faturamento (gateway pagamento 8% + impostos 6%)

RECEITA:
- Preço de venda: R$2,00/kWh
- Custo energia concessionária: R$1,00/kWh
- Custo energia usina solar: R$0,50/kWh
- Base de cálculo payback: 4h/dia de uso

TABELA DE LUCRO LÍQUIDO MENSAL (80kW, CONCESSIONÁRIA):
| Horas/dia | Lucro Líquido/mês |
| 3h | R$4.710 |
| 6h | R$9.894 |
| 9h | R$15.078 |
| 12h | R$20.262 |

TABELA DE LUCRO LÍQUIDO MENSAL (80kW, USINA SOLAR):
| Horas/dia | Lucro Líquido/mês |
| 3h | R$8.310 |
| 6h | R$17.094 |
| 9h | R$25.878 |
| 12h | R$34.662 |

CONFIGURAÇÃO DESTE CLIENTE: Capital ${form.capital} → ${chargerConfig} (CAPEX total: R$${capexTotal.toLocaleString("pt-BR")})`;

    // ---------- Chamada 3: Financeiro (CAPEX, OPEX, Projeções, Payback) ----------
    const call3Promise = anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: financialSystemPrompt,
      messages: [{
        role: "user",
        content: `${clientContext}

Gere EXATAMENTE estas 4 seções no JSON {"sections":[...]}, com content em markdown:

1. "CAPEX — Investimento Inicial" — Tabela detalhada: equipamento, instalação, civil, licenças. Total por carregador e total geral para ${chargerConfig}.

2. "OPEX — Custos Operacionais" — OPEX fixo R$474/mês detalhado (seguro R$150, internet R$125, manutenção R$199) + OPEX variável 14% do faturamento. Tabela mensal e anual.

3. "Projeção de Receita e Lucro" — Tabela com cenários 3h, 6h, 9h, 12h/dia para CONCESSIONÁRIA e USINA SOLAR. Usar EXATAMENTE os valores das tabelas das premissas, multiplicando pelo número de carregadores em ${chargerConfig}. Mostrar receita bruta, custos e lucro líquido.

4. "Payback e ROI" — Cálculo de payback em meses para cenário base 4h/dia, tanto concessionária quanto solar. ROI anual percentual. Tabela comparativa.`,
      }],
    });

    // ---------- Chamada 4: Estratégia, Marketing, Projeção 5 anos, Plano 90 dias ----------
    const call4Promise = anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: financialSystemPrompt,
      messages: [{
        role: "user",
        content: `${clientContext}

Gere EXATAMENTE estas 8 seções no JSON {"sections":[...]}, com content em markdown:

1. "Estratégia de Marketing e Operacional" — Ações práticas para atrair motoristas de EV: Google Maps, apps de recarga (PlugShare, Waze), parcerias com concessionárias EV, presença digital, sinalização local. Plano operacional: manutenção preventiva, monitoramento remoto, atendimento ao cliente.

2. "Receitas Extras e Oportunidades" — Mídia/publicidade no carregador, parcerias com estabelecimentos, clube de assinatura para recarga recorrente, venda de créditos de carbono, locação de espaço publicitário digital, parcerias B2B com frotas.

3. "Projeção 5 Anos" — Ano 1: operação inicial com ${chargerConfig}. Anos 2-3: aumento de utilização, possível expansão. Anos 4-5: operação madura, retorno consolidado. Tabela ano a ano com receita, custo e lucro estimados.

4. "Plano de Ação 90 Dias" — Cronograma semana a semana: Semanas 1-2 (contrato e projeto), Semanas 3-4 (licenças e pedido equipamento), Semanas 5-8 (obra civil e elétrica), Semanas 9-10 (instalação e testes), Semanas 11-12 (inauguração e marketing). Ações concretas e responsáveis.

5. "Riscos e Mitigações" — Principais riscos do projeto (demanda inicial baixa, atrasos em obra, mudanças regulatórias, vandalismo) e estratégias de mitigação para cada um.

6. "Desafio do Mercado" — Desafios específicos do mercado de eletromobilidade no Brasil: infraestrutura elétrica, educação do consumidor, concorrência, regulamentação. Como o projeto se posiciona frente a esses desafios.

7. "Próximos Passos" — Ações imediatas recomendadas para ${form.client_name}: assinatura de contrato, definição do ponto exato, início do projeto executivo. Call-to-action profissional.

8. "Considerações Finais" — Fechamento profissional reforçando a oportunidade, o suporte da BLEV/PLUGGON e o potencial de retorno. Tom motivacional e confiante.`,
      }],
    });

    // Execute all 4 calls in parallel
    const [msg1, msg2, msg3, msg4] = await Promise.all([call1Promise, call2Promise, call3Promise, call4Promise]);

    // Parse each response
    const allSections: { title: string; content: string }[] = [];
    for (const [idx, msg] of [msg1, msg2, msg3, msg4].entries()) {
      const textBlock = msg.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        console.error(`generate-bp: resposta vazia da IA na chamada ${idx + 1}`);
        return Response.json({ error: `Resposta vazia da IA (chamada ${idx + 1})` }, { status: 500 });
      }

      const result = parseClaudeResponse(textBlock.text);
      if (!result || !Array.isArray(result.sections)) {
        console.error(`generate-bp: parse error chamada ${idx + 1}:`, textBlock.text.slice(0, 500));
        return Response.json(
          { error: `Erro ao processar resposta da IA (chamada ${idx + 1}). Tente novamente.` },
          { status: 500 }
        );
      }

      allSections.push(
        ...(result.sections as { title: string; content: string }[])
      );
    }

    const sections = allSections;

    // 3. Save to database
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await supabase.from("business_plans").insert({
        user_id: user.id,
        client_name: form.client_name,
        client_email: form.email,
        client_phone: form.phone,
        city: form.city,
        state: form.state,
        capital_available: form.capital,
        objective: form.objective,
        strategy: form.strategy,
        challenges: form.challenges,
        priorities: form.priorities.join(", "),
        content_json: { sections, ibge: ibgeData, chargers_count: chargers.length },
        status: "done",
      });
    }

    return Response.json({
      sections,
      ibge: ibgeData,
      chargers_count: chargers.length,
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("generate-bp: erro geral:", errorMessage);
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
