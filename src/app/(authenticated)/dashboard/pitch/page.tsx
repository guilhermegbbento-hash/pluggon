"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import {
  buildSlides,
  buildExportHtml,
  type PitchFormData,
  type PitchMode,
  type InvestmentModel,
  type ChargerType,
} from "./pitch-data";

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_FORM: PitchFormData = {
  mode: "investidor",
  empresa: "",
  apresentador: "",
  cargo: "CEO",
  cidade: "",
  estado: "",
  logoDataUrl: null,
  telefone: "",
  email: "",
  advisorBlev: true,

  populacao: 200000,
  pibPerCapita: 35000,
  evsCidade: 800,
  carregadoresExistentes: 10,

  investimentoBuscado: 500000,
  participacaoOferecida: 30,
  qtdPontos: 4,
  tipoCarregador: "DC 80kW",
  modelo: "equity",
  prazoMeses: 36,
  diferenciais: "",

  precoProjeto: 650000,
  inclui:
    "Carregador, instalação elétrica, adequação civil, licenças, sistema de gestão, 12 meses de operação assistida",
  qtdPontosChave: 4,
  tipoCarregadorChave: "DC 80kW",
  garantias: "Garantia de fábrica 24 meses, SLA de uptime 98%",
  suportePosVenda: "Suporte 24/7, manutenção preventiva trimestral",
};

// ─── UI primitives ──────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-[#8B949E] mb-1.5 uppercase tracking-wide">{children}</label>;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-3 py-2 text-sm text-white placeholder:text-[#484F58] focus:border-[#C9A84C] focus:outline-none";

// ─── Page ───────────────────────────────────────────────────────────────────

export default function PitchPage() {
  const [form, setForm] = useState<PitchFormData>(DEFAULT_FORM);
  const [showPreview, setShowPreview] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const update = <K extends keyof PitchFormData>(key: K, value: PitchFormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const slides = useMemo(() => buildSlides(form), [form]);

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => update("logoDataUrl", reader.result as string);
    reader.readAsDataURL(file);
  }

  function handleExport() {
    const html = buildExportHtml(form, slides);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pitch-${(form.empresa || "blev").toLowerCase().replace(/\s+/g, "-")}-${form.cidade.toLowerCase().replace(/\s+/g, "-") || "cidade"}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Pitch para Investidores</h1>
        <p className="mt-1 text-sm text-[#8B949E]">
          Gere uma apresentação profissional para captar investidores ou vender projetos chave na mão. Sem consumo de
          créditos — template + cálculos locais.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-[#30363D]">
        {(
          [
            { id: "investidor", label: "Pitch para Investidor" },
            { id: "chave-na-mao", label: "Pitch Chave na Mão" },
          ] as { id: PitchMode; label: string }[]
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => update("mode", tab.id)}
            className={`px-5 py-3 text-sm font-semibold transition-colors border-b-2 -mb-px ${
              form.mode === tab.id
                ? "text-[#C9A84C] border-[#C9A84C]"
                : "text-[#8B949E] border-transparent hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Form */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* LEFT: form */}
        <div className="space-y-6">
          {/* Dados comuns */}
          <section className="rounded-xl border border-[#30363D] bg-[#161B22] p-5">
            <h2 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider mb-4">
              Dados do Apresentador
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Nome da empresa">
                <input
                  className={inputCls}
                  value={form.empresa}
                  onChange={(e) => update("empresa", e.target.value)}
                  placeholder="Ex: BLEV Energia"
                />
              </Field>
              <Field label="Nome do apresentador">
                <input
                  className={inputCls}
                  value={form.apresentador}
                  onChange={(e) => update("apresentador", e.target.value)}
                  placeholder="Ex: João Silva"
                />
              </Field>
              <Field label="Cargo">
                <select
                  className={inputCls}
                  value={form.cargo}
                  onChange={(e) => update("cargo", e.target.value)}
                >
                  <option>CEO</option>
                  <option>Diretor</option>
                  <option>Sócio</option>
                  <option>Fundador</option>
                  <option>CFO</option>
                </select>
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Field label="Cidade">
                    <input
                      className={inputCls}
                      value={form.cidade}
                      onChange={(e) => update("cidade", e.target.value)}
                      placeholder="Ex: Florianópolis"
                    />
                  </Field>
                </div>
                <Field label="UF">
                  <input
                    className={inputCls}
                    maxLength={2}
                    value={form.estado}
                    onChange={(e) => update("estado", e.target.value.toUpperCase())}
                    placeholder="SC"
                  />
                </Field>
              </div>
              <Field label="Telefone">
                <input
                  className={inputCls}
                  value={form.telefone}
                  onChange={(e) => update("telefone", e.target.value)}
                  placeholder="(48) 99999-9999"
                />
              </Field>
              <Field label="Email">
                <input
                  className={inputCls}
                  type="email"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  placeholder="joao@empresa.com.br"
                />
              </Field>
              <Field label="Logo (opcional)">
                <div className="flex gap-2 items-center">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="rounded-lg border border-[#30363D] bg-[#0D1117] px-3 py-2 text-xs text-white hover:bg-[#21262D]"
                  >
                    {form.logoDataUrl ? "Trocar logo" : "Upload logo"}
                  </button>
                  {form.logoDataUrl && (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={form.logoDataUrl} alt="logo" className="h-8 w-auto rounded" />
                      <button
                        type="button"
                        onClick={() => update("logoDataUrl", null)}
                        className="text-xs text-[#F44336] hover:underline"
                      >
                        Remover
                      </button>
                    </>
                  )}
                </div>
              </Field>
              <div className="md:col-span-2 flex items-center gap-2">
                <input
                  id="advisor"
                  type="checkbox"
                  checked={form.advisorBlev}
                  onChange={(e) => update("advisorBlev", e.target.checked)}
                  className="w-4 h-4 accent-[#C9A84C]"
                />
                <label htmlFor="advisor" className="text-sm text-white">
                  Incluir <b className="text-[#C9A84C]">BLEV Educação</b> como advisor no pitch
                </label>
              </div>
            </div>
          </section>

          {/* Dados da cidade */}
          <section className="rounded-xl border border-[#30363D] bg-[#161B22] p-5">
            <h2 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider mb-4">
              Dados da Cidade
            </h2>
            <p className="text-xs text-[#8B949E] mb-4">
              Preencha ou copie do módulo <b>Inteligência de Mercado</b>.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Field label="População">
                <input
                  type="number"
                  className={inputCls}
                  value={form.populacao}
                  onChange={(e) => update("populacao", Number(e.target.value))}
                />
              </Field>
              <Field label="PIB per capita (R$)">
                <input
                  type="number"
                  className={inputCls}
                  value={form.pibPerCapita}
                  onChange={(e) => update("pibPerCapita", Number(e.target.value))}
                />
              </Field>
              <Field label="EVs acumulados">
                <input
                  type="number"
                  className={inputCls}
                  value={form.evsCidade}
                  onChange={(e) => update("evsCidade", Number(e.target.value))}
                />
              </Field>
              <Field label="Carregadores atuais">
                <input
                  type="number"
                  className={inputCls}
                  value={form.carregadoresExistentes}
                  onChange={(e) => update("carregadoresExistentes", Number(e.target.value))}
                />
              </Field>
            </div>
          </section>

          {/* Modo específico */}
          {form.mode === "investidor" ? (
            <section className="rounded-xl border border-[#30363D] bg-[#161B22] p-5">
              <h2 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider mb-4">
                Oferta ao Investidor
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Investimento buscado (R$)">
                  <input
                    type="number"
                    className={inputCls}
                    value={form.investimentoBuscado}
                    onChange={(e) => update("investimentoBuscado", Number(e.target.value))}
                  />
                </Field>
                <Field
                  label={
                    form.modelo === "debt"
                      ? "Taxa de juros (% a.a.)"
                      : form.modelo === "revenue-share"
                      ? "% do faturamento"
                      : "Participação oferecida (%)"
                  }
                >
                  <input
                    type="number"
                    className={inputCls}
                    value={form.participacaoOferecida}
                    onChange={(e) => update("participacaoOferecida", Number(e.target.value))}
                  />
                </Field>
                <Field label="Quantidade de pontos">
                  <input
                    type="number"
                    className={inputCls}
                    value={form.qtdPontos}
                    onChange={(e) => update("qtdPontos", Number(e.target.value))}
                  />
                </Field>
                <Field label="Tipo de carregador">
                  <select
                    className={inputCls}
                    value={form.tipoCarregador}
                    onChange={(e) => update("tipoCarregador", e.target.value as ChargerType)}
                  >
                    <option>DC 40kW</option>
                    <option>DC 80kW</option>
                  </select>
                </Field>
                <Field label="Modelo de investimento">
                  <select
                    className={inputCls}
                    value={form.modelo}
                    onChange={(e) => update("modelo", e.target.value as InvestmentModel)}
                  >
                    <option value="equity">Equity (participação societária)</option>
                    <option value="debt">Debt (empréstimo com juros)</option>
                    <option value="revenue-share">Revenue Share (% do faturamento)</option>
                  </select>
                </Field>
                <Field label="Prazo do projeto (meses)">
                  <input
                    type="number"
                    min={12}
                    max={60}
                    className={inputCls}
                    value={form.prazoMeses}
                    onChange={(e) => update("prazoMeses", Number(e.target.value))}
                  />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Diferenciais competitivos">
                    <textarea
                      className={`${inputCls} min-h-[72px] resize-y`}
                      value={form.diferenciais}
                      onChange={(e) => update("diferenciais", e.target.value)}
                      placeholder="Localização estratégica, contratos frotas já assinados, etc."
                    />
                  </Field>
                </div>
              </div>
            </section>
          ) : (
            <section className="rounded-xl border border-[#30363D] bg-[#161B22] p-5">
              <h2 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider mb-4">
                Proposta Chave na Mão
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Preço do projeto completo (R$)">
                  <input
                    type="number"
                    className={inputCls}
                    value={form.precoProjeto}
                    onChange={(e) => update("precoProjeto", Number(e.target.value))}
                  />
                </Field>
                <Field label="Quantidade de pontos">
                  <input
                    type="number"
                    className={inputCls}
                    value={form.qtdPontosChave}
                    onChange={(e) => update("qtdPontosChave", Number(e.target.value))}
                  />
                </Field>
                <Field label="Tipo de carregador">
                  <select
                    className={inputCls}
                    value={form.tipoCarregadorChave}
                    onChange={(e) => update("tipoCarregadorChave", e.target.value as ChargerType)}
                  >
                    <option>DC 40kW</option>
                    <option>DC 80kW</option>
                  </select>
                </Field>
                <div className="md:col-span-2">
                  <Field label="O que inclui (separar por vírgula)">
                    <textarea
                      className={`${inputCls} min-h-[72px] resize-y`}
                      value={form.inclui}
                      onChange={(e) => update("inclui", e.target.value)}
                    />
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Field label="Garantias oferecidas">
                    <input
                      className={inputCls}
                      value={form.garantias}
                      onChange={(e) => update("garantias", e.target.value)}
                    />
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Field label="Suporte pós-venda">
                    <input
                      className={inputCls}
                      value={form.suportePosVenda}
                      onChange={(e) => update("suportePosVenda", e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            </section>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setShowPreview(true)}
              className="flex-1 rounded-lg bg-[#C9A84C] px-5 py-3 text-sm font-bold text-[#0D1117] hover:bg-[#B89443] transition-colors"
            >
              Gerar Apresentação
            </button>
            <button
              onClick={handleExport}
              className="flex-1 rounded-lg border border-[#C9A84C] px-5 py-3 text-sm font-bold text-[#C9A84C] hover:bg-[#C9A84C15] transition-colors"
            >
              Exportar HTML
            </button>
          </div>
        </div>

        {/* RIGHT: preview */}
        <div className="space-y-4">
          <div className="rounded-xl border border-[#30363D] bg-[#0A0A0A] overflow-hidden sticky top-6">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363D] bg-[#161B22]">
              <div className="text-xs font-bold text-[#C9A84C] uppercase tracking-wider">
                Preview — {slides[activeSlide]?.n}/{slides.length}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => setActiveSlide((i) => Math.max(0, i - 1))}
                  disabled={activeSlide === 0}
                  className="w-8 h-8 rounded-lg border border-[#30363D] text-[#C9A84C] disabled:opacity-30 hover:bg-[#21262D]"
                >
                  ‹
                </button>
                <button
                  onClick={() => setActiveSlide((i) => Math.min(slides.length - 1, i + 1))}
                  disabled={activeSlide === slides.length - 1}
                  className="w-8 h-8 rounded-lg border border-[#30363D] text-[#C9A84C] disabled:opacity-30 hover:bg-[#21262D]"
                >
                  ›
                </button>
              </div>
            </div>
            <SlidePreview slide={slides[activeSlide]} />
          </div>

          {/* Slide thumbnails */}
          <div className="grid grid-cols-5 gap-2">
            {slides.map((s, i) => (
              <button
                key={s.n}
                onClick={() => setActiveSlide(i)}
                className={`aspect-video rounded border text-[10px] font-bold transition-colors ${
                  i === activeSlide
                    ? "border-[#C9A84C] bg-[#C9A84C15] text-[#C9A84C]"
                    : "border-[#30363D] bg-[#0D1117] text-[#8B949E] hover:border-[#8B949E]"
                }`}
              >
                {s.n}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Full-screen preview modal */}
      {showPreview && (
        <FullPreview
          slides={slides}
          form={form}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}

// ─── Slide preview card ─────────────────────────────────────────────────────

function SlidePreview({ slide }: { slide: { n: number; title: string; subtitle?: string; kicker?: string; bodyHtml: string } }) {
  return (
    <div className="p-8 min-h-[420px] flex flex-col">
      {slide.kicker && (
        <div className="inline-block self-start text-[10px] font-bold text-[#C9A84C] uppercase tracking-[3px] border border-[#C9A84C] rounded-full px-3 py-1 mb-4">
          {slide.kicker}
        </div>
      )}
      <h2 className="text-3xl font-extrabold text-white leading-tight mb-2">{slide.title}</h2>
      {slide.subtitle && <div className="text-lg text-[#C9A84C] mb-4">{slide.subtitle}</div>}
      <div
        className="pitch-body text-sm text-[#D4D4D4] leading-relaxed"
        dangerouslySetInnerHTML={{ __html: slide.bodyHtml }}
      />
      <style jsx>{`
        .pitch-body :global(.stat-grid) {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          margin: 12px 0;
        }
        .pitch-body :global(.stat) {
          background: #111;
          border: 1px solid #222;
          border-radius: 10px;
          padding: 12px;
          text-align: center;
        }
        .pitch-body :global(.stat-num) {
          color: #C9A84C;
          font-size: 22px;
          font-weight: 800;
          line-height: 1;
          margin-bottom: 4px;
        }
        .pitch-body :global(.stat-lbl) {
          color: #999;
          font-size: 10px;
        }
        .pitch-body :global(.tbl) {
          width: 100%;
          border-collapse: collapse;
          margin: 10px 0;
          font-size: 12px;
        }
        .pitch-body :global(.tbl th) {
          background: #1a1a1a;
          color: #C9A84C;
          padding: 8px;
          text-align: left;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .pitch-body :global(.tbl th.r),
        .pitch-body :global(.tbl td.r) {
          text-align: right;
        }
        .pitch-body :global(.tbl td) {
          padding: 8px;
          border-bottom: 1px solid #1a1a1a;
        }
        .pitch-body :global(.tbl tr.total td) {
          background: #C9A84C15;
          color: #C9A84C;
          font-weight: 700;
        }
        .pitch-body :global(.highlight) {
          background: #C9A84C12;
          border-left: 3px solid #C9A84C;
          padding: 10px 14px;
          margin: 10px 0;
          border-radius: 4px;
        }
        .pitch-body :global(.highlight b) {
          color: #C9A84C;
        }
        .pitch-body :global(ul),
        .pitch-body :global(ol) {
          list-style: none;
          padding: 0;
          margin: 8px 0;
        }
        .pitch-body :global(li) {
          padding: 6px 0 6px 20px;
          position: relative;
          border-bottom: 1px solid #1a1a1a;
        }
        .pitch-body :global(.problem-list li:before),
        .pitch-body :global(.check-list li:before),
        .pitch-body :global(.credentials li:before) {
          content: "▸";
          color: #C9A84C;
          position: absolute;
          left: 2px;
          font-weight: 700;
        }
        .pitch-body :global(.steps) {
          counter-reset: step;
        }
        .pitch-body :global(.steps li) {
          counter-increment: step;
          padding-left: 36px;
        }
        .pitch-body :global(.steps li:before) {
          content: counter(step);
          position: absolute;
          left: 0;
          top: 6px;
          width: 24px;
          height: 24px;
          background: #C9A84C;
          color: #0A0A0A;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 11px;
        }
        .pitch-body :global(.big-offer) {
          text-align: center;
          padding: 20px;
          background: #111;
          border: 1px solid #C9A84C40;
          border-radius: 12px;
          margin: 12px 0;
        }
        .pitch-body :global(.big-label) {
          color: #888;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 2px;
          margin: 8px 0 4px;
        }
        .pitch-body :global(.big-value) {
          color: #C9A84C;
          font-size: 28px;
          font-weight: 800;
        }
        .pitch-body :global(.team-card) {
          background: #111;
          border: 1px solid #222;
          border-radius: 10px;
          padding: 14px;
          margin: 8px 0;
        }
        .pitch-body :global(.team-card.advisor) {
          border-color: #C9A84C40;
          background: #C9A84C08;
        }
        .pitch-body :global(.team-name) {
          color: #F5F5F5;
          font-size: 16px;
          font-weight: 700;
        }
        .pitch-body :global(.team-name .badge) {
          display: inline-block;
          background: #C9A84C;
          color: #0A0A0A;
          font-size: 9px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 999px;
          margin-left: 6px;
          vertical-align: middle;
        }
        .pitch-body :global(.team-role) {
          color: #999;
          font-size: 11px;
          margin: 4px 0 8px;
        }
        .pitch-body :global(.sub-title) {
          color: #C9A84C;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 2px;
          margin: 12px 0 6px;
        }
        .pitch-body :global(.contact) {
          margin-top: 14px;
          padding: 12px 14px;
          background: #111;
          border-left: 3px solid #C9A84C;
          border-radius: 4px;
        }
        .pitch-body :global(.contact-line) {
          padding: 2px 0;
        }
        .pitch-body :global(.contact-line.muted) {
          color: #888;
          font-size: 10px;
        }
        .pitch-body :global(.capa-meta) {
          margin-top: 16px;
        }
        .pitch-body :global(.capa-nome) {
          font-size: 18px;
          color: #F5F5F5;
          font-weight: 600;
        }
        .pitch-body :global(.capa-cargo) {
          font-size: 12px;
          color: #999;
          margin-bottom: 10px;
        }
        .pitch-body :global(.capa-data) {
          color: #666;
          font-size: 11px;
        }
        .pitch-body :global(.capa-advisor) {
          margin-top: 12px;
          display: inline-block;
          padding: 4px 10px;
          background: #C9A84C15;
          border: 1px solid #C9A84C;
          border-radius: 999px;
          color: #C9A84C;
          font-size: 10px;
        }
        .pitch-body :global(.source) {
          margin-top: 10px;
          color: #666;
          font-size: 10px;
          font-style: italic;
        }
        .pitch-body :global(.lead) {
          font-size: 15px;
          margin-bottom: 10px;
        }
      `}</style>
    </div>
  );
}

// ─── Fullscreen preview with keyboard nav ───────────────────────────────────

function FullPreview({
  slides,
  form,
  onClose,
}: {
  slides: ReturnType<typeof buildSlides>;
  form: PitchFormData;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" || e.key === " ") setIdx((i) => Math.min(slides.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [slides.length, onClose]);

  const slide = slides[idx];

  return (
    <div className="fixed inset-0 z-50 bg-[#0A0A0A] overflow-auto">
      <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 bg-[#0A0A0A]/95 border-b border-[#222]">
        <div className="text-xs font-bold text-[#C9A84C] uppercase tracking-wider">
          Pitch — {form.empresa || "Preview"}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8B949E]">
            {idx + 1} / {slides.length}
          </span>
          <button
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={idx === 0}
            className="w-9 h-9 rounded-full bg-[#C9A84C] text-[#0A0A0A] font-bold disabled:opacity-30"
          >
            ‹
          </button>
          <button
            onClick={() => setIdx((i) => Math.min(slides.length - 1, i + 1))}
            disabled={idx === slides.length - 1}
            className="w-9 h-9 rounded-full bg-[#C9A84C] text-[#0A0A0A] font-bold disabled:opacity-30"
          >
            ›
          </button>
          <button
            onClick={onClose}
            className="ml-2 px-3 py-1.5 text-xs text-[#8B949E] border border-[#30363D] rounded hover:bg-[#21262D]"
          >
            Fechar (Esc)
          </button>
        </div>
      </div>
      <div className="min-h-[calc(100vh-56px)] flex items-center justify-center px-8 py-12">
        <div className="max-w-4xl w-full">
          <SlidePreview slide={slide} />
        </div>
      </div>
    </div>
  );
}
