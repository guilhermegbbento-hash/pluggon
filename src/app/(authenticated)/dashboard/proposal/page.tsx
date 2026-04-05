"use client";

import { useState, useRef } from "react";

// ─── Types ───────────────────────────────────────────────────────────
interface FormData {
  // Mentorado
  nomeEmpresa: string;
  nomeSocio: string;
  telefone: string;
  email: string;
  cidadeEstado: string;
  cnpj: string;
  advisor: boolean;

  // Dono do Ponto
  nomeEstabelecimento: string;
  nomeResponsavel: string;
  tipoEstabelecimento: string;
  endereco: string;

  // Configuração
  tipoCarregador: string;
  qtdCarregadores: number;
  modeloParceria: string;
  valorAluguel: number;
  percentualShare: number;
  prazoContrato: number;

  // Revenue Share + Bônus
  percentualBase: number;
  horasGatilho: number;
  percentualBonus: number;
}

const TIPOS_ESTABELECIMENTO = [
  "Shopping", "Posto de Combustível", "Estacionamento", "Terreno", "Hotel",
  "Supermercado", "Hospital", "Universidade", "Restaurante", "Outro",
];

const TIPOS_CARREGADOR: Record<string, { potencia: number; label: string }> = {
  "AC 7kW": { potencia: 7, label: "AC 7kW" },
  "DC 40kW": { potencia: 40, label: "DC 40kW" },
  "DC 80kW": { potencia: 80, label: "DC 80kW" },
};

const MODELOS_PARCERIA = [
  "Aluguel Fixo Mensal",
  "Revenue Share % do Faturamento Bruto",
  "Revenue Share % do Lucro Líquido",
  "Revenue Share + Bônus por Performance",
];

const PRAZOS = [12, 24, 36, 48, 60];

const PRECO_VENDA = 2.0;

const CENARIOS: { nome: string; horas: number }[] = [
  { nome: "Conservador", horas: 4 },
  { nome: "Moderado", horas: 6 },
  { nome: "Otimista", horas: 9 },
  { nome: "Máximo", horas: 12 },
];

// ─── Financial Helpers ───────────────────────────────────────────────
function calcCenario(potencia: number, horas: number, qtd: number) {
  const faturamento = potencia * horas * PRECO_VENDA * 30 * qtd;
  return faturamento;
}

function calcParticipacao(
  form: FormData,
  faturamento: number,
  horasDia: number,
  potencia: number,
  qtd: number,
) {
  if (form.modeloParceria === "Aluguel Fixo Mensal") {
    return form.valorAluguel;
  }
  if (form.modeloParceria === "Revenue Share % do Faturamento Bruto") {
    return faturamento * (form.percentualShare / 100);
  }
  if (form.modeloParceria === "Revenue Share % do Lucro Líquido") {
    const custoEnergia = potencia * horasDia * 1.0 * 30 * qtd;
    const opex = faturamento * 0.14 + 474 * qtd;
    const lucro = faturamento - custoEnergia - opex;
    return Math.max(0, lucro) * (form.percentualShare / 100);
  }
  // Revenue Share + Bônus por Performance
  let participacao = faturamento * (form.percentualBase / 100);
  if (horasDia > form.horasGatilho) {
    const faturamentoExcedente =
      potencia * (horasDia - form.horasGatilho) * PRECO_VENDA * 30 * qtd;
    participacao += faturamentoExcedente * (form.percentualBonus / 100);
  }
  return participacao;
}

function fmt(v: number) {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Component ───────────────────────────────────────────────────────
export default function ProposalPage() {
  const [form, setForm] = useState<FormData>({
    nomeEmpresa: "",
    nomeSocio: "",
    telefone: "",
    email: "",
    cidadeEstado: "",
    cnpj: "",
    advisor: true,
    nomeEstabelecimento: "",
    nomeResponsavel: "",
    tipoEstabelecimento: "Shopping",
    endereco: "",
    tipoCarregador: "DC 80kW",
    qtdCarregadores: 1,
    modeloParceria: "Revenue Share % do Faturamento Bruto",
    valorAluguel: 1500,
    percentualShare: 10,
    prazoContrato: 36,
    percentualBase: 10,
    horasGatilho: 6,
    percentualBonus: 20,
  });

  const [showPreview, setShowPreview] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const upd = (field: keyof FormData, value: string | number | boolean) =>
    setForm((p) => ({ ...p, [field]: value }));

  const cfg = TIPOS_CARREGADOR[form.tipoCarregador] || TIPOS_CARREGADOR["DC 80kW"];

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setLogoUrl(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  }

  // ── Parceria text builder ──
  function parceriaText() {
    const potencia = cfg.potencia;
    const qtd = form.qtdCarregadores;
    if (form.modeloParceria === "Aluguel Fixo Mensal") {
      return `Pagamento mensal fixo de R$ ${fmt(form.valorAluguel)} pelo uso do espaço, independente do faturamento. Você recebe mesmo nos meses de baixa utilização.`;
    }
    if (form.modeloParceria === "Revenue Share % do Faturamento Bruto") {
      const fat = calcCenario(potencia, 6, qtd);
      const part = fat * (form.percentualShare / 100);
      return `Você recebe ${form.percentualShare}% de todo o faturamento bruto do eletroposto. Exemplo com cenário moderado (6h/dia): faturamento de R$ ${fmt(fat)}, sua participação de R$ ${fmt(part)}/mês.`;
    }
    if (form.modeloParceria === "Revenue Share % do Lucro Líquido") {
      return `Você recebe ${form.percentualShare}% do lucro líquido da operação, descontados custos de energia e operação.`;
    }
    // Revenue Share + Bônus
    return `Você recebe ${form.percentualBase}% do faturamento bruto como base. Se a utilização ultrapassar ${form.horasGatilho}h/dia, você recebe adicional de ${form.percentualBonus}% sobre o faturamento excedente.`;
  }

  // ── Footer helper ──
  function footerContent() {
    return form.nomeEmpresa + (form.advisor ? " | Advisor: BLEV Educação" : "");
  }

  // ── Export HTML ──
  function exportHTML() {
    if (!previewRef.current) return;
    const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Proposta Comercial - ${form.nomeEmpresa || "Eletroposto"}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Georgia,serif;color:#1a1a1a;background:#fff}
.cover{background:#0A0A0A;color:#fff;min-height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:60px 40px;page-break-after:always}
.cover h1{color:#C9A84C;font-size:42px;margin-bottom:12px;letter-spacing:2px}
.cover h2{color:#C9A84C;font-size:28px;margin-bottom:24px}
.cover p{color:#ccc;font-size:18px;margin:6px 0}
.cover .advisor{color:#C9A84C;font-size:14px;margin-top:40px;border-top:1px solid #333;padding-top:20px}
.page{padding:60px 50px;min-height:100vh;page-break-after:always}
.page h2{color:#C9A84C;font-size:26px;border-bottom:3px solid #C9A84C;padding-bottom:8px;margin-bottom:24px}
.page p,.page li{font-size:16px;line-height:1.8;margin-bottom:12px}
.page ul{padding-left:24px}
.page li::marker{color:#C9A84C}
table{width:100%;border-collapse:collapse;margin:20px 0}
th{background:#C9A84C;color:#0A0A0A;padding:12px 16px;text-align:left;font-size:14px}
td{padding:12px 16px;border-bottom:1px solid #e0e0e0;font-size:15px}
.highlight{background:#FFF9E6;border-left:4px solid #C9A84C;padding:16px 20px;margin:20px 0;border-radius:0 8px 8px 0}
.steps{counter-reset:step}
.steps li{counter-increment:step;list-style:none;position:relative;padding-left:40px;margin-bottom:16px}
.steps li::before{content:counter(step);position:absolute;left:0;background:#C9A84C;color:#0A0A0A;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:14px}
.footer{text-align:center;font-size:12px;color:#999;border-top:1px solid #e0e0e0;padding-top:12px;margin-top:40px}
.bar-chart .bar{background:linear-gradient(90deg,#C9A84C,#E8D48B);height:32px;border-radius:4px;display:flex;align-items:center;padding-left:12px;font-size:13px;font-weight:bold;color:#0A0A0A;margin-bottom:8px}
.gold-number{color:#C9A84C;font-size:32px;font-weight:bold}
@media print{.page{min-height:auto}.cover{min-height:auto;padding:40px}}
</style></head><body>
${previewRef.current.innerHTML}
</body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Proposta_${form.nomeEstabelecimento || "Eletroposto"}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Export PDF (print) ──
  function exportPDF() {
    const printContent = previewRef.current;
    if (!printContent) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<title>Proposta Comercial - ${form.nomeEmpresa || "Eletroposto"}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Georgia,serif;color:#1a1a1a;background:#fff}
.cover{background:#0A0A0A;color:#fff;min-height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:60px 40px;page-break-after:always;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.cover h1{color:#C9A84C;font-size:42px;margin-bottom:12px;letter-spacing:2px}
.cover h2{color:#C9A84C;font-size:28px;margin-bottom:24px}
.cover p{color:#ccc;font-size:18px;margin:6px 0}
.cover .advisor{color:#C9A84C;font-size:14px;margin-top:40px;border-top:1px solid #333;padding-top:20px}
.page{padding:60px 50px;min-height:100vh;page-break-after:always}
.page h2{color:#C9A84C;font-size:26px;border-bottom:3px solid #C9A84C;padding-bottom:8px;margin-bottom:24px}
.page p,.page li{font-size:16px;line-height:1.8;margin-bottom:12px}
.page ul{padding-left:24px}
.page li::marker{color:#C9A84C}
table{width:100%;border-collapse:collapse;margin:20px 0}
th{background:#C9A84C;color:#0A0A0A;padding:12px 16px;text-align:left;font-size:14px;print-color-adjust:exact;-webkit-print-color-adjust:exact}
td{padding:12px 16px;border-bottom:1px solid #e0e0e0;font-size:15px}
.highlight{background:#FFF9E6;border-left:4px solid #C9A84C;padding:16px 20px;margin:20px 0;border-radius:0 8px 8px 0;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.steps{counter-reset:step}
.steps li{counter-increment:step;list-style:none;position:relative;padding-left:40px;margin-bottom:16px}
.steps li::before{content:counter(step);position:absolute;left:0;background:#C9A84C;color:#0A0A0A;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:14px;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.footer{text-align:center;font-size:12px;color:#999;border-top:1px solid #e0e0e0;padding-top:12px;margin-top:40px}
.bar-chart .bar{background:linear-gradient(90deg,#C9A84C,#E8D48B);height:32px;border-radius:4px;display:flex;align-items:center;padding-left:12px;font-size:13px;font-weight:bold;color:#0A0A0A;margin-bottom:8px;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.gold-number{color:#C9A84C;font-size:32px;font-weight:bold}
@media print{body{background:#fff}.page{min-height:auto}}
@page{size:A4;margin:0}
</style></head><body>
${printContent.innerHTML}
</body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 600);
  }

  // ─── Input helpers ───────────────────────────────────────────────
  const inputCls = "w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-2.5 text-sm text-white placeholder-[#484F58] focus:border-[#C9A84C] focus:outline-none transition-colors";
  const selectCls = inputCls;
  const labelCls = "block text-sm font-medium text-[#8B949E] mb-1.5";

  // ── Cenários calc ──
  const potencia = cfg.potencia;
  const qtd = form.qtdCarregadores;
  const cenarios = CENARIOS.map((c) => {
    const fat = calcCenario(potencia, c.horas, qtd);
    const part = calcParticipacao(form, fat, c.horas, potencia, qtd);
    return { ...c, faturamento: fat, participacao: part };
  });
  const maxFat = Math.max(...cenarios.map((c) => c.faturamento));

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Proposta Comercial</h1>
        <p className="text-[#8B949E] mt-1">
          Gere uma proposta profissional para apresentar ao dono do ponto
        </p>
      </div>

      {!showPreview ? (
        /* ═══════ FORM ═══════ */
        <div className="space-y-6">
          {/* ── Dados do Mentorado ── */}
          <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-6">
            <h2 className="text-lg font-semibold text-[#C9A84C] mb-4">Dados da Sua Empresa</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Nome da Empresa *</label>
                <input className={inputCls} placeholder='Ex: "EV Charge Goiânia"' value={form.nomeEmpresa} onChange={(e) => upd("nomeEmpresa", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Sócio / Representante *</label>
                <input className={inputCls} placeholder="Nome completo" value={form.nomeSocio} onChange={(e) => upd("nomeSocio", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Telefone *</label>
                <input className={inputCls} placeholder="(62) 99999-0000" value={form.telefone} onChange={(e) => upd("telefone", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Email *</label>
                <input className={inputCls} placeholder="contato@evcharge.com.br" value={form.email} onChange={(e) => upd("email", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Cidade / Estado *</label>
                <input className={inputCls} placeholder="Goiânia - GO" value={form.cidadeEstado} onChange={(e) => upd("cidadeEstado", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>CNPJ (opcional)</label>
                <input className={inputCls} placeholder="00.000.000/0001-00" value={form.cnpj} onChange={(e) => upd("cnpj", e.target.value)} />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-6">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={form.advisor} onChange={(e) => upd("advisor", e.target.checked)} className="h-4 w-4 rounded border-[#30363D] bg-[#0D1117] text-[#C9A84C] focus:ring-[#C9A84C]" />
                <span className="text-sm text-[#8B949E]">Advisor: <strong className="text-[#C9A84C]">BLEV Educação</strong></span>
              </label>
            </div>
            <div className="mt-4">
              <label className={labelCls}>Logo da Empresa (opcional)</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="block w-full text-sm text-[#8B949E] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[#C9A84C] file:text-[#0D1117] hover:file:bg-[#B89443] file:cursor-pointer"
              />
              {logoUrl && (
                <div className="mt-2 flex items-center gap-3">
                  <img src={logoUrl} alt="Logo" className="h-12 rounded" />
                  <button onClick={() => setLogoUrl(null)} className="text-xs text-red-400 hover:text-red-300">Remover</button>
                </div>
              )}
            </div>
          </div>

          {/* ── Dados do Dono do Ponto ── */}
          <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-6">
            <h2 className="text-lg font-semibold text-[#C9A84C] mb-4">Dados do Estabelecimento</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Nome do Estabelecimento *</label>
                <input className={inputCls} placeholder='Ex: "Shopping West Side"' value={form.nomeEstabelecimento} onChange={(e) => upd("nomeEstabelecimento", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Responsável / Contato</label>
                <input className={inputCls} placeholder="Nome do responsável" value={form.nomeResponsavel} onChange={(e) => upd("nomeResponsavel", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Tipo de Estabelecimento</label>
                <select className={selectCls} value={form.tipoEstabelecimento} onChange={(e) => upd("tipoEstabelecimento", e.target.value)}>
                  {TIPOS_ESTABELECIMENTO.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Endereço</label>
                <input className={inputCls} placeholder="Rua, número, bairro" value={form.endereco} onChange={(e) => upd("endereco", e.target.value)} />
              </div>
            </div>
          </div>

          {/* ── Configuração da Proposta ── */}
          <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-6">
            <h2 className="text-lg font-semibold text-[#C9A84C] mb-4">Configuração da Proposta</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Tipo de Carregador</label>
                <select className={selectCls} value={form.tipoCarregador} onChange={(e) => upd("tipoCarregador", e.target.value)}>
                  {Object.keys(TIPOS_CARREGADOR).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Quantidade de Carregadores</label>
                <select className={selectCls} value={form.qtdCarregadores} onChange={(e) => upd("qtdCarregadores", Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Prazo do Contrato</label>
                <select className={selectCls} value={form.prazoContrato} onChange={(e) => upd("prazoContrato", Number(e.target.value))}>
                  {PRAZOS.map((p) => <option key={p} value={p}>{p} meses</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Modelo de Parceria</label>
                <select className={selectCls} value={form.modeloParceria} onChange={(e) => {
                  const v = e.target.value;
                  upd("modeloParceria", v);
                  if (v === "Revenue Share % do Lucro Líquido") upd("percentualShare", 15);
                  else if (v === "Revenue Share % do Faturamento Bruto") upd("percentualShare", 10);
                }}>
                  {MODELOS_PARCERIA.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              {/* Dynamic fields for partnership model */}
              {form.modeloParceria === "Aluguel Fixo Mensal" && (
                <div>
                  <label className={labelCls}>Valor Aluguel (R$/mês)</label>
                  <input type="number" className={inputCls} value={form.valorAluguel} onChange={(e) => upd("valorAluguel", Number(e.target.value))} />
                </div>
              )}
              {(form.modeloParceria === "Revenue Share % do Faturamento Bruto" || form.modeloParceria === "Revenue Share % do Lucro Líquido") && (
                <div>
                  <label className={labelCls}>Percentual (%)</label>
                  <input type="number" className={inputCls} value={form.percentualShare} onChange={(e) => upd("percentualShare", Number(e.target.value))} min={1} max={50} />
                </div>
              )}
              {form.modeloParceria === "Revenue Share + Bônus por Performance" && (
                <>
                  <div>
                    <label className={labelCls}>% Base do Faturamento Bruto</label>
                    <input type="number" className={inputCls} value={form.percentualBase} onChange={(e) => upd("percentualBase", Number(e.target.value))} min={1} max={50} />
                  </div>
                  <div>
                    <label className={labelCls}>Horas Gatilho (h/dia)</label>
                    <input type="number" className={inputCls} value={form.horasGatilho} onChange={(e) => upd("horasGatilho", Number(e.target.value))} min={1} max={24} />
                  </div>
                  <div>
                    <label className={labelCls}>% Bônus acima do Gatilho</label>
                    <input type="number" className={inputCls} value={form.percentualBonus} onChange={(e) => upd("percentualBonus", Number(e.target.value))} min={1} max={100} />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Generate Button ── */}
          <div className="flex justify-center">
            <button
              onClick={() => setShowPreview(true)}
              disabled={!form.nomeEmpresa || !form.nomeSocio || !form.nomeEstabelecimento}
              className="px-8 py-3 rounded-lg bg-[#C9A84C] text-[#0D1117] font-bold text-base hover:bg-[#B89443] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Gerar Proposta
            </button>
          </div>
        </div>
      ) : (
        /* ═══════ PREVIEW + EXPORT ═══════ */
        <div className="space-y-4">
          {/* Action bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => setShowPreview(false)} className="px-4 py-2 rounded-lg border border-[#30363D] text-[#8B949E] hover:text-white hover:border-[#C9A84C] transition-colors text-sm">
              ← Voltar ao Formulário
            </button>
            <button onClick={exportPDF} className="px-5 py-2 rounded-lg bg-[#C9A84C] text-[#0D1117] font-semibold text-sm hover:bg-[#B89443] transition-colors">
              Exportar PDF
            </button>
            <button onClick={exportHTML} className="px-5 py-2 rounded-lg border border-[#C9A84C] text-[#C9A84C] font-semibold text-sm hover:bg-[#C9A84C] hover:text-[#0D1117] transition-colors">
              Exportar HTML
            </button>
          </div>

          {/* Preview Container */}
          <div className="rounded-xl border border-[#30363D] overflow-hidden">
            <div ref={previewRef}>
              {/* ── PAGE 1: CAPA ── */}
              <div className="cover" style={{ background: "#0A0A0A", color: "#fff", minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", padding: "60px 40px", fontFamily: "Georgia, serif" }}>
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo" style={{ maxHeight: 80, marginBottom: 32, borderRadius: 8 }} />
                ) : (
                  <p style={{ color: "#C9A84C", fontSize: 14, letterSpacing: 4, marginBottom: 40, textTransform: "uppercase" }}>
                    {form.nomeEmpresa || "Sua Empresa"}
                  </p>
                )}
                <h1 style={{ color: "#C9A84C", fontSize: 42, marginBottom: 12, letterSpacing: 2 }}>PROPOSTA COMERCIAL</h1>
                <h2 style={{ color: "#C9A84C", fontSize: 28, marginBottom: 32 }}>ELETROPOSTO {form.tipoCarregador}</h2>
                <p style={{ color: "#ccc", fontSize: 18, marginBottom: 8 }}>Para: <strong style={{ color: "#fff" }}>{form.nomeEstabelecimento || "Estabelecimento"}</strong></p>
                <p style={{ color: "#ccc", fontSize: 16, marginBottom: 6 }}>Apresentado por: {form.nomeSocio || "Sócio"} — {form.nomeEmpresa || "Empresa"}</p>
                <p style={{ color: "#666", fontSize: 14, marginTop: 8 }}>{new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}</p>
                {form.advisor && (
                  <div className="advisor" style={{ color: "#C9A84C", fontSize: 14, marginTop: 40, borderTop: "1px solid #333", paddingTop: 20 }}>
                    Com apoio técnico da <strong>BLEV Educação</strong>
                  </div>
                )}
              </div>

              {/* ── PAGE 2: O MERCADO ── */}
              <div className="page" style={{ padding: "60px 50px", minHeight: "100vh", fontFamily: "Georgia, serif", background: "#fff" }}>
                <h2 style={{ color: "#C9A84C", fontSize: 26, borderBottom: "3px solid #C9A84C", paddingBottom: 8, marginBottom: 24 }}>O Mercado de Veículos Elétricos</h2>

                <p style={{ fontSize: 16, lineHeight: 1.8, color: "#1a1a1a", marginBottom: 16 }}>
                  O mercado de veículos elétricos no Brasil cresceu 61% em 2025, com mais de 285.000 unidades vendidas. A projeção para 2026 é de 280.000-300.000 veículos, com frota acumulada de 600.000 EVs.
                </p>
                <p style={{ fontSize: 16, lineHeight: 1.8, color: "#1a1a1a", marginBottom: 16 }}>
                  A infraestrutura de carregamento não acompanha esse crescimento — existe uma demanda real e urgente por mais pontos de recarga.
                </p>
                <div className="highlight" style={{ background: "#FFF9E6", borderLeft: "4px solid #C9A84C", padding: "16px 20px", margin: "20px 0", borderRadius: "0 8px 8px 0" }}>
                  <p style={{ fontSize: 16, lineHeight: 1.8, color: "#1a1a1a", margin: 0 }}>
                    <strong>Instalar um eletroposto no seu estabelecimento posiciona seu negócio na vanguarda da mobilidade elétrica.</strong>
                  </p>
                </div>
                <div className="footer" style={{ textAlign: "center", fontSize: 12, color: "#999", borderTop: "1px solid #e0e0e0", paddingTop: 12, marginTop: 40 }}>
                  {footerContent()}
                </div>
              </div>

              {/* ── PAGE 3: BENEFÍCIOS ── */}
              <div className="page" style={{ padding: "60px 50px", minHeight: "100vh", fontFamily: "Georgia, serif", background: "#fff" }}>
                <h2 style={{ color: "#C9A84C", fontSize: 26, borderBottom: "3px solid #C9A84C", paddingBottom: 8, marginBottom: 24 }}>Benefícios para o {form.tipoEstabelecimento}</h2>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {[
                    { title: "Público Premium", text: "Donos de veículos elétricos têm renda média 3x superior à média nacional" },
                    { title: "Mais Permanência", text: "Carregamento leva 30-60 minutos, tempo ideal para consumo no seu estabelecimento" },
                    { title: "Diferencial Competitivo", text: "Seja o primeiro da região a oferecer carregamento para veículos elétricos" },
                    { title: "Receita Extra", text: "Modelo de parceria sem investimento da sua parte — receita passiva mensal" },
                    { title: "Sustentabilidade", text: "Posicione sua marca como comprometida com o meio ambiente e ESG" },
                    { title: "Visibilidade Digital", text: "Seu estabelecimento aparece no Google Maps, Waze, PlugShare e apps de EV" },
                  ].map((b, i) => (
                    <li key={i} style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 18, fontSize: 16, lineHeight: 1.8, color: "#1a1a1a" }}>
                      <span style={{ color: "#C9A84C", fontSize: 20, lineHeight: 1, flexShrink: 0 }}>&#9679;</span>
                      <span><strong style={{ color: "#C9A84C" }}>{b.title}</strong> — {b.text}</span>
                    </li>
                  ))}
                </ul>
                <div className="footer" style={{ textAlign: "center", fontSize: 12, color: "#999", borderTop: "1px solid #e0e0e0", paddingTop: 12, marginTop: 40 }}>
                  {footerContent()}
                </div>
              </div>

              {/* ── PAGE 4: A PROPOSTA ── */}
              <div className="page" style={{ padding: "60px 50px", minHeight: "100vh", fontFamily: "Georgia, serif", background: "#fff" }}>
                <h2 style={{ color: "#C9A84C", fontSize: 26, borderBottom: "3px solid #C9A84C", paddingBottom: 8, marginBottom: 24 }}>A Proposta</h2>
                <p style={{ fontSize: 18, lineHeight: 1.8, color: "#1a1a1a", marginBottom: 24 }}>
                  Propomos instalar <strong>{form.qtdCarregadores}x carregador{form.qtdCarregadores > 1 ? "es" : ""} {form.tipoCarregador}</strong> no <strong>{form.nomeEstabelecimento || "seu estabelecimento"}</strong>.
                </p>

                {/* Tabela equipamento: sem coluna investimento */}
                <table style={{ width: "100%", borderCollapse: "collapse", margin: "20px 0" }}>
                  <thead>
                    <tr>
                      <th style={{ background: "#C9A84C", color: "#0A0A0A", padding: "12px 16px", textAlign: "left", fontSize: 14 }}>Equipamento</th>
                      <th style={{ background: "#C9A84C", color: "#0A0A0A", padding: "12px 16px", textAlign: "center", fontSize: 14 }}>Potência</th>
                      <th style={{ background: "#C9A84C", color: "#0A0A0A", padding: "12px 16px", textAlign: "center", fontSize: 14 }}>Quantidade</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: "12px 16px", borderBottom: "1px solid #e0e0e0", fontSize: 15 }}>Carregador {cfg.label}</td>
                      <td style={{ padding: "12px 16px", borderBottom: "1px solid #e0e0e0", fontSize: 15, textAlign: "center" }}>{cfg.potencia} kW</td>
                      <td style={{ padding: "12px 16px", borderBottom: "1px solid #e0e0e0", fontSize: 15, textAlign: "center" }}>{form.qtdCarregadores}</td>
                    </tr>
                  </tbody>
                </table>

                <div className="highlight" style={{ background: "#FFF9E6", borderLeft: "4px solid #C9A84C", padding: "16px 20px", margin: "24px 0", borderRadius: "0 8px 8px 0" }}>
                  <p style={{ fontSize: 16, lineHeight: 1.8, color: "#1a1a1a", margin: 0 }}>
                    <strong>TODO o investimento em equipamento e instalação é por nossa conta. Custo zero para o estabelecimento.</strong>
                  </p>
                </div>
                <p style={{ fontSize: 16, lineHeight: 1.8, color: "#1a1a1a" }}>
                  Sua participação: ceder o espaço de <strong>{form.qtdCarregadores} vaga{form.qtdCarregadores > 1 ? "s" : ""} de estacionamento</strong> e a energia elétrica consumida pelo eletroposto.
                </p>
                <div className="footer" style={{ textAlign: "center", fontSize: 12, color: "#999", borderTop: "1px solid #e0e0e0", paddingTop: 12, marginTop: 40 }}>
                  {footerContent()}
                </div>
              </div>

              {/* ── PAGE 5: MODELO DE PARCERIA + CENÁRIOS ── */}
              <div className="page" style={{ padding: "60px 50px", minHeight: "100vh", fontFamily: "Georgia, serif", background: "#fff" }}>
                <h2 style={{ color: "#C9A84C", fontSize: 26, borderBottom: "3px solid #C9A84C", paddingBottom: 8, marginBottom: 24 }}>Modelo de Parceria</h2>
                <h3 style={{ fontSize: 20, color: "#1a1a1a", marginBottom: 16 }}>{form.modeloParceria}</h3>
                <div className="highlight" style={{ background: "#FFF9E6", borderLeft: "4px solid #C9A84C", padding: "20px 24px", margin: "20px 0", borderRadius: "0 8px 8px 0" }}>
                  <p style={{ fontSize: 16, lineHeight: 1.8, color: "#1a1a1a", margin: 0 }}>
                    {parceriaText()}
                  </p>
                </div>

                <h3 style={{ fontSize: 18, color: "#1a1a1a", marginTop: 32, marginBottom: 16 }}>Projeção de Faturamento</h3>
                <p style={{ fontSize: 14, color: "#666", marginBottom: 12 }}>
                  Fórmula: {cfg.potencia}kW × horas/dia × R$ {fmt(PRECO_VENDA)}/kWh × 30 dias × {form.qtdCarregadores} carregador{form.qtdCarregadores > 1 ? "es" : ""}
                </p>

                {/* Tabela de cenários */}
                <table style={{ width: "100%", borderCollapse: "collapse", margin: "20px 0" }}>
                  <thead>
                    <tr>
                      <th style={{ background: "#C9A84C", color: "#0A0A0A", padding: "12px 16px", textAlign: "left", fontSize: 14 }}>Cenário</th>
                      <th style={{ background: "#C9A84C", color: "#0A0A0A", padding: "12px 16px", textAlign: "center", fontSize: 14 }}>Horas/dia</th>
                      <th style={{ background: "#C9A84C", color: "#0A0A0A", padding: "12px 16px", textAlign: "right", fontSize: 14 }}>Faturamento Mensal</th>
                      <th style={{ background: "#C9A84C", color: "#0A0A0A", padding: "12px 16px", textAlign: "right", fontSize: 14 }}>Participação do Dono</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cenarios.map((c, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                        <td style={{ padding: "12px 16px", borderBottom: "1px solid #e0e0e0", fontSize: 15, fontWeight: "bold" }}>{c.nome}</td>
                        <td style={{ padding: "12px 16px", borderBottom: "1px solid #e0e0e0", fontSize: 15, textAlign: "center" }}>{c.horas}h</td>
                        <td style={{ padding: "12px 16px", borderBottom: "1px solid #e0e0e0", fontSize: 15, textAlign: "right" }}>R$ {fmt(c.faturamento)}</td>
                        <td style={{ padding: "12px 16px", borderBottom: "1px solid #e0e0e0", fontSize: 15, textAlign: "right", color: "#C9A84C", fontWeight: "bold" }}>R$ {fmt(c.participacao)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Gráfico de barras CSS */}
                <div className="bar-chart" style={{ margin: "24px 0" }}>
                  <p style={{ fontSize: 14, fontWeight: "bold", color: "#1a1a1a", marginBottom: 12 }}>Faturamento Mensal por Cenário</p>
                  {cenarios.map((c, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                      <span style={{ fontSize: 13, color: "#666", width: 90, textAlign: "right", flexShrink: 0 }}>{c.nome}</span>
                      <div className="bar" style={{
                        background: "linear-gradient(90deg, #C9A84C, #E8D48B)",
                        height: 32,
                        borderRadius: 4,
                        width: `${maxFat > 0 ? (c.faturamento / maxFat) * 100 : 0}%`,
                        minWidth: 40,
                        display: "flex",
                        alignItems: "center",
                        paddingLeft: 12,
                        fontSize: 13,
                        fontWeight: "bold",
                        color: "#0A0A0A",
                        flexShrink: 1,
                        flexGrow: 0,
                      }}>
                        R$ {fmt(c.faturamento)}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Número destaque em dourado */}
                <div style={{ textAlign: "center", margin: "24px 0", padding: 24, border: "2px solid #C9A84C", borderRadius: 12, background: "#FFFDF5" }}>
                  <p style={{ fontSize: 14, color: "#666", margin: 0 }}>Cenário Moderado — Sua Participação Mensal</p>
                  <p className="gold-number" style={{ color: "#C9A84C", fontSize: 36, fontWeight: "bold", margin: "8px 0 0" }}>
                    R$ {fmt(cenarios[1].participacao)}
                  </p>
                </div>

                <h3 style={{ fontSize: 18, color: "#1a1a1a", marginTop: 32, marginBottom: 16 }}>Prazo</h3>
                <p style={{ fontSize: 16, lineHeight: 1.8, color: "#1a1a1a" }}>
                  Contrato de <strong>{form.prazoContrato} meses</strong>, renovável por igual período mediante acordo entre as partes.
                </p>
                <div className="footer" style={{ textAlign: "center", fontSize: 12, color: "#999", borderTop: "1px solid #e0e0e0", paddingTop: 12, marginTop: 40 }}>
                  {footerContent()}
                </div>
              </div>

              {/* ── PAGE 6: OPERAÇÃO ── */}
              <div className="page" style={{ padding: "60px 50px", minHeight: "100vh", fontFamily: "Georgia, serif", background: "#fff" }}>
                <h2 style={{ color: "#C9A84C", fontSize: 26, borderBottom: "3px solid #C9A84C", paddingBottom: 8, marginBottom: 24 }}>Operação e Manutenção</h2>
                <ul style={{ paddingLeft: 24, fontSize: 16, lineHeight: 2.2, color: "#1a1a1a" }}>
                  <li>Operação <strong>100% por nossa conta</strong> — monitoramento remoto 24h</li>
                  <li>Manutenção preventiva mensal incluída</li>
                  <li>Suporte técnico sem custo para o estabelecimento</li>
                  <li>Seguro contra danos incluído</li>
                  <li>Prazo do contrato: <strong>{form.prazoContrato} meses</strong>, renovável</li>
                  <li>Instalação em até <strong>60 dias</strong> após assinatura</li>
                </ul>

                <div className="highlight" style={{ background: "#FFF9E6", borderLeft: "4px solid #C9A84C", padding: "16px 20px", margin: "32px 0", borderRadius: "0 8px 8px 0" }}>
                  <p style={{ fontSize: 16, lineHeight: 1.8, color: "#1a1a1a", margin: 0 }}>
                    <strong>Resumo: Você cede o espaço e a energia, nós cuidamos de todo o resto.</strong>
                  </p>
                </div>
                <div className="footer" style={{ textAlign: "center", fontSize: 12, color: "#999", borderTop: "1px solid #e0e0e0", paddingTop: 12, marginTop: 40 }}>
                  {footerContent()}
                </div>
              </div>

              {/* ── PAGE 7: PRÓXIMOS PASSOS ── */}
              <div className="page" style={{ padding: "60px 50px", minHeight: "100vh", fontFamily: "Georgia, serif", background: "#fff" }}>
                <h2 style={{ color: "#C9A84C", fontSize: 26, borderBottom: "3px solid #C9A84C", paddingBottom: 8, marginBottom: 24 }}>Próximos Passos</h2>
                <ol className="steps" style={{ counterReset: "step", listStyle: "none", padding: 0 }}>
                  {[
                    "Aprovação desta proposta",
                    "Visita técnica ao local (sem custo)",
                    "Elaboração do projeto elétrico",
                    "Assinatura do contrato",
                    "Instalação e inauguração",
                  ].map((step, i) => (
                    <li key={i} style={{ position: "relative", paddingLeft: 48, marginBottom: 20, fontSize: 16, lineHeight: 1.8, color: "#1a1a1a" }}>
                      <span style={{ position: "absolute", left: 0, background: "#C9A84C", color: "#0A0A0A", width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: 14 }}>{i + 1}</span>
                      {step}
                    </li>
                  ))}
                </ol>

                <div style={{ marginTop: 48, padding: 24, border: "2px solid #C9A84C", borderRadius: 12, textAlign: "center" }}>
                  <h3 style={{ color: "#C9A84C", fontSize: 18, marginBottom: 12 }}>Contato</h3>
                  <p style={{ fontSize: 16, color: "#1a1a1a", marginBottom: 4 }}><strong>{form.nomeSocio}</strong></p>
                  <p style={{ fontSize: 14, color: "#555", marginBottom: 2 }}>{form.telefone}</p>
                  <p style={{ fontSize: 14, color: "#555", marginBottom: 2 }}>{form.email}</p>
                  {form.cidadeEstado && <p style={{ fontSize: 14, color: "#555" }}>{form.cidadeEstado}</p>}
                </div>

                {form.advisor && (
                  <div style={{ marginTop: 24, textAlign: "center", padding: 16, background: "#f9f9f9", borderRadius: 8 }}>
                    <p style={{ fontSize: 13, color: "#888", margin: 0 }}>
                      Apoio técnico: <strong style={{ color: "#C9A84C" }}>BLEV Educação</strong> | @guilhermegbbento
                    </p>
                  </div>
                )}

                <div className="footer" style={{ textAlign: "center", fontSize: 12, color: "#999", borderTop: "1px solid #e0e0e0", paddingTop: 12, marginTop: 40 }}>
                  {footerContent()}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
