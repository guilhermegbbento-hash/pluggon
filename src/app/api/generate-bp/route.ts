import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { searchPlaces, deduplicatePlaces } from "@/lib/google-places";

export const maxDuration = 300;

const anthropic = new Anthropic();

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
  observations: string;
  timeline: string;
  market_moment: string;
  demand_identified: string;
  priorities: string[];
  challenges: string;
}

interface BPSection {
  number: number;
  title: string;
  content: string;
}

// ---------- Parse Claude JSON ----------

function parseClaudeJSON(raw: string): any {
  let text = raw;
  text = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

  const start = text.indexOf('{');
  if (start > 0) text = text.substring(start);

  // Tentar parse direto
  try { return JSON.parse(text); } catch(e) { /* fall through */ }

  // JSON cortado - recuperar seções completas
  try {
    const sections: any[] = [];
    const regex = /\{\s*"title"\s*:\s*"([^"]+)"\s*,\s*"content"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      sections.push({ title: match[1], content: match[2].replace(/\\n/g, '\n').replace(/\\"/g, '"') });
    }
    if (sections.length > 0) {
      console.log('parseClaudeJSON: recuperou ' + sections.length + ' seções de JSON incompleto');
      return { sections };
    }
  } catch(e2) { /* fall through */ }

  // Última tentativa: fechar o JSON
  try {
    const lastBrace = text.lastIndexOf('}');
    if (lastBrace > 0) {
      return JSON.parse(text.substring(0, lastBrace + 1) + ']}');
    }
  } catch(e3) { /* fall through */ }

  console.error('parseClaudeJSON falhou. Primeiros 500 chars:', text.substring(0, 500));
  return { sections: [{ title: "Conteúdo", content: text.substring(0, 3000) }] };
}

// ---------- Parse Tally (regex-based, no API call) ----------

function parseTallyText(rawText: string): FormData {
  const text = rawText;

  const nameMatch = text.match(/Nome\n(.+?)\n/);
  const phoneMatch = text.match(/Phone Number\n(.+?)\n/);
  const emailMatch = text.match(/E-mail Address\n(.+?)\n/);

  const cityMatch = text.match(/(?:Untitled long answer field|Cidade)\n(.+?)\n/);
  const cityFull = cityMatch ? cityMatch[1].trim() : "";
  const cityParts = cityFull.split(",").map((s) => s.trim());

  const objMatch = text.match(/objetivo principal.*?\n(.+?)\n/i);
  const resMatch = text.match(/Se marcou alguma acima, descreva\n(.+?)\n/);
  const capMatch = text.match(/Capital Disponível[^\n]*\n([^\n]+)/i);
  const whenMatch = text.match(/Quando pretende começar\n(.+?)\n/i);
  const momentMatch = text.match(/momento na sua cidade\??\n(.+?)\n/i);
  const demandMatch = text.match(/demanda real\n(.+?)\n/i);
  const prioMatch = text.match(/Prioridades[^\n]*\n([^\n]+)/i);
  const chalMatch = text.match(/(?:maiores desafios|desafios hoje)\n([^\n]+)/i);

  return {
    client_name: nameMatch ? nameMatch[1].trim() : "Cliente",
    phone: phoneMatch ? phoneMatch[1].trim() : "",
    email: emailMatch ? emailMatch[1].trim() : "",
    city: cityParts[0] || "",
    state: cityParts[1] || "",
    objective: objMatch ? objMatch[1].trim() : "",
    resources: resMatch ? resMatch[1].trim() : "",
    capital: (() => {
      let capitalRaw = capMatch ? capMatch[1].trim() : '100000';
      if (capitalRaw.toLowerCase().includes('acima') || capitalRaw.toLowerCase().includes('mais de')) {
        const numInside = capitalRaw.match(/([\d.,]+)/);
        capitalRaw = numInside ? numInside[1] : '500000';
      }
      console.log('=== CAPITAL RAW ===', capitalRaw);
      return capitalRaw;
    })(),
    observations: "",
    timeline: whenMatch ? whenMatch[1].trim() : "",
    market_moment: momentMatch ? momentMatch[1].trim() : "",
    demand_identified: demandMatch ? demandMatch[1].trim() : "",
    priorities: prioMatch ? prioMatch[1].trim().split(/\s*,\s*/) : [],
    challenges: chalMatch ? chalMatch[1].trim() : "",
  };
}

// ---------- IBGE ----------

async function fetchIBGEData(city: string, state: string) {
  let population: number | null = null;
  let municipioId: string | null = null;

  try {
    // Buscar município
    const res = await fetch("https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome");
    if (res.ok) {
      const municipalities = await res.json();
      const found = municipalities.find(
        (m: { nome: string; id: number }) => m.nome.toLowerCase() === city.toLowerCase()
      );
      if (found) {
        municipioId = String(found.id);

        // Buscar população
        try {
          const popRes = await fetch(
            `https://servicodados.ibge.gov.br/api/v3/agregados/4714/periodos/-6/variaveis/93?localidades=N6[${municipioId}]`
          );
          if (popRes.ok) {
            const d = await popRes.json();
            const s = d?.[0]?.resultados?.[0]?.series?.[0]?.serie;
            if (s) {
              const k = Object.keys(s).sort().pop();
              if (k) population = parseInt(s[k], 10);
            }
          }
        } catch {
          /* continue */
        }
      }
    }
  } catch {
    // Fallback: BrasilAPI
    try {
      const fallbackRes = await fetch(`https://brasilapi.com.br/api/ibge/municipios/v1/${state}`);
      if (fallbackRes.ok) {
        const data = await fallbackRes.json();
        const found = data.find(
          (m: { nome: string }) => m.nome.toLowerCase() === city.toLowerCase()
        );
        if (found && found.populacao) {
          population = found.populacao;
        }
      }
    } catch {
      /* continue */
    }
  }

  // Se não achou população, usar estimativa
  if (!population) {
    population = 100000; // estimativa conservadora
  }

  return { population, municipioId };
}

// ---------- Chargers (Google Places) ----------

async function fetchChargers(city: string, state: string) {
  const queries = ["eletroposto", "ev charging station", "carregador veículo elétrico"];
  const lists = await Promise.all(queries.map((q) => searchPlaces(q, city, state, 20)));
  return deduplicatePlaces(lists);
}

// ---------- Claude call with retry ----------

async function callClaude(system: string, userContent: string): Promise<{ title: string; content: string }[]> {
  const params = {
    model: "claude-sonnet-4-20250514" as const,
    max_tokens: 4096,
    system,
    messages: [{ role: "user" as const, content: userContent }],
  };

  let msg: Anthropic.Message | null = null;
  try {
    msg = await anthropic.messages.create(params);
  } catch {
    try {
      msg = await anthropic.messages.create(params);
    } catch {
      /* fail */
    }
  }

  if (!msg) throw new Error("Claude call failed after retry");

  const textBlock = msg.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("Empty Claude response");

  const parsed = parseClaudeJSON(textBlock.text);
  if (!parsed || !Array.isArray(parsed.sections)) throw new Error("Failed to parse Claude JSON");

  return parsed.sections as { title: string; content: string }[];
}

// ---------- Main handler ----------

export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log('=== BODY COMPLETO ===', JSON.stringify(body));

    // PASSO 1 - Receber dados do formulário
    let form: FormData;
    if (body.tally_text) {
      form = parseTallyText(body.tally_text);
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
        observations: body.observations || "",
        timeline: body.timeline || "",
        market_moment: body.market_moment || "",
        demand_identified: body.demand_identified || "",
        priorities: body.priorities || [],
        challenges: body.challenges || "",
      };
    }

    console.log('=== FORM DATA PARSEADO ===', { name: form.client_name, city: form.city, capital: form.capital });

    if (!form.client_name || !form.city || !form.state) {
      return Response.json({ error: "Nome, cidade e estado são obrigatórios." }, { status: 400 });
    }

    // PASSO 2 - Calcular TUDO no código TypeScript
    // Parse capital - tratar "Acima de R$ 500.000,00" e variações
    let capitalStr = String(form.capital || '100000');
    // Remover texto antes do número (Acima de, Até, Aproximadamente, etc)
    capitalStr = capitalStr.replace(/^[^0-9R$]*/i, '');
    // Remover R$ e espaços
    capitalStr = capitalStr.replace(/R\$\s*/gi, '').trim();
    // Se ainda tem texto antes do número, extrair só o número
    const numMatch = capitalStr.match(/([\d.,]+)/);
    if (numMatch) {
      capitalStr = numMatch[1];
    }
    // Formato brasileiro: 500.000,00 -> 500000
    if (capitalStr.includes(',')) {
      capitalStr = capitalStr.replace(/\./g, '').replace(',', '.');
    }
    const capital = Math.round(parseFloat(capitalStr) || 100000);
    console.log('=== CAPITAL FINAL ===', capital);
    let qty: number, pw: number, capex: number;
    if (capital >= 500000) { qty = 5; pw = 80; capex = 500000; }
    else if (capital >= 300000) { qty = 3; pw = 80; capex = 300000; }
    else if (capital >= 200000) { qty = 2; pw = 80; capex = 200000; }
    else if (capital >= 100000) { qty = 1; pw = 80; capex = 100000; }
    else { qty = 1; pw = 40; capex = 55000; }
    console.log('=== CONFIG ===', { qty, pw, capex, config: qty+'x DC '+pw+'kW' });

    // PASSO 3 - Buscar IBGE com try/catch e fallback
    // PASSO 4 - Buscar carregadores via Google Places
    const [ibgeData, chargers] = await Promise.all([
      fetchIBGEData(form.city, form.state),
      fetchChargers(form.city, form.state),
    ]);

    // PASSO 5 - Gerar seções FIXAS no código (sem Claude)
    const sections: BPSection[] = [];

    // CAPA
    sections.push({
      number: 1,
      title: "BUSINESS PLAN PERSONALIZADO",
      content: `ELETROPOSTO ${form.city.toUpperCase()}/${form.state.toUpperCase()}\n\nPreparado para: ${form.client_name}\nCidade: ${form.city} - ${form.state}\nData: ${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}\n\nConfiguração Recomendada: ${qty}x DC ${pw}kW\nInvestimento Total: R$ ${capex.toLocaleString("pt-BR")}\n\nBLEV Educação\nA primeira empresa de educação em mobilidade elétrica do Brasil\nContato: @guilhermegbbento`,
    });

    // BLEV EDUCAÇÃO
    sections.push({
      number: 2,
      title: "QUEM SOMOS - BLEV EDUCAÇÃO",
      content: `A BLEV Educação é a primeira empresa de educação em mobilidade elétrica do Brasil. Nascemos com a missão de democratizar o conhecimento sobre eletropostos e preparar empreendedores para a maior transformação do setor automotivo em 100 anos.\n\nNão somos apenas uma escola. Somos um ecossistema completo que acompanha nossos alunos desde o primeiro aprendizado até a operação lucrativa de suas estações de carregamento.\n\nO Ecossistema BLEV:\n\nBLEV EDUCAÇÃO - A primeira e maior escola de mobilidade elétrica do Brasil. Formamos empreendedores completos, com conhecimento técnico, comercial e estratégico.\n\nEVVO - Nossa operadora de eletropostos, com mais de 50 estações em operação. Vencedora da primeira licitação pública de hub de eletropostos do Sul do Brasil.\n\nPLUGGO - Gateway de pagamento internacional especializado em eletropostos. Processamos pagamentos via PIX, cartão e carteiras digitais.\n\nPLUGGON - Software proprietário de geolocalização e inteligência de mercado para identificação dos melhores pontos.`,
    });

    // GUILHERME BENTO
    sections.push({
      number: 3,
      title: "QUEM É GUILHERME BENTO",
      content: `Guilherme Bento é engenheiro eletricista (CREA SC 156014-1) e um dos maiores especialistas em mobilidade elétrica do Brasil.\n\nTrajetória:\n- +5.000 usinas solares instaladas\n- +100 eletropostos implementados e em operação\n- Ex-Diretor da BC SOLAR (faturamento de R$ 25 milhões/mês)\n- Ex-Fundador da CO2 ENERGY (comercializadora de energia)\n\nA virada para mobilidade elétrica aconteceu quando identificou uma usina solar em Pato Branco (PR) que gerava R$ 890 mil por mês vendendo energia exclusivamente para estações de carregamento.\n\n"Eu errei muito para você não precisar errar. Tudo que ensino na BLEV foi testado na prática, com dinheiro real, em operações reais." — Guilherme Bento`,
    });

    // CAPEX - calculado no código
    const equipUnit = pw === 80 ? 70000 : 35000;
    const instUnit = pw === 80 ? 18000 : 12000;
    const civilUnit = pw === 80 ? 8000 : 5000;
    const licUnit = pw === 80 ? 4000 : 3000;

    sections.push({
      number: 4,
      title: "INVESTIMENTO INICIAL (CAPEX)",
      content: `Configuração: ${qty}x Carregador DC ${pw}kW\n\n| Item | Valor Unitário | Qtd | Total |\n|------|---------------|-----|-------|\n| Carregador DC ${pw}kW | R$ ${equipUnit.toLocaleString("pt-BR")} | ${qty} | R$ ${(equipUnit * qty).toLocaleString("pt-BR")} |\n| Instalação Elétrica | R$ ${instUnit.toLocaleString("pt-BR")} | ${qty} | R$ ${(instUnit * qty).toLocaleString("pt-BR")} |\n| Adequação Civil | R$ ${civilUnit.toLocaleString("pt-BR")} | ${qty} | R$ ${(civilUnit * qty).toLocaleString("pt-BR")} |\n| Licenças e Taxas | R$ ${licUnit.toLocaleString("pt-BR")} | ${qty} | R$ ${(licUnit * qty).toLocaleString("pt-BR")} |\n| **TOTAL** | | | **R$ ${capex.toLocaleString("pt-BR")}** |`,
    });

    // OPEX
    const opexFixo = 474 * qty;

    sections.push({
      number: 5,
      title: "CUSTOS OPERACIONAIS (OPEX)",
      content: `OPEX Fixo por carregador: R$ 474/mês\n- Seguro: R$ 150/mês\n- Internet 4G: R$ 125/mês\n- Manutenção: R$ 199/mês\n\nOPEX Fixo Total (${qty} carregadores): R$ ${opexFixo.toLocaleString("pt-BR")}/mês\n\nOPEX Variável: 14% do faturamento\n- Gateway de pagamento: 8%\n- Impostos (Simples): 6%`,
    });

    // PROJEÇÕES - calculadas no código
    function calcRow(h: number) {
      const kwh = h * pw * 30 * qty;
      const fat = kwh * 2;
      const custoConc = kwh * 1;
      const custoSolar = kwh * 0.5;
      const opexVar = fat * 0.14;
      const lucroConc = fat - custoConc - opexVar - opexFixo;
      const lucroSolar = fat - custoSolar - opexVar - opexFixo;
      return { h, kwh, fat, custoConc, custoSolar, opexVar, lucroConc, lucroSolar };
    }
    const r3 = calcRow(3), r4 = calcRow(4), r6 = calcRow(6), r9 = calcRow(9), r12 = calcRow(12);
    const fmt = (n: number) => "R$ " + Math.round(n).toLocaleString("pt-BR");

    sections.push({
      number: 6,
      title: "PROJEÇÃO FINANCEIRA - CENÁRIO CONCESSIONÁRIA (R$ 1,00/kWh)",
      content: `Preço de venda: R$ 2,00/kWh | Custo energia: R$ 1,00/kWh\n\n| Uso/Dia | kWh/Mês | Faturamento | Custo Energia | OPEX Var (14%) | OPEX Fixo | Lucro Líquido |\n|---------|---------|-------------|--------------|----------------|-----------|---------------|\n| 3h | ${r3.kwh.toLocaleString("pt-BR")} | ${fmt(r3.fat)} | ${fmt(r3.custoConc)} | ${fmt(r3.opexVar)} | ${fmt(opexFixo)} | ${fmt(r3.lucroConc)} |\n| 4h (BASE) | ${r4.kwh.toLocaleString("pt-BR")} | ${fmt(r4.fat)} | ${fmt(r4.custoConc)} | ${fmt(r4.opexVar)} | ${fmt(opexFixo)} | ${fmt(r4.lucroConc)} |\n| 6h | ${r6.kwh.toLocaleString("pt-BR")} | ${fmt(r6.fat)} | ${fmt(r6.custoConc)} | ${fmt(r6.opexVar)} | ${fmt(opexFixo)} | ${fmt(r6.lucroConc)} |\n| 9h | ${r9.kwh.toLocaleString("pt-BR")} | ${fmt(r9.fat)} | ${fmt(r9.custoConc)} | ${fmt(r9.opexVar)} | ${fmt(opexFixo)} | ${fmt(r9.lucroConc)} |\n| 12h | ${r12.kwh.toLocaleString("pt-BR")} | ${fmt(r12.fat)} | ${fmt(r12.custoConc)} | ${fmt(r12.opexVar)} | ${fmt(opexFixo)} | ${fmt(r12.lucroConc)} |`,
    });

    sections.push({
      number: 7,
      title: "PROJEÇÃO FINANCEIRA - CENÁRIO USINA SOLAR (R$ 0,50/kWh)",
      content: `Preço de venda: R$ 2,00/kWh | Custo energia: R$ 0,50/kWh\n\n| Uso/Dia | kWh/Mês | Faturamento | Custo Energia | OPEX Var (14%) | OPEX Fixo | Lucro Líquido |\n|---------|---------|-------------|--------------|----------------|-----------|---------------|\n| 3h | ${r3.kwh.toLocaleString("pt-BR")} | ${fmt(r3.fat)} | ${fmt(r3.custoSolar)} | ${fmt(r3.opexVar)} | ${fmt(opexFixo)} | ${fmt(r3.lucroSolar)} |\n| 4h (BASE) | ${r4.kwh.toLocaleString("pt-BR")} | ${fmt(r4.fat)} | ${fmt(r4.custoSolar)} | ${fmt(r4.opexVar)} | ${fmt(opexFixo)} | ${fmt(r4.lucroSolar)} |\n| 6h | ${r6.kwh.toLocaleString("pt-BR")} | ${fmt(r6.fat)} | ${fmt(r6.custoSolar)} | ${fmt(r6.opexVar)} | ${fmt(opexFixo)} | ${fmt(r6.lucroSolar)} |\n| 9h | ${r9.kwh.toLocaleString("pt-BR")} | ${fmt(r9.fat)} | ${fmt(r9.custoSolar)} | ${fmt(r9.opexVar)} | ${fmt(opexFixo)} | ${fmt(r9.lucroSolar)} |\n| 12h | ${r12.kwh.toLocaleString("pt-BR")} | ${fmt(r12.fat)} | ${fmt(r12.custoSolar)} | ${fmt(r12.opexVar)} | ${fmt(opexFixo)} | ${fmt(r12.lucroSolar)} |`,
    });

    // PAYBACK
    sections.push({
      number: 8,
      title: "PAYBACK E ROI",
      content: `Base: 4h/dia (cenário conservador)\n\n| Cenário | Lucro/Mês | Payback | ROI Anual |\n|---------|-----------|---------|----------|\n| Concessionária | ${fmt(r4.lucroConc)} | ${(capex / r4.lucroConc).toFixed(1)} meses | ${((r4.lucroConc * 12 / capex) * 100).toFixed(0)}% |\n| Usina Solar | ${fmt(r4.lucroSolar)} | ${(capex / r4.lucroSolar).toFixed(1)} meses | ${((r4.lucroSolar * 12 / capex) * 100).toFixed(0)}% |\n\nUsina Solar: Contrato de geração distribuída. Custo R$ 0,50/kWh. Não precisa construir usina — contrata energia de usina existente via créditos na conta de luz. A BLEV indica parceiros.`,
    });

    // PROJEÇÃO 5 ANOS - calculada no código (2 cenários)
    const proj5AnosConc = [];
    const proj5AnosSolar = [];
    let pontosAnoConc = qty;
    let pontosAnoSolar = qty;
    for (let ano = 1; ano <= 5; ano++) {
      const row = calcRow(ano <= 1 ? 4 : ano <= 2 ? 5 : 6);
      const lucroMesConc = row.lucroConc * (pontosAnoConc / qty);
      const lucroMesSolar = row.lucroSolar * (pontosAnoSolar / qty);
      proj5AnosConc.push({ ano, pontos: pontosAnoConc, lucroMes: lucroMesConc, lucroAnual: lucroMesConc * 12 });
      proj5AnosSolar.push({ ano, pontos: pontosAnoSolar, lucroMes: lucroMesSolar, lucroAnual: lucroMesSolar * 12 });
      if (ano >= 2) {
        pontosAnoConc = Math.min(pontosAnoConc + qty, qty * 3);
        pontosAnoSolar = Math.min(pontosAnoSolar + qty, qty * 3);
      }
    }
    sections.push({
      number: 9,
      title: "PROJEÇÃO DE 5 ANOS",
      content: `### Cenário 1: Energia Concessionária (R$ 1,00/kWh)\n\n| Ano | Pontos | Lucro Mensal | Lucro Anual |\n|-----|--------|-------------|-------------|\n${proj5AnosConc.map(p => `| Ano ${p.ano} | ${p.pontos} | ${fmt(p.lucroMes)} | ${fmt(p.lucroAnual)} |`).join('\n')}\n\n### Cenário 2: Energia Usina Solar (R$ 0,50/kWh)\n\n| Ano | Pontos | Lucro Mensal | Lucro Anual |\n|-----|--------|-------------|-------------|\n${proj5AnosSolar.map(p => `| Ano ${p.ano} | ${p.pontos} | ${fmt(p.lucroMes)} | ${fmt(p.lucroAnual)} |`).join('\n')}\n\nPremissas: Utilização crescente de 4h para 6h/dia, expansão gradual com reinvestimento. O Cenário 2 (usina solar) utiliza contrato de geração distribuída a R$ 0,50/kWh — não é necessário construir usina, basta contratar energia de usina existente via créditos na conta de luz.`,
    });

    // PLANO DE AÇÃO 90 DIAS - fixo no código
    sections.push({
      number: 10,
      title: "PLANO DE AÇÃO - PRIMEIROS 90 DIAS",
      content: `| Semana | Ação | Responsável |\n|--------|------|-------------|\n| 1-2 | Definir localização final e visitar pontos | ${form.client_name} |\n| 2-3 | Negociar parceria/contrato com dono do espaço | ${form.client_name} |\n| 3-4 | Contratar projeto elétrico | BLEV indica |\n| 4-5 | Solicitar viabilidade junto à concessionária | Engenheiro |\n| 5-6 | Comprar equipamentos (${qty}x DC ${pw}kW) | ${form.client_name} + BLEV |\n| 6-8 | Instalação elétrica e civil | Equipe técnica |\n| 8-10 | Testes e homologação | Técnico |\n| 10-11 | Cadastro PlugShare, Google Maps, Carregados | ${form.client_name} |\n| 11-12 | Lançamento + marketing inicial | ${form.client_name} + BLEV |\n\nChecklist de decisões imediatas:\n1. Escolher localização final\n2. Definir modelo de contrato (aluguel fixo vs revenue share)\n3. Solicitar orçamentos de 3 fornecedores de carregadores DC ${pw}kW\n4. Consultar contador sobre regime tributário (Simples Nacional)\n5. Agendar mentoria com a BLEV para acompanhamento personalizado`,
    });

    // DISCLAIMER
    sections.push({
      number: 11,
      title: "DISCLAIMER",
      content: `Este Business Plan foi elaborado com base em dados públicos disponíveis, experiência de mercado da BLEV Educação e projeções baseadas em operações reais. Os resultados efetivos podem variar de acordo com localização, execução, condições de mercado e outros fatores.\n\nFerramentas: Google Places, IBGE, BLEV Intelligence\nData: ${new Date().toLocaleDateString("pt-BR")}\n\nBLEV Educação | @guilhermegbbento\nA primeira empresa de educação em mobilidade elétrica do Brasil`,
    });

    // PASSO 6 - Chamar Claude APENAS pra seções analíticas (2 chamadas)
    const chargerListText = chargers.length
      ? chargers.map((c) => `- ${c.name} — ${c.address}`).join("\n")
      : "Nenhum carregador encontrado na região.";

    const ruleBlock = `Capital do cliente: R$ ${capex.toLocaleString("pt-BR")}. Configuração: ${qty}x DC ${pw}kW. NUNCA mencionar valor diferente. BLEV Educação (nunca BLEV Energia).`;

    const blevRules = `REGRAS INVIOLÁVEIS DA BLEV EDUCAÇÃO - NUNCA DESOBEDEÇA:
- PRECIFICAÇÃO BLEV:
  - Preço padrão (avulso): R$ 2,00/kWh
  - Motoristas de app (Uber/99/InDrive) parceiros: R$ 1,80/kWh (desconto 10%)
  - Clube de assinatura (R$ 50/mês): R$ 1,70/kWh (desconto 15%)
  - Contratos de frotas (volume 12-24 meses): R$ 1,70/kWh
  - Nunca abaixo de R$ 1,70/kWh
  - NUNCA usar valores tipo R$ 0,89 ou R$ 0,79 - isso é ABAIXO do custo da energia
  - A margem vem da diferença entre custo (R$0,50 a R$1,00) e venda (R$1,70 a R$2,00)
  - Para projeções financeiras usar SEMPRE R$ 2,00/kWh como base do payback
- Custo energia concessionária: R$ 1,00/kWh
- Custo energia usina solar: R$ 0,50/kWh (contrato geração distribuída, NÃO é o cliente que constrói a usina)
- OPEX fixo: R$ 474/mês por carregador
- OPEX variável: 14% do faturamento
- Payback com 4h/dia: ~15,5 meses (concessionária) ou ~9 meses (usina solar) POR CARREGADOR 80kW
- ROI anual: ~77% (concessionária) ou ~135% (usina solar)
- NUNCA dizer payback de 4-5 anos. Com energia solar o payback é 9 meses.
- NUNCA inventar dados que não foram fornecidos.
- Se não sabe o dado exato, dizer 'dados a serem validados localmente'.
- NUNCA usar emojis nos títulos.
- Sempre referir como BLEV Educação (nunca BLEV Energia).
- Contato: @guilhermegbbento
- Os valores financeiros JÁ FORAM CALCULADOS E FORNECIDOS. Use EXATAMENTE os valores do bloco PRÉ-CALCULADOS abaixo. Não recalcule.

PRÉ-CALCULADOS (use estes valores, NÃO recalcule):
- Configuração: ${qty}x DC ${pw}kW
- CAPEX total: R$ ${capex.toLocaleString("pt-BR")}
- OPEX fixo total: R$ ${opexFixo.toLocaleString("pt-BR")}/mês
- Faturamento 4h/dia: ${fmt(r4.fat)}/mês
- Lucro concessionária 4h/dia: ${fmt(r4.lucroConc)}/mês
- Lucro usina solar 4h/dia: ${fmt(r4.lucroSolar)}/mês
- Payback concessionária: ${(capex / r4.lucroConc).toFixed(1)} meses
- Payback usina solar: ${(capex / r4.lucroSolar).toFixed(1)} meses
- ROI anual concessionária: ${((r4.lucroConc * 12 / capex) * 100).toFixed(0)}%
- ROI anual usina solar: ${((r4.lucroSolar * 12 / capex) * 100).toFixed(0)}%`;

    const systemPrompt = `${blevRules}

Você é um consultor especialista em eletropostos no Brasil, trabalhando para a BLEV Educação.
Responda APENAS JSON válido sem markdown code blocks. Formato: {"sections":[{"title":"...","content":"..."}]}
O content deve ser em markdown rico com ## e ### para subtítulos, **negrito**, listas e tabelas quando aplicável.
${ruleBlock}`;

    const contextBlock = `DADOS DO CLIENTE:
- Nome: ${form.client_name}
- Cidade: ${form.city}/${form.state}
- Objetivo: ${form.objective || "Não informado"}
- Capital: R$ ${capex.toLocaleString("pt-BR")} | Configuração: ${qty}x DC ${pw}kW
- Timeline: ${form.timeline || "Não informado"}
- Desafios: ${form.challenges || "Não informado"}
- Recursos: ${form.resources || "Não informado"}
- Observações: ${form.observations || "Nenhuma"}

DADOS IBGE:
- População: ${ibgeData.population?.toLocaleString("pt-BR") ?? "N/D"}

CARREGADORES EXISTENTES (${chargers.length} encontrados):
${chargerListText}

${ruleBlock}`;

    // Chamada 1: Sumário Executivo + Análise de Mercado + Concorrência
    // Chamada 2: Marketing + Operacional + Outras Receitas + Riscos + Desafio + Próximos Passos
    const [claudeSections1, claudeSections2] = await Promise.all([
      callClaude(
        systemPrompt,
        `${contextBlock}

Gere EXATAMENTE estas 3 seções no JSON {"sections":[...]}:

1. "Sumário Executivo" — Personalizado para ${form.client_name}. Contexto do mercado EV no Brasil (crescimento 90%+ ao ano, projeção 1M EVs até 2030). Por que investir agora em ${form.city}/${form.state}. Configuração: ${qty}x DC ${pw}kW. Investimento: R$ ${capex.toLocaleString("pt-BR")}. Tom profissional e persuasivo.

2. "Análise de Mercado" — Dados socioeconômicos (população ${ibgeData.population?.toLocaleString("pt-BR") ?? "N/D"}). Panorama EV Brasil (vendas crescendo 90%+, frota 200k+ em 2025). Oportunidade em ${form.city}.

3. "Análise de Concorrência" — Liste TODOS os ${chargers.length} carregadores existentes. Para cada um, indicar nome e endereço. Analise cobertura, gaps geográficos. Se poucos/nenhum, destacar oportunidade first-mover.`
      ),

      callClaude(
        systemPrompt,
        `${contextBlock}

Gere EXATAMENTE estas 6 seções no JSON {"sections":[...]}:

1. "Estratégia de Marketing" — Google Maps, apps de recarga (PlugShare, Waze), parcerias com concessionárias EV, presença digital, sinalização. Ações práticas e específicas para ${form.city}.

2. "Plano Operacional" — Manutenção preventiva, monitoramento remoto via app, atendimento 24/7, gestão de energia, rotina operacional semanal/mensal.

3. "Receitas Extras e Oportunidades" — Mídia/publicidade no carregador, parcerias com estabelecimentos, clube de assinatura, créditos de carbono, locação publicitária digital, parcerias B2B frotas.

4. "Riscos e Mitigações" — Demanda inicial baixa, atrasos em obra, mudanças regulatórias, vandalismo, concorrência. Estratégia de mitigação para cada risco.

5. "Respondendo ao Desafio" — Personalize a resposta para o desafio que o cliente mencionou: "${form.challenges || 'Não informado'}". MAS nunca invente preços ou fórmulas. O preço de venda é R$ 2,00/kWh. Existem 3 cenários de energia: concessionária R$ 1,00/kWh, energia por assinatura com desconto de 20% (R$ 0,80/kWh), ou usina solar/mercado livre R$ 0,50/kWh. Fora isso não existe outra precificação. Se o cliente perguntou sobre precificação por região, explicar que o preço de venda R$ 2,00/kWh é competitivo nacionalmente e a variação real está no CUSTO da energia (que muda por concessionária). A margem vem da diferença entre custo e venda, não de cobrar preços diferentes.

6. "Próximos Passos" — Ações imediatas: assinatura de contrato, definição do ponto, início do projeto executivo. Terminar com: "Agende sua mentoria com a BLEV Educação para iniciar o acompanhamento personalizado. Contato: @guilhermegbbento"`
      ),
    ]);

    // PASSO 7 - Juntar seções fixas + seções do Claude na ordem correta
    // Seções fixas já estão em sections[0..8] (índices 0-8)
    // Inserir seções do Claude na posição correta

    // Claude 1: Sumário (depois da capa/blev/guilherme, antes do CAPEX)
    const sumario: BPSection = { number: 0, title: claudeSections1[0]?.title || "Sumário Executivo", content: claudeSections1[0]?.content || "" };
    const mercado: BPSection = { number: 0, title: claudeSections1[1]?.title || "Análise de Mercado", content: claudeSections1[1]?.content || "" };
    const concorrencia: BPSection = { number: 0, title: claudeSections1[2]?.title || "Análise de Concorrência", content: claudeSections1[2]?.content || "" };

    // Claude 2: Marketing, Operacional, Receitas, Riscos, Desafio, Próximos Passos
    const marketing: BPSection = { number: 0, title: claudeSections2[0]?.title || "Estratégia de Marketing", content: claudeSections2[0]?.content || "" };
    const operacional: BPSection = { number: 0, title: claudeSections2[1]?.title || "Plano Operacional", content: claudeSections2[1]?.content || "" };
    const receitas: BPSection = { number: 0, title: claudeSections2[2]?.title || "Receitas Extras e Oportunidades", content: claudeSections2[2]?.content || "" };
    const riscos: BPSection = { number: 0, title: claudeSections2[3]?.title || "Riscos e Mitigações", content: claudeSections2[3]?.content || "" };
    const desafio: BPSection = { number: 0, title: claudeSections2[4]?.title || "Respondendo ao Desafio", content: claudeSections2[4]?.content || "" };
    const proximosRaw = claudeSections2[5]?.content || "";
    const proximosPassosFallback = `1. Agende sua mentoria com a BLEV Educação para alinhar estratégia e cronograma de implementação.\n\n2. Visite os locais potenciais e avalie condições de instalação elétrica, acesso e visibilidade.\n\n3. Solicite orçamentos de pelo menos 3 fornecedores de carregadores DC ${pw}kW.\n\n4. Inicie a busca por usina solar para contrato de energia a R$ 0,50/kWh. A BLEV indica parceiros.\n\n5. Defina o modelo de contrato com o dono do espaço (aluguel fixo vs revenue share).\n\nContato: @guilhermegbbento\nBLEV Educação — A primeira empresa de educação em mobilidade elétrica do Brasil`;
    const proximos: BPSection = {
      number: 0,
      title: "PRÓXIMOS PASSOS",
      content: (proximosRaw && proximosRaw.trim().length > 10) ? proximosRaw : proximosPassosFallback,
    };

    // Montar ordem final
    // Remover seções fixas (último para primeiro) para reinserir na ordem correta
    const disclaimer = sections.pop()!; // DISCLAIMER
    const plano90Sec = sections.pop()!; // PLANO DE AÇÃO 90 DIAS
    const proj5AnosSec = sections.pop()!; // PROJEÇÃO 5 ANOS
    const payback = sections.pop()!; // PAYBACK E ROI
    const projSolar = sections.pop()!; // PROJEÇÃO SOLAR
    const projConc = sections.pop()!; // PROJEÇÃO CONCESSIONÁRIA
    const opexSec = sections.pop()!; // OPEX
    const capexSec = sections.pop()!; // CAPEX

    // sections agora tem: CAPA, BLEV, GUILHERME
    // Ordem final:
    const finalSections: BPSection[] = [
      sections[0],   // CAPA
      sections[1],   // BLEV EDUCAÇÃO
      sections[2],   // GUILHERME BENTO
      sumario,       // Sumário Executivo (Claude)
      mercado,       // Análise de Mercado (Claude)
      concorrencia,  // Análise de Concorrência (Claude)
      capexSec,      // CAPEX
      opexSec,       // OPEX
      projConc,      // Projeção Concessionária
      projSolar,     // Projeção Solar
      payback,       // Payback e ROI
      marketing,     // Marketing (Claude)
      operacional,   // Operacional (Claude)
      receitas,      // Receitas Extras (Claude)
      proj5AnosSec,  // Projeção 5 Anos (código)
      plano90Sec,    // Plano 90 Dias (código)
      riscos,        // Riscos (Claude)
      desafio,       // Desafio (Claude)
      proximos,      // Próximos Passos (Claude)
      disclaimer,    // Disclaimer
    ];

    // Filtrar seções com conteúdo vazio ou muito curto (exceto capa)
    const validSections = finalSections.filter((s, i) => {
      if (i === 0) return true; // capa sempre inclui
      return s.content && s.content.trim().length > 10;
    });

    // Renumerar sequencialmente
    validSections.forEach((s, i) => {
      s.number = i + 1;
    });

    // PASSO 8 - Salvar no Supabase e retornar
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    let bp_id: string | null = null;
    if (user) {
      const { data: inserted } = await supabase.from("business_plans").insert({
        user_id: user.id,
        client_name: form.client_name,
        client_email: form.email,
        client_phone: form.phone,
        city: form.city,
        state: form.state,
        capital_available: form.capital,
        objective: form.objective,
        challenges: form.challenges,
        priorities: form.priorities.join(", "),
        content_json: { sections: validSections, ibge: ibgeData, chargers_count: chargers.length },
        status: "done",
      }).select("id").single();
      bp_id = inserted?.id ?? null;
    }

    return Response.json({ sections: validSections, ibge: ibgeData, chargers_count: chargers.length, client_name: form.client_name, city: form.city, state: form.state, capex, bp_id });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("generate-bp: erro geral:", errorMessage);
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
