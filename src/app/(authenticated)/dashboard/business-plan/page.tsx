"use client";

import { useState, useEffect, useRef } from "react";

// ---------- Types ----------

interface BPSection {
  number: number;
  title: string;
  content: string;
}

interface BPResult {
  sections: BPSection[];
  ibge: {
    population: number | null;
    gdp_per_capita: number | null;
    idhm: number | null;
  };
  chargers_count: number;
  client_name?: string;
  city?: string;
  state?: string;
  capex?: number;
  bp_id?: string;
}

// ---------- Constants ----------

const OBJECTIVE_OPTIONS = [
  "Atrair clientes pro meu negócio",
  "Criar empresa de eletropostos",
  "Ser investidor gerar renda passiva",
  "Agregar ao negócio de energia solar",
];

const CAPITAL_OPTIONS = [
  "R$ 55.000",
  "R$ 100.000",
  "R$ 200.000",
  "R$ 300.000",
  "R$ 500.000+",
];

const TIMELINE_OPTIONS = [
  "Imediatamente",
  "1-2 meses",
  "2-3 meses",
  "3-6 meses",
];

const MARKET_MOMENT_OPTIONS = ["Início", "Crescimento", "Maduro"];

const DEMAND_OPTIONS = [
  "Sim, com dados concretos",
  "Sim, por intuição",
  "Preciso fazer pesquisa",
];

const PRIORITY_OPTIONS = [
  "Projeção financeira",
  "Marketing",
  "Operacional",
  "Custos",
  "Parcerias",
  "Pitch investidores",
];

const LOADING_STEPS = [
  { text: "Pesquisando dados da cidade no IBGE...", duration: 4000 },
  { text: "Buscando carregadores existentes na região...", duration: 6000 },
  { text: "Analisando concorrência e gaps de mercado...", duration: 5000 },
  { text: "Gerando análise de mercado e sumário executivo...", duration: 20000 },
  { text: "Calculando projeções financeiras...", duration: 15000 },
  { text: "Elaborando estratégia de marketing...", duration: 10000 },
  { text: "Montando plano de ação 90 dias...", duration: 8000 },
  { text: "Finalizando Business Plan...", duration: 5000 },
];

const STATES = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA",
  "PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

// ---------- Markdown renderer ----------

function renderMarkdown(md: string) {
  const lines = md.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("### ")) {
      elements.push(
        <h4 key={key++} className="mt-4 mb-2 text-base font-semibold text-white">
          {renderInline(line.slice(4))}
        </h4>
      );
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(
        <h3 key={key++} className="mt-5 mb-2 text-lg font-bold text-white">
          {renderInline(line.slice(3))}
        </h3>
      );
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      elements.push(
        <h2 key={key++} className="mt-6 mb-3 text-xl font-bold text-white">
          {renderInline(line.slice(2))}
        </h2>
      );
      i++;
      continue;
    }

    if (line.includes("|") && line.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      elements.push(renderTable(tableLines, key++));
      continue;
    }

    if (line.match(/^\s*[-*]\s/)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].match(/^\s*[-*]\s/)) {
        listItems.push(lines[i].replace(/^\s*[-*]\s/, ""));
        i++;
      }
      elements.push(
        <ul key={key++} className="my-2 ml-4 list-disc space-y-1 text-[#C9D1D9]">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (line.match(/^\s*\d+\.\s/)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].match(/^\s*\d+\.\s/)) {
        listItems.push(lines[i].replace(/^\s*\d+\.\s/, ""));
        i++;
      }
      elements.push(
        <ol key={key++} className="my-2 ml-4 list-decimal space-y-1 text-[#C9D1D9]">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    elements.push(
      <p key={key++} className="my-2 text-[#C9D1D9] leading-relaxed">
        {renderInline(line)}
      </p>
    );
    i++;
  }

  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={idx} className="text-white font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

function renderTable(lines: string[], key: number) {
  const rows = lines
    .filter((l) => !l.match(/^\|\s*[-:]+/))
    .map((l) =>
      l
        .split("|")
        .filter((c) => c.trim() !== "")
        .map((c) => c.trim())
    );

  if (rows.length === 0) return null;

  const header = rows[0];
  const body = rows.slice(1);

  return (
    <div key={key} className="my-4 overflow-x-auto rounded-lg border border-[#30363D]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#30363D] bg-[#0D1117]">
            {header.map((cell, idx) => (
              <th
                key={idx}
                className="px-3 py-2 text-left font-semibold text-[#C9A84C] whitespace-nowrap"
              >
                {renderInline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rIdx) => (
            <tr
              key={rIdx}
              className={`border-b border-[#30363D] ${
                rIdx % 2 === 0 ? "bg-[#161B22]" : "bg-[#0D1117]/50"
              }`}
            >
              {row.map((cell, cIdx) => (
                <td key={cIdx} className="px-3 py-2 text-[#C9D1D9] whitespace-nowrap">
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Section icon mapping ----------

function getSectionIcon(num: number): string {
  const icons: Record<number, string> = {
    1: "📋", 2: "📊", 3: "💰", 4: "⚙️", 5: "📈",
    6: "🔄", 7: "📣", 8: "📆", 9: "⚠️", 10: "🚀",
  };
  return icons[num] || "📄";
}

// ---------- Main Component ----------

export default function BusinessPlanPage() {
  const [step, setStep] = useState<"form" | "loading" | "result">("form");
  const [inputMode, setInputMode] = useState<"form" | "tally">("form");
  const [result, setResult] = useState<BPResult | null>(null);
  const [error, setError] = useState("");
  const [loadingStepIdx, setLoadingStepIdx] = useState(0);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  // Form state
  const [clientName, setClientName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [objective, setObjective] = useState("");
  const [resources, setResources] = useState("");
  const [capital, setCapital] = useState("");
  const [observations, setObservations] = useState("");
  const [timeline, setTimeline] = useState("");
  const [marketMoment, setMarketMoment] = useState("");
  const [demandIdentified, setDemandIdentified] = useState("");
  const [priorities, setPriorities] = useState<string[]>([]);
  const [challenges, setChallenges] = useState("");

  // Tally state
  const [tallyText, setTallyText] = useState("");

  // Loading step animation
  useEffect(() => {
    if (step !== "loading") return;

    setLoadingStepIdx(0);

    const timers: ReturnType<typeof setTimeout>[] = [];
    let accumulated = 0;

    for (let i = 1; i < LOADING_STEPS.length; i++) {
      accumulated += LOADING_STEPS[i - 1].duration;
      const idx = i;
      const timer = setTimeout(() => {
        setLoadingStepIdx(idx);
      }, accumulated);
      timers.push(timer);
    }

    return () => timers.forEach(clearTimeout);
  }, [step]);

  function togglePriority(p: string) {
    setPriorities((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }

  function toggleSection(num: number) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(num)) {
        next.delete(num);
      } else {
        next.add(num);
      }
      return next;
    });
  }

  function expandAll() {
    if (!result) return;
    setExpandedSections(new Set(result.sections.map((s) => s.number)));
  }

  function collapseAll() {
    setExpandedSections(new Set());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setStep("loading");

    abortRef.current = new AbortController();

    try {
      const bodyPayload =
        inputMode === "tally"
          ? { tally_text: tallyText }
          : {
              client_name: clientName,
              phone,
              email,
              city,
              state,
              objective,
              resources,
              capital,
              observations,
              timeline,
              market_moment: marketMoment,
              demand_identified: demandIdentified,
              priorities,
              challenges,
            };

      const res = await fetch("/api/generate-bp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Erro desconhecido" }));
        throw new Error(data.error || `Erro ${res.status}`);
      }

      const data: BPResult = await res.json();
      setResult(data);
      setExpandedSections(new Set(data.sections.slice(0, 3).map((s) => s.number)));
      setStep("result");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
      setStep("form");
    }
  }

  function handleNewPlan() {
    setResult(null);
    setStep("form");
    setError("");
  }

  function handleDownloadPDF() {
    if (!result?.bp_id) return;
    window.open(`/bp-print/${result.bp_id}`, "_blank");
  }

  // ---------- Render: Form ----------

  if (step === "form") {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white">Business Plan</h1>
        <p className="mt-1 text-[#8B949E]">
          Gere um plano de negocios completo e personalizado para eletroposto.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">
            {error}
          </div>
        )}

        {/* Input mode tabs */}
        <div className="mt-6 flex rounded-lg border border-[#30363D] bg-[#0D1117] p-1">
          <button
            type="button"
            onClick={() => setInputMode("form")}
            className={`flex-1 rounded-md px-4 py-2.5 text-sm font-medium transition-all ${
              inputMode === "form"
                ? "bg-[#C9A84C]/15 text-[#C9A84C] border border-[#C9A84C]/30"
                : "text-[#8B949E] hover:text-white"
            }`}
          >
            Formulario
          </button>
          <button
            type="button"
            onClick={() => setInputMode("tally")}
            className={`flex-1 rounded-md px-4 py-2.5 text-sm font-medium transition-all ${
              inputMode === "tally"
                ? "bg-[#C9A84C]/15 text-[#C9A84C] border border-[#C9A84C]/30"
                : "text-[#8B949E] hover:text-white"
            }`}
          >
            Colar do Tally
          </button>
        </div>

        {/* Tally mode */}
        {inputMode === "tally" && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-6">
            <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-6">
              <h2 className="mb-2 text-lg font-semibold text-white">Colar Respostas do Tally</h2>
              <p className="mb-4 text-sm text-[#8B949E]">
                Cole abaixo as respostas do formulario Tally. O sistema vai extrair automaticamente
                nome, telefone, email, cidade, objetivo, capital, estrategia, desafios e demais campos.
              </p>
              <textarea
                value={tallyText}
                onChange={(e) => setTallyText(e.target.value)}
                rows={14}
                required
                className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-3 text-white placeholder-[#484F58] focus:border-[#C9A84C] focus:outline-none font-mono text-sm leading-relaxed"
                placeholder={`Cole aqui as respostas do formulario Tally...\n\nExemplo:\nNome: Joao Silva\nTelefone: (11) 99999-9999\nEmail: joao@email.com\nCidade: Sao Paulo\nEstado: SP\nObjetivo: Criar empresa de eletropostos\nCapital disponivel: R$ 200.000\nEstrategia: Comecar pequeno e reinvestir\n...`}
              />
            </div>
            <button
              type="submit"
              disabled={!tallyText.trim()}
              className="w-full rounded-lg bg-[#C9A84C] px-6 py-3.5 text-base font-semibold text-[#0D1117] transition-colors hover:bg-[#B89443] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Gerar Business Plan
            </button>
          </form>
        )}

        {/* Form mode */}
        {inputMode === "form" && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-6">
            {/* Dados Pessoais */}
            <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-6">
              <h2 className="mb-4 text-lg font-semibold text-white">Dados Pessoais</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm text-[#8B949E]">Nome completo *</label>
                  <input
                    type="text"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    required
                    className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-2.5 text-white placeholder-[#484F58] focus:border-[#C9A84C] focus:outline-none"
                    placeholder="Seu nome completo"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-[#8B949E]">Telefone</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-2.5 text-white placeholder-[#484F58] focus:border-[#C9A84C] focus:outline-none"
                    placeholder="(XX) XXXXX-XXXX"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-[#8B949E]">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-2.5 text-white placeholder-[#484F58] focus:border-[#C9A84C] focus:outline-none"
                    placeholder="seu@email.com"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="mb-1 block text-sm text-[#8B949E]">Cidade *</label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      required
                      className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-2.5 text-white placeholder-[#484F58] focus:border-[#C9A84C] focus:outline-none"
                      placeholder="Sua cidade"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-[#8B949E]">UF *</label>
                    <select
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      required
                      className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-2.5 text-white focus:border-[#C9A84C] focus:outline-none"
                    >
                      <option value="">UF</option>
                      {STATES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Objetivo e Estrategia */}
            <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-6">
              <h2 className="mb-4 text-lg font-semibold text-white">Objetivo e Estrategia</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm text-[#8B949E]">Objetivo principal *</label>
                  <select
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                    required
                    className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-2.5 text-white focus:border-[#C9A84C] focus:outline-none"
                  >
                    <option value="">Selecione...</option>
                    {OBJECTIVE_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-[#8B949E]">Capital disponivel *</label>
                  <select
                    value={capital}
                    onChange={(e) => setCapital(e.target.value)}
                    required
                    className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-2.5 text-white focus:border-[#C9A84C] focus:outline-none"
                  >
                    <option value="">Selecione...</option>
                    {CAPITAL_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-[#8B949E]">Quando pretende comecar *</label>
                  <select
                    value={timeline}
                    onChange={(e) => setTimeline(e.target.value)}
                    required
                    className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-2.5 text-white focus:border-[#C9A84C] focus:outline-none"
                  >
                    <option value="">Selecione...</option>
                    {TIMELINE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm text-[#8B949E]">
                    Recursos que possui (terreno, parceria, localizacao...)
                  </label>
                  <textarea
                    value={resources}
                    onChange={(e) => setResources(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-2.5 text-white placeholder-[#484F58] focus:border-[#C9A84C] focus:outline-none"
                    placeholder="Ex: tenho um terreno na BR-101, parceria com um shopping..."
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm text-[#8B949E]">
                    Observações adicionais (opcional)
                  </label>
                  <textarea
                    value={observations}
                    onChange={(e) => setObservations(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-2.5 text-white placeholder-[#484F58] focus:border-[#C9A84C] focus:outline-none"
                    placeholder="Informações adicionais que considere relevantes para o plano..."
                  />
                </div>
              </div>
            </div>

            {/* Mercado e Demanda */}
            <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-6">
              <h2 className="mb-4 text-lg font-semibold text-white">Mercado e Demanda</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm text-[#8B949E]">
                    Momento do mercado na sua cidade *
                  </label>
                  <select
                    value={marketMoment}
                    onChange={(e) => setMarketMoment(e.target.value)}
                    required
                    className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-2.5 text-white focus:border-[#C9A84C] focus:outline-none"
                  >
                    <option value="">Selecione...</option>
                    {MARKET_MOMENT_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-[#8B949E]">
                    Ja identificou demanda real? *
                  </label>
                  <select
                    value={demandIdentified}
                    onChange={(e) => setDemandIdentified(e.target.value)}
                    required
                    className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-2.5 text-white focus:border-[#C9A84C] focus:outline-none"
                  >
                    <option value="">Selecione...</option>
                    {DEMAND_OPTIONS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Prioridades */}
            <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-6">
              <h2 className="mb-4 text-lg font-semibold text-white">Prioridades para o Business Plan</h2>
              <p className="mb-3 text-sm text-[#8B949E]">Selecione as que mais importam para voce:</p>
              <div className="flex flex-wrap gap-2">
                {PRIORITY_OPTIONS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePriority(p)}
                    className={`rounded-full border px-4 py-2 text-sm transition-all ${
                      priorities.includes(p)
                        ? "border-[#C9A84C] bg-[#C9A84C]/15 text-[#C9A84C]"
                        : "border-[#30363D] bg-[#0D1117] text-[#8B949E] hover:border-[#484F58] hover:text-white"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Desafios */}
            <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-6">
              <h2 className="mb-4 text-lg font-semibold text-white">Maiores Desafios</h2>
              <textarea
                value={challenges}
                onChange={(e) => setChallenges(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-2.5 text-white placeholder-[#484F58] focus:border-[#C9A84C] focus:outline-none"
                placeholder="Quais sao seus maiores desafios hoje para entrar no mercado de eletropostos?"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={!clientName || !city || !state || !objective || !capital || !timeline || !marketMoment || !demandIdentified}
              className="w-full rounded-lg bg-[#C9A84C] px-6 py-3.5 text-base font-semibold text-[#0D1117] transition-colors hover:bg-[#B89443] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Gerar Business Plan
            </button>
          </form>
        )}
      </div>
    );
  }

  // ---------- Render: Loading ----------

  if (step === "loading") {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white">Business Plan</h1>
        <p className="mt-1 text-[#8B949E]">
          Gerando seu plano de negocios personalizado...
        </p>

        <div className="mt-12 flex flex-col items-center">
          <div className="relative mb-8">
            <div className="h-20 w-20 animate-spin rounded-full border-4 border-[#30363D] border-t-[#C9A84C]" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-2xl">📊</span>
            </div>
          </div>

          <div className="w-full max-w-md space-y-3">
            {LOADING_STEPS.map((s, idx) => (
              <div
                key={idx}
                className={`flex items-center gap-3 rounded-lg border p-3 transition-all duration-500 ${
                  idx < loadingStepIdx
                    ? "border-[#C9A84C]/30 bg-[#C9A84C]/5"
                    : idx === loadingStepIdx
                    ? "border-[#C9A84C]/50 bg-[#161B22]"
                    : "border-[#30363D]/50 bg-[#161B22]/50 opacity-40"
                }`}
              >
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center">
                  {idx < loadingStepIdx ? (
                    <svg className="h-5 w-5 text-[#C9A84C]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : idx === loadingStepIdx ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#30363D] border-t-[#C9A84C]" />
                  ) : (
                    <div className="h-3 w-3 rounded-full bg-[#30363D]" />
                  )}
                </div>
                <span
                  className={`text-sm ${
                    idx < loadingStepIdx
                      ? "text-[#C9A84C]"
                      : idx === loadingStepIdx
                      ? "text-white"
                      : "text-[#484F58]"
                  }`}
                >
                  {s.text}
                </span>
              </div>
            ))}
          </div>

          <p className="mt-8 text-sm text-[#484F58]">
            Isso pode levar 1-2 minutos. Estamos gerando um plano completo.
          </p>

          <button
            onClick={() => {
              abortRef.current?.abort();
              setStep("form");
            }}
            className="mt-4 text-sm text-[#8B949E] hover:text-white"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  // ---------- Render: Result ----------

  if (!result) return null;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Business Plan</h1>
          <p className="mt-1 text-[#8B949E]">
            {clientName || "Cliente"} — {city || "Cidade"}/{state || "UF"}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleNewPlan}
            className="rounded-lg border border-[#30363D] bg-[#161B22] px-4 py-2 text-sm text-[#8B949E] transition-colors hover:border-[#484F58] hover:text-white"
          >
            Novo Plano
          </button>
          <button
            onClick={handleDownloadPDF}
            className="rounded-lg bg-[#C9A84C] px-4 py-2 text-sm font-semibold text-[#0D1117] transition-colors hover:bg-[#B89443]"
          >
            Baixar PDF
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 text-center">
          <p className="text-2xl font-bold text-[#C9A84C]">{result.sections.length}</p>
          <p className="text-xs text-[#8B949E]">Secoes</p>
        </div>
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 text-center">
          <p className="text-2xl font-bold text-[#2196F3]">
            {result.ibge.population?.toLocaleString("pt-BR") ?? "N/D"}
          </p>
          <p className="text-xs text-[#8B949E]">Habitantes</p>
        </div>
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 text-center">
          <p className="text-2xl font-bold text-[#FFC107]">{result.chargers_count}</p>
          <p className="text-xs text-[#8B949E]">Carregadores na cidade</p>
        </div>
      </div>

      {/* Expand/Collapse controls */}
      <div className="mt-6 flex gap-2">
        <button
          onClick={expandAll}
          className="rounded-lg border border-[#30363D] bg-[#161B22] px-3 py-1.5 text-xs text-[#8B949E] hover:text-white"
        >
          Expandir todas
        </button>
        <button
          onClick={collapseAll}
          className="rounded-lg border border-[#30363D] bg-[#161B22] px-3 py-1.5 text-xs text-[#8B949E] hover:text-white"
        >
          Recolher todas
        </button>
      </div>

      {/* Sections */}
      <div className="mt-4 space-y-3">
        {result.sections.filter(s => s.content && s.content.trim().length > 10).map((section) => {
          const isExpanded = expandedSections.has(section.number);
          return (
            <div
              key={section.number}
              className="rounded-xl border border-[#30363D] bg-[#161B22] overflow-hidden"
            >
              <button
                onClick={() => toggleSection(section.number)}
                className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-[#21262D]"
              >
                <span className="text-lg">{getSectionIcon(section.number)}</span>
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#C9A84C]/15 text-xs font-bold text-[#C9A84C]">
                  {section.number}
                </span>
                <span className="flex-1 font-semibold text-white">{section.title}</span>
                <svg
                  className={`h-5 w-5 text-[#8B949E] transition-transform ${
                    isExpanded ? "rotate-180" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              {isExpanded && (
                <div className="border-t border-[#30363D] px-6 py-5">
                  {renderMarkdown(section.content)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom actions */}
      <div className="mt-8 flex justify-center gap-4">
        <button
          onClick={handleNewPlan}
          className="rounded-lg border border-[#30363D] bg-[#161B22] px-6 py-3 text-sm text-[#8B949E] transition-colors hover:border-[#484F58] hover:text-white"
        >
          Gerar Novo Plano
        </button>
        <button
          onClick={handleDownloadPDF}
          className="rounded-lg bg-[#C9A84C] px-6 py-3 text-sm font-semibold text-[#0D1117] transition-colors hover:bg-[#B89443]"
        >
          Baixar PDF
        </button>
      </div>
    </div>
  );
}
