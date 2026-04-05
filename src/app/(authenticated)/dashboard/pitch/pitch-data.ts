import { ABVE_DATA } from "@/lib/abve-data";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PitchMode = "investidor" | "chave-na-mao";
export type InvestmentModel = "equity" | "debt" | "revenue-share";
export type ChargerType = "DC 40kW" | "DC 80kW";

export interface PitchFormData {
  mode: PitchMode;

  // Comum
  empresa: string;
  apresentador: string;
  cargo: string;
  cidade: string;
  estado: string;
  logoDataUrl: string | null;
  telefone: string;
  email: string;
  advisorBlev: boolean;

  // Dados da cidade (Panel 1 do M6)
  populacao: number;
  pibPerCapita: number;
  evsCidade: number;
  carregadoresExistentes: number;

  // Investidor
  investimentoBuscado: number;
  participacaoOferecida: number;
  qtdPontos: number;
  tipoCarregador: ChargerType;
  modelo: InvestmentModel;
  prazoMeses: number;
  diferenciais: string;

  // Chave na mão
  precoProjeto: number;
  inclui: string;
  qtdPontosChave: number;
  tipoCarregadorChave: ChargerType;
  garantias: string;
  suportePosVenda: string;
}

// ─── Charger CAPEX presets (mesma base da Calculadora) ──────────────────────

export const CHARGER_CAPEX: Record<ChargerType, { capex: number; potenciaKw: number }> = {
  "DC 40kW": { capex: 55000, potenciaKw: 40 },
  "DC 80kW": { capex: 100000, potenciaKw: 100 }, // matching calculator preset label of 100kW in breakdown
};

// ajuste: a Calculadora usa 80kW para DC 80kW label; manter coerente
CHARGER_CAPEX["DC 80kW"] = { capex: 100000, potenciaKw: 80 };

// ─── Finance calculation (mesmas fórmulas da Calculadora) ───────────────────

export interface FinanceResult {
  capexTotal: number;
  capexPorPonto: number;
  potenciaKw: number;
  qtdPontos: number;
  cenarios: Array<{
    horasDia: number;
    kwhMes: number;
    receitaEnergiaMes: number;
    custoEnergiaMes: number;
    despesasFixasMes: number;
    despesasVariaveisMes: number;
    lucroLiquidoMes: number;
    roiAnualPct: number;
    paybackMeses: number;
  }>;
}

export interface FinanceInputs {
  tipo: ChargerType;
  qtdPontos: number;
  precoVendaKwh?: number;
  custoKwh?: number;
  ocupacaoPct?: number;
  despesasFixasMesPorPonto?: number;
  pctVariaveis?: number; // gateway + impostos
}

export function calculateFinance({
  tipo,
  qtdPontos,
  precoVendaKwh = 2.2,
  custoKwh = 0.8,
  ocupacaoPct = 100,
  despesasFixasMesPorPonto = 524, // aluguel+internet+manut.
  pctVariaveis = 14, // 8 gateway + 6 impostos
}: FinanceInputs): FinanceResult {
  const { capex, potenciaKw } = CHARGER_CAPEX[tipo];
  const capexTotal = capex * qtdPontos;

  const horas = [4, 6, 9];
  const cenarios = horas.map((horasDia) => {
    const kwhMes = potenciaKw * horasDia * (ocupacaoPct / 100) * 30 * qtdPontos;
    const receitaEnergiaMes = kwhMes * precoVendaKwh;
    const custoEnergiaMes = kwhMes * custoKwh;
    const despesasFixasMes = despesasFixasMesPorPonto * qtdPontos;
    const despesasVariaveisMes = (receitaEnergiaMes * pctVariaveis) / 100;
    const lucroLiquidoMes =
      receitaEnergiaMes - custoEnergiaMes - despesasFixasMes - despesasVariaveisMes;
    const roiAnualPct = capexTotal > 0 ? ((lucroLiquidoMes * 12) / capexTotal) * 100 : 0;
    const paybackMeses = lucroLiquidoMes > 0 ? capexTotal / lucroLiquidoMes : Infinity;
    return {
      horasDia,
      kwhMes,
      receitaEnergiaMes,
      custoEnergiaMes,
      despesasFixasMes,
      despesasVariaveisMes,
      lucroLiquidoMes,
      roiAnualPct,
      paybackMeses,
    };
  });

  return {
    capexTotal,
    capexPorPonto: capex,
    potenciaKw,
    qtdPontos,
    cenarios,
  };
}

// ─── Slide content generation (template puro, sem IA) ───────────────────────

export interface Slide {
  n: number;
  title: string;
  subtitle?: string;
  kicker?: string;
  bodyHtml: string;
}

const fmtBR = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtNum = (v: number) => v.toLocaleString("pt-BR");

export function buildSlides(form: PitchFormData): Slide[] {
  const isInvestor = form.mode === "investidor";
  const today = new Date();
  const dataFmt = today.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const tipo = isInvestor ? form.tipoCarregador : form.tipoCarregadorChave;
  const qtd = isInvestor ? form.qtdPontos : form.qtdPontosChave;
  const finance = calculateFinance({ tipo, qtdPontos: qtd });
  const cenarioBase = finance.cenarios[1]; // 6h/dia

  const ratio =
    form.carregadoresExistentes > 0
      ? (form.evsCidade / form.carregadoresExistentes).toFixed(0)
      : "∞";

  const gapCarregadores = Math.max(
    0,
    Math.ceil(form.evsCidade / ABVE_DATA.ratioIdealEVsPorCarregador) - form.carregadoresExistentes
  );

  const slides: Slide[] = [];

  // ── Slide 1 — Capa ──
  slides.push({
    n: 1,
    kicker: isInvestor ? "OPORTUNIDADE DE INVESTIMENTO" : "PROJETO CHAVE NA MÃO",
    title: form.empresa || "Sua Empresa",
    subtitle: `Eletroposto ${form.cidade}${form.estado ? " / " + form.estado : ""}`,
    bodyHtml: `
      <div class="capa-meta">
        <div class="capa-nome">${escape(form.apresentador || "Apresentador")}</div>
        <div class="capa-cargo">${escape(form.cargo || "")}</div>
        <div class="capa-data">${dataFmt}</div>
        ${
          form.advisorBlev
            ? `<div class="capa-advisor">Advisor: <b>BLEV Educação</b></div>`
            : ""
        }
      </div>
    `,
  });

  // ── Slide 2 — O Mercado ──
  slides.push({
    n: 2,
    kicker: "O MERCADO",
    title: "Eletromobilidade no Brasil",
    bodyHtml: `
      <div class="stat-grid">
        <div class="stat">
          <div class="stat-num">${fmtNum(ABVE_DATA.vendas2025)}</div>
          <div class="stat-lbl">Veículos eletrificados vendidos em 2025 (+${ABVE_DATA.crescimento2025pct}%)</div>
        </div>
        <div class="stat">
          <div class="stat-num">${fmtNum(ABVE_DATA.bimestre2026)}</div>
          <div class="stat-lbl">Vendas jan–fev 2026 (+${ABVE_DATA.crescimentoBimestre2026pct}%)</div>
        </div>
        <div class="stat">
          <div class="stat-num">${(ABVE_DATA.projecaoABVE2026 / 1000).toFixed(0)}–${(ABVE_DATA.projecaoMercado2026 / 1000).toFixed(0)} mil</div>
          <div class="stat-lbl">Projeção ABVE 2026</div>
        </div>
        <div class="stat">
          <div class="stat-num">${fmtNum(ABVE_DATA.frotaAcumuladaFim2025)}</div>
          <div class="stat-lbl">Frota acumulada (fim 2025)</div>
        </div>
        <div class="stat">
          <div class="stat-num">${ABVE_DATA.marketShareFev2026pct}%</div>
          <div class="stat-lbl">Market share (fev/2026)</div>
        </div>
        <div class="stat">
          <div class="stat-num">1:10</div>
          <div class="stat-lbl">Ratio ideal EV por carregador (padrão IEA/AFIR)</div>
        </div>
      </div>
      <div class="source">Fonte: ${escape(ABVE_DATA.fonte)}</div>
    `,
  });

  // ── Slide 3 — O Problema ──
  slides.push({
    n: 3,
    kicker: "O PROBLEMA",
    title: "Infraestrutura insuficiente",
    bodyHtml: `
      <ul class="problem-list">
        <li><b>80%</b> do carregamento acontece em apenas <b>30%</b> das estações — concentração excessiva.</li>
        <li>Déficit de infraestrutura <b>crescendo mais rápido</b> que a implantação de novos pontos.</li>
        <li>Motoristas de aplicativo (Uber, 99) precisam de <b>carregamento rápido e confiável</b>.</li>
        <li>Frotas corporativas eletrificando — Mercado Livre, Amazon, iFood, Magalu já operam EVs.</li>
        <li>Poucos operadores com <b>cobertura nacional</b> → mercado aberto para novos entrantes regionais.</li>
      </ul>
    `,
  });

  // ── Slide 4 — A Oportunidade na Cidade ──
  slides.push({
    n: 4,
    kicker: "A OPORTUNIDADE",
    title: `${form.cidade || "Sua cidade"}${form.estado ? " / " + form.estado : ""}`,
    bodyHtml: `
      <div class="stat-grid">
        <div class="stat"><div class="stat-num">${fmtNum(form.populacao)}</div><div class="stat-lbl">Habitantes</div></div>
        <div class="stat"><div class="stat-num">${fmtBR(form.pibPerCapita)}</div><div class="stat-lbl">PIB per capita</div></div>
        <div class="stat"><div class="stat-num">${fmtNum(form.evsCidade)}</div><div class="stat-lbl">EVs acumulados</div></div>
        <div class="stat"><div class="stat-num">${form.carregadoresExistentes}</div><div class="stat-lbl">Carregadores existentes</div></div>
        <div class="stat"><div class="stat-num">1:${ratio}</div><div class="stat-lbl">Ratio atual EVs/carregador</div></div>
        <div class="stat"><div class="stat-num">${fmtNum(gapCarregadores)}</div><div class="stat-lbl">Gap até ratio ideal (1:10)</div></div>
      </div>
      <div class="highlight">
        Poucos players operando na cidade = <b>alta margem</b> e posição de <b>primeiro entrante</b>.
      </div>
    `,
  });

  // ── Slide 5 — O Projeto ──
  const projetoIntro = isInvestor
    ? `Plano de <b>${qtd}</b> carregador${qtd > 1 ? "es" : ""} <b>${tipo}</b>.`
    : `Projeto completo <b>chave na mão</b> com ${qtd} carregador${qtd > 1 ? "es" : ""} <b>${tipo}</b>.`;

  const inclui = isInvestor
    ? [
        `${qtd}× carregador ${tipo}`,
        "Instalação elétrica completa",
        "Adequação civil e licenças",
        "Sistema de gestão / app de cobrança",
        "90 dias da assinatura ao go-live",
      ]
    : (form.inclui || "Carregador, instalação, 12 meses de operação")
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);

  slides.push({
    n: 5,
    kicker: "O PROJETO",
    title: isInvestor ? "Plano de implantação" : "Escopo do projeto",
    bodyHtml: `
      <p class="lead">${projetoIntro}</p>
      <table class="tbl">
        <thead><tr><th>Item</th><th>Especificação</th></tr></thead>
        <tbody>
          <tr><td>Tipo de carregador</td><td>${tipo}</td></tr>
          <tr><td>Quantidade</td><td>${qtd}</td></tr>
          <tr><td>Potência unitária</td><td>${finance.potenciaKw} kW</td></tr>
          <tr><td>Potência total</td><td>${finance.potenciaKw * qtd} kW</td></tr>
          <tr><td>Timeline</td><td>90 dias da assinatura ao go-live</td></tr>
        </tbody>
      </table>
      <div class="sub-title">O que está incluído</div>
      <ul class="check-list">
        ${inclui.map((i) => `<li>${escape(i)}</li>`).join("")}
      </ul>
    `,
  });

  // ── Slide 6 — Projeção Financeira ──
  const capexRows = [
    { item: `Carregador ${tipo}`, valor: CHARGER_CAPEX[tipo].capex * qtd },
    { item: "Instalação elétrica", valor: 12000 * qtd },
    { item: "Adequação civil", valor: 5000 * qtd },
    { item: "Licenças e taxas", valor: 3000 * qtd },
  ];
  const capexTotal = capexRows.reduce((s, r) => s + r.valor, 0);

  slides.push({
    n: 6,
    kicker: "PROJEÇÃO FINANCEIRA",
    title: "Viabilidade do projeto",
    bodyHtml: `
      <div class="sub-title">CAPEX</div>
      <table class="tbl">
        <thead><tr><th>Item</th><th class="r">Valor</th></tr></thead>
        <tbody>
          ${capexRows
            .map(
              (r) => `<tr><td>${r.item}</td><td class="r">${fmtBR(r.valor)}</td></tr>`
            )
            .join("")}
          <tr class="total"><td>Total</td><td class="r">${fmtBR(capexTotal)}</td></tr>
        </tbody>
      </table>

      <div class="sub-title">Receita mensal projetada (cenários de utilização)</div>
      <table class="tbl">
        <thead>
          <tr>
            <th>Cenário</th>
            <th class="r">Receita</th>
            <th class="r">Lucro líquido</th>
            <th class="r">ROI a.a.</th>
            <th class="r">Payback</th>
          </tr>
        </thead>
        <tbody>
          ${finance.cenarios
            .map(
              (c) => `<tr>
                <td>${c.horasDia}h/dia</td>
                <td class="r">${fmtBR(c.receitaEnergiaMes)}</td>
                <td class="r">${fmtBR(c.lucroLiquidoMes)}</td>
                <td class="r">${c.roiAnualPct.toFixed(1)}%</td>
                <td class="r">${
                  c.paybackMeses === Infinity ? "—" : c.paybackMeses.toFixed(1) + " meses"
                }</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
      <div class="highlight">
        Cenário-base (6h/dia): ROI de <b>${cenarioBase.roiAnualPct.toFixed(1)}% a.a.</b> e payback em
        <b>${cenarioBase.paybackMeses === Infinity ? "—" : cenarioBase.paybackMeses.toFixed(1) + " meses"}</b>.
      </div>
    `,
  });

  // ── Slide 7 — Modelo de Negócio ──
  let modeloHtml = "";
  if (isInvestor) {
    if (form.modelo === "equity") {
      modeloHtml = `
        <div class="big-offer">
          <div class="big-label">Investimento</div>
          <div class="big-value">${fmtBR(form.investimentoBuscado)}</div>
          <div class="big-label">por</div>
          <div class="big-value">${form.participacaoOferecida}% de participação</div>
        </div>
        <p>Modelo <b>Equity</b>: o investidor torna-se sócio do projeto e recebe dividendos mensais proporcionais à sua participação. Prazo de referência: ${form.prazoMeses} meses.</p>
      `;
    } else if (form.modelo === "debt") {
      const jurosAnual = form.participacaoOferecida; // reaproveita campo como taxa %
      modeloHtml = `
        <div class="big-offer">
          <div class="big-label">Empréstimo</div>
          <div class="big-value">${fmtBR(form.investimentoBuscado)}</div>
          <div class="big-label">com retorno de</div>
          <div class="big-value">${jurosAnual}% ao ano</div>
        </div>
        <p>Modelo <b>Debt</b>: empréstimo com retorno contratual fixo. Prazo: ${form.prazoMeses} meses. Garantia: ativos do projeto.</p>
      `;
    } else {
      modeloHtml = `
        <div class="big-offer">
          <div class="big-label">Investimento</div>
          <div class="big-value">${fmtBR(form.investimentoBuscado)}</div>
          <div class="big-label">com retorno de</div>
          <div class="big-value">${form.participacaoOferecida}% do faturamento bruto</div>
        </div>
        <p>Modelo <b>Revenue Share</b>: o investidor recebe um percentual do faturamento bruto mensal. Prazo: ${form.prazoMeses} meses.</p>
      `;
    }
  } else {
    modeloHtml = `
      <div class="big-offer">
        <div class="big-label">Preço do projeto</div>
        <div class="big-value">${fmtBR(form.precoProjeto)}</div>
      </div>
      <p>Projeto <b>chave na mão</b>. Inclui equipamento, instalação, licenças e <b>12 meses de operação</b> assistida. A propriedade e a operação são transferidas ao cliente após o período inicial.</p>
      ${form.garantias ? `<p><b>Garantias:</b> ${escape(form.garantias)}</p>` : ""}
    `;
  }
  slides.push({
    n: 7,
    kicker: "MODELO DE NEGÓCIO",
    title: isInvestor ? "Condições do investimento" : "Condições comerciais",
    bodyHtml: modeloHtml,
  });

  // ── Slide 8 — Receitas Extras ──
  slides.push({
    n: 8,
    kicker: "RECEITAS EXTRAS",
    title: "Além da energia",
    bodyHtml: `
      <table class="tbl">
        <thead><tr><th>Fonte</th><th class="r">Potencial mensal</th></tr></thead>
        <tbody>
          <tr><td>Publicidade em totem</td><td class="r">R$ 2.500 – 15.000</td></tr>
          <tr><td>Clube de assinatura (R$ 50/membro)</td><td class="r">R$ 5.000 – 50.000</td></tr>
          <tr><td>Contratos com frotas (Uber, 99, delivery)</td><td class="r">R$ 8.000 – 40.000</td></tr>
          <tr><td>Programa de fidelidade motoristas app</td><td class="r">R$ 3.000 – 20.000</td></tr>
        </tbody>
      </table>
      <div class="highlight">Receitas adicionais podem representar <b>30 a 60%</b> do faturamento base.</div>
    `,
  });

  // ── Slide 9 — Equipe e Advisors ──
  slides.push({
    n: 9,
    kicker: "EQUIPE",
    title: "Quem está por trás",
    bodyHtml: `
      <div class="team-card">
        <div class="team-name">${escape(form.apresentador || "Apresentador")}</div>
        <div class="team-role">${escape(form.cargo || "")}${form.empresa ? " — " + escape(form.empresa) : ""}</div>
      </div>
      ${
        form.advisorBlev
          ? `
      <div class="team-card advisor">
        <div class="team-name">Guilherme Bento <span class="badge">Advisor</span></div>
        <div class="team-role">CREA-SC 156014-1 · Fundador BLEV Educação, EVVO, PLUGGO</div>
        <ul class="credentials">
          <li>+5.000 usinas solares implantadas</li>
          <li>+100 eletropostos operados ou projetados</li>
          <li>Ecossistema BLEV: educação + operação + tecnologia + inteligência</li>
        </ul>
      </div>`
          : ""
      }
    `,
  });

  // ── Slide 10 — Próximos Passos ──
  const passos = isInvestor
    ? [
        "Due diligence — validação dos dados do projeto e da cidade.",
        "Proposta formal com valuation e cronograma.",
        "Assinatura de contrato e captação.",
        "Início do projeto — 90 dias até o go-live.",
      ]
    : [
        "Aprovação da proposta comercial.",
        "Visita técnica ao ponto e validação elétrica.",
        "Assinatura de contrato.",
        "Instalação e entrega em 90 dias.",
      ];
  slides.push({
    n: 10,
    kicker: "PRÓXIMOS PASSOS",
    title: "Como avançar",
    bodyHtml: `
      <ol class="steps">
        ${passos.map((p) => `<li>${escape(p)}</li>`).join("")}
      </ol>
      <div class="contact">
        <div class="contact-line"><b>${escape(form.apresentador || "")}</b> — ${escape(form.cargo || "")}</div>
        ${form.email ? `<div class="contact-line">${escape(form.email)}</div>` : ""}
        ${form.telefone ? `<div class="contact-line">${escape(form.telefone)}</div>` : ""}
        ${form.advisorBlev ? `<div class="contact-line muted">Advisor: @guilhermegbbento — BLEV Educação</div>` : ""}
      </div>
    `,
  });

  return slides;
}

function escape(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Standalone HTML export ─────────────────────────────────────────────────

export function buildExportHtml(form: PitchFormData, slides: Slide[]): string {
  const title = `${form.empresa || "Pitch"} — ${form.cidade || ""}`;
  const logoHtml = form.logoDataUrl
    ? `<img src="${form.logoDataUrl}" alt="logo" class="logo-img" />`
    : `<div class="logo-text">${escape(form.empresa || "BLEV")}</div>`;

  const slidesHtml = slides
    .map(
      (s, idx) => `
    <section class="slide" id="slide-${s.n}" data-idx="${idx}">
      <div class="slide-inner">
        <div class="slide-header">
          <div class="slide-logo">${idx === 0 ? logoHtml : `<span class="mini-logo">${escape(form.empresa || "BLEV")}</span>`}</div>
          <div class="slide-counter">${s.n} / ${slides.length}</div>
        </div>
        ${s.kicker ? `<div class="kicker">${escape(s.kicker)}</div>` : ""}
        <h1 class="slide-title">${escape(s.title)}</h1>
        ${s.subtitle ? `<div class="subtitle">${escape(s.subtitle)}</div>` : ""}
        <div class="slide-body">${s.bodyHtml}</div>
      </div>
    </section>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escape(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    background: #0A0A0A;
    color: #F5F5F5;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    scroll-behavior: smooth;
    scroll-snap-type: y mandatory;
    overflow-y: scroll;
  }
  .slide {
    min-height: 100vh;
    scroll-snap-align: start;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 60px 80px;
    border-bottom: 1px solid #1a1a1a;
    position: relative;
  }
  .slide-inner { width: 100%; max-width: 1100px; }
  .slide-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 40px;
    padding-bottom: 16px;
    border-bottom: 1px solid #1e1e1e;
  }
  .slide-logo .logo-img { height: 48px; width: auto; }
  .slide-logo .logo-text, .mini-logo {
    color: #C9A84C;
    font-weight: 700;
    letter-spacing: 1px;
    font-size: 14px;
    text-transform: uppercase;
  }
  .slide-counter { color: #666; font-size: 12px; }
  .kicker {
    display: inline-block;
    color: #C9A84C;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 3px;
    text-transform: uppercase;
    padding: 6px 14px;
    border: 1px solid #C9A84C;
    border-radius: 999px;
    margin-bottom: 20px;
  }
  .slide-title {
    font-size: 56px;
    font-weight: 800;
    line-height: 1.1;
    margin-bottom: 16px;
    letter-spacing: -1px;
  }
  .subtitle {
    font-size: 22px;
    color: #C9A84C;
    margin-bottom: 32px;
    font-weight: 500;
  }
  .slide-body { font-size: 17px; line-height: 1.6; color: #D4D4D4; }
  .slide-body p { margin-bottom: 14px; }
  .lead { font-size: 20px; margin-bottom: 24px; }
  .sub-title {
    color: #C9A84C;
    font-size: 14px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 2px;
    margin: 24px 0 12px;
  }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
    margin: 24px 0;
  }
  .stat {
    background: #111;
    border: 1px solid #222;
    border-radius: 14px;
    padding: 24px;
    text-align: center;
  }
  .stat-num {
    color: #C9A84C;
    font-size: 40px;
    font-weight: 800;
    line-height: 1;
    margin-bottom: 8px;
  }
  .stat-lbl { color: #999; font-size: 12px; }

  .tbl {
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0;
    font-size: 15px;
  }
  .tbl thead th {
    background: #1a1a1a;
    color: #C9A84C;
    text-align: left;
    padding: 14px 16px;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .tbl thead th.r, .tbl td.r { text-align: right; }
  .tbl tbody td {
    padding: 14px 16px;
    border-bottom: 1px solid #1a1a1a;
    color: #D4D4D4;
  }
  .tbl tbody tr.total td {
    background: #C9A84C15;
    color: #C9A84C;
    font-weight: 700;
    border-top: 2px solid #C9A84C;
  }

  .highlight {
    background: #C9A84C12;
    border-left: 3px solid #C9A84C;
    padding: 18px 22px;
    margin: 20px 0;
    border-radius: 6px;
    color: #E8E8E8;
  }
  .highlight b { color: #C9A84C; }

  .problem-list, .check-list, .steps, .credentials {
    list-style: none;
    padding: 0;
  }
  .problem-list li, .check-list li, .credentials li {
    padding: 12px 0 12px 28px;
    position: relative;
    border-bottom: 1px solid #1a1a1a;
  }
  .problem-list li:before, .check-list li:before, .credentials li:before {
    content: "▸";
    color: #C9A84C;
    position: absolute;
    left: 4px;
    font-weight: 700;
  }
  .steps { counter-reset: step; }
  .steps li {
    counter-increment: step;
    padding: 14px 0 14px 48px;
    position: relative;
    border-bottom: 1px solid #1a1a1a;
    font-size: 17px;
  }
  .steps li:before {
    content: counter(step);
    position: absolute;
    left: 0;
    top: 14px;
    width: 32px;
    height: 32px;
    background: #C9A84C;
    color: #0A0A0A;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
  }

  .big-offer {
    text-align: center;
    padding: 40px 20px;
    background: #111;
    border: 1px solid #C9A84C40;
    border-radius: 16px;
    margin: 24px 0;
  }
  .big-label {
    color: #888;
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 2px;
    margin: 12px 0 6px;
  }
  .big-value {
    color: #C9A84C;
    font-size: 48px;
    font-weight: 800;
    line-height: 1.1;
  }

  .team-card {
    background: #111;
    border: 1px solid #222;
    border-radius: 14px;
    padding: 24px;
    margin: 16px 0;
  }
  .team-card.advisor {
    border-color: #C9A84C40;
    background: #C9A84C08;
  }
  .team-name {
    color: #F5F5F5;
    font-size: 22px;
    font-weight: 700;
    margin-bottom: 6px;
  }
  .team-name .badge {
    display: inline-block;
    background: #C9A84C;
    color: #0A0A0A;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 999px;
    margin-left: 8px;
    vertical-align: middle;
  }
  .team-role { color: #999; font-size: 14px; margin-bottom: 12px; }

  .contact {
    margin-top: 32px;
    padding: 20px 24px;
    background: #111;
    border-left: 3px solid #C9A84C;
    border-radius: 6px;
  }
  .contact-line { color: #D4D4D4; padding: 3px 0; }
  .contact-line.muted { color: #888; font-size: 13px; }

  .capa-meta { margin-top: 32px; }
  .capa-nome { font-size: 26px; color: #F5F5F5; font-weight: 600; }
  .capa-cargo { font-size: 16px; color: #999; margin-bottom: 20px; }
  .capa-data { color: #666; font-size: 14px; }
  .capa-advisor {
    margin-top: 24px;
    display: inline-block;
    padding: 8px 16px;
    background: #C9A84C15;
    border: 1px solid #C9A84C;
    border-radius: 999px;
    color: #C9A84C;
    font-size: 13px;
  }

  .source {
    margin-top: 16px;
    color: #666;
    font-size: 12px;
    font-style: italic;
  }

  .nav {
    position: fixed;
    right: 30px;
    bottom: 30px;
    display: flex;
    gap: 10px;
    z-index: 100;
  }
  .nav button {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: #C9A84C;
    color: #0A0A0A;
    border: none;
    font-size: 20px;
    font-weight: 800;
    cursor: pointer;
    box-shadow: 0 4px 20px #C9A84C40;
    transition: transform 0.15s;
  }
  .nav button:hover { transform: scale(1.08); }
  .nav button:disabled { opacity: 0.35; cursor: default; }

  @media (max-width: 820px) {
    .slide { padding: 40px 24px; }
    .slide-title { font-size: 36px; }
    .stat-grid { grid-template-columns: 1fr 1fr; }
    .big-value { font-size: 32px; }
  }
</style>
</head>
<body>
  ${slidesHtml}
  <div class="nav">
    <button id="prevBtn" aria-label="Anterior">‹</button>
    <button id="nextBtn" aria-label="Próximo">›</button>
  </div>
  <script>
    const slides = document.querySelectorAll('.slide');
    let idx = 0;
    function go(i) {
      idx = Math.max(0, Math.min(slides.length - 1, i));
      slides[idx].scrollIntoView({ behavior: 'smooth' });
      document.getElementById('prevBtn').disabled = idx === 0;
      document.getElementById('nextBtn').disabled = idx === slides.length - 1;
    }
    document.getElementById('prevBtn').addEventListener('click', () => go(idx - 1));
    document.getElementById('nextBtn').addEventListener('click', () => go(idx + 1));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); go(idx + 1); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); go(idx - 1); }
    });
    // Track scroll position for button state
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          idx = parseInt(e.target.dataset.idx, 10);
          document.getElementById('prevBtn').disabled = idx === 0;
          document.getElementById('nextBtn').disabled = idx === slides.length - 1;
        }
      });
    }, { threshold: 0.5 });
    slides.forEach((s) => io.observe(s));
  </script>
</body>
</html>`;
}
