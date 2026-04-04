"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DespesaFixa {
  id: number;
  nome: string;
  valor: number;
}

interface DespesaVariavel {
  id: number;
  nome: string;
  percentual: number;
}

interface InvestmentItem {
  nome: string;
  valor: number;
}

// ─── Charger presets ─────────────────────────────────────────────────────────

const CHARGER_PRESETS = [
  { label: "AC 7 kW — R$ 6.000", potencia: 7 },
  { label: "DC 40 kW — R$ 55.000", potencia: 40 },
  { label: "DC 80 kW — R$ 100.000", potencia: 80 },
  { label: "Outro (personalizado)", potencia: 0 },
];

const DEFAULT_BREAKDOWNS: InvestmentItem[][] = [
  // AC 7kW
  [
    { nome: "Carregador AC 7kW", valor: 3500 },
    { nome: "Instalação Elétrica", valor: 1500 },
    { nome: "Adequação", valor: 700 },
    { nome: "Licenças", valor: 300 },
  ],
  // DC 40kW
  [
    { nome: "Carregador DC 40kW", valor: 35000 },
    { nome: "Instalação Elétrica", valor: 12000 },
    { nome: "Adequação Civil", valor: 5000 },
    { nome: "Licenças e Taxas", valor: 3000 },
  ],
  // DC 80kW
  [
    { nome: "Carregador DC 80kW", valor: 70000 },
    { nome: "Instalação Elétrica", valor: 18000 },
    { nome: "Adequação Civil", valor: 8000 },
    { nome: "Licenças e Taxas", valor: 4000 },
  ],
  // Personalizado
  [
    { nome: "Carregador", valor: 0 },
    { nome: "Instalação Elétrica", valor: 0 },
    { nome: "Adequação Civil", valor: 0 },
    { nome: "Licenças e Taxas", valor: 0 },
  ],
];

// ─── Currency formatter ──────────────────────────────────────────────────────

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtPct = (v: number) => `${v.toFixed(1)}%`;

// ─── Reusable UI (outside component to avoid re-creation) ───────────────────

const inputCls =
  "w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-2.5 text-white placeholder-[#484F58] focus:border-[#C9A84C] focus:outline-none";

const selectCls =
  "w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-2.5 text-white focus:border-[#C9A84C] focus:outline-none";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-4 text-lg font-bold text-[#C9A84C]">{children}</h2>;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-[#30363D] bg-[#161B22] p-6 ${className}`}>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-sm text-[#8B949E]">{children}</label>;
}

// ─── NumInput: uses onBlur to avoid focus loss ──────────────────────────────

function NumInput({
  value,
  onChange,
  step,
  readOnly,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: string;
  readOnly?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState(String(value));

  // Sync from parent when value changes externally (e.g. preset change)
  useEffect(() => {
    if (document.activeElement !== ref.current) {
      setLocal(String(value));
    }
  }, [value]);

  return (
    <input
      ref={ref}
      type="number"
      step={step}
      className={className || inputCls}
      value={local}
      readOnly={readOnly}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        const n = Number(local);
        if (!isNaN(n)) onChange(n);
        else setLocal(String(value));
      }}
    />
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CalculadoraPage() {
  // 1 — Investimento Inicial
  const [presetIdx, setPresetIdx] = useState(0);
  const [potencia, setPotencia] = useState(CHARGER_PRESETS[0].potencia);
  const [investmentBreakdown, setInvestmentBreakdown] = useState<InvestmentItem[]>(
    DEFAULT_BREAKDOWNS[0].map((i) => ({ ...i }))
  );

  const investimento = useMemo(
    () => investmentBreakdown.reduce((s, i) => s + i.valor, 0),
    [investmentBreakdown]
  );

  // 2 — Parâmetros Operacionais
  const [horasDia, setHorasDia] = useState(12);
  const [ocupacao, setOcupacao] = useState(25);
  const [custoKwh, setCustoKwh] = useState(0.65);
  const [precoVenda, setPrecoVenda] = useState(2.5);

  // 3 — Receitas Adicionais
  const [publicidade, setPublicidade] = useState(0);
  const [conveniencia, setConveniencia] = useState(0);
  const [frotas, setFrotas] = useState(0);
  const [torres5g, setTorres5g] = useState(0);
  const [aluguelCarros, setAluguelCarros] = useState(0);
  const [lavagem, setLavagem] = useState(0);
  const [lavanderia, setLavanderia] = useState(0);

  // 4 — Despesas Fixas
  const [despesasFixas, setDespesasFixas] = useState<DespesaFixa[]>([
    { id: 1, nome: "Seguro", valor: 150 },
    { id: 2, nome: "Internet", valor: 125 },
    { id: 3, nome: "Manutenção", valor: 199 },
  ]);
  const [nextFixaId, setNextFixaId] = useState(4);

  // 5 — Despesas Variáveis (inclui Gateway e Impostos)
  const [despesasVariaveis, setDespesasVariaveis] = useState<DespesaVariavel[]>([
    { id: 1, nome: "Gateway", percentual: 8 },
    { id: 2, nome: "Impostos", percentual: 6 },
  ]);
  const [nextVarId, setNextVarId] = useState(3);

  // Handle preset change
  function handlePreset(idx: number) {
    setPresetIdx(idx);
    const p = CHARGER_PRESETS[idx];
    setPotencia(p.potencia);
    setInvestmentBreakdown(DEFAULT_BREAKDOWNS[idx].map((i) => ({ ...i })));
  }

  // Update investment breakdown item
  function updateBreakdownItem(index: number, valor: number) {
    setInvestmentBreakdown((prev) =>
      prev.map((item, i) => (i === index ? { ...item, valor } : item))
    );
  }

  // ─── Calculations ────────────────────────────────────────────────────────

  const calc = useMemo(() => {
    const kwhMes = potencia * horasDia * (ocupacao / 100) * 30;
    const receitaEnergia = kwhMes * precoVenda;
    const custoEnergia = kwhMes * custoKwh;

    const receitasAdicionais =
      publicidade + conveniencia + frotas + torres5g + aluguelCarros + lavagem + lavanderia;

    const receitaTotal = receitaEnergia + receitasAdicionais;

    const totalFixas = despesasFixas.reduce((s, d) => s + d.valor, 0);
    const totalVariaveis = despesasVariaveis.reduce(
      (s, d) => s + (receitaTotal * d.percentual) / 100,
      0
    );

    const lucroBruto = receitaEnergia - custoEnergia;
    const lucroLiquido = receitaTotal - custoEnergia - totalFixas - totalVariaveis;

    const margemBruta = receitaEnergia > 0 ? (lucroBruto / receitaEnergia) * 100 : 0;
    const margemLiquida = receitaTotal > 0 ? (lucroLiquido / receitaTotal) * 100 : 0;
    const roi = investimento > 0 ? (lucroLiquido / investimento) * 100 : 0;
    const payback = lucroLiquido > 0 ? investimento / lucroLiquido : Infinity;

    // Projeções
    const projecoes = [6, 12, 24].map((m) => ({
      meses: m,
      receita: receitaTotal * m,
      custos: (custoEnergia + totalFixas + totalVariaveis) * m,
      lucro: lucroLiquido * m,
      acumulado: lucroLiquido * m - investimento,
    }));

    // Gráfico — lucro acumulado mês a mês por 24 meses
    const grafico = Array.from({ length: 25 }, (_, i) => ({
      mes: i,
      acumulado: lucroLiquido * i - investimento,
    }));

    return {
      kwhMes,
      receitaEnergia,
      custoEnergia,
      receitasAdicionais,
      receitaTotal,
      totalFixas,
      totalVariaveis,
      lucroBruto,
      lucroLiquido,
      margemBruta,
      margemLiquida,
      roi,
      payback,
      projecoes,
      grafico,
    };
  }, [
    potencia, horasDia, ocupacao, custoKwh, precoVenda,
    publicidade, conveniencia, frotas, torres5g, aluguelCarros, lavagem, lavanderia,
    despesasFixas, despesasVariaveis, investimento,
  ]);

  // ─── Share URL ──────────────────────────────────────────────────────────

  function handleShare() {
    const params = new URLSearchParams({
      p: String(presetIdx),
      pot: String(potencia),
      h: String(horasDia),
      oc: String(ocupacao),
      ck: String(custoKwh),
      pv: String(precoVenda),
      pub: String(publicidade),
      conv: String(conveniencia),
      fro: String(frotas),
      t5g: String(torres5g),
      alc: String(aluguelCarros),
      lav: String(lavagem),
      lavd: String(lavanderia),
      ib: JSON.stringify(investmentBreakdown),
      df: JSON.stringify(despesasFixas),
      dv: JSON.stringify(despesasVariaveis),
    });
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    navigator.clipboard.writeText(url);
    alert("Link copiado para a área de transferência!");
  }

  // Load from URL params on mount
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (!sp.has("p")) return;
    setPresetIdx(Number(sp.get("p")));
    setPotencia(Number(sp.get("pot")));
    setHorasDia(Number(sp.get("h")));
    setOcupacao(Number(sp.get("oc")));
    setCustoKwh(Number(sp.get("ck")));
    setPrecoVenda(Number(sp.get("pv")));
    setPublicidade(Number(sp.get("pub")));
    setConveniencia(Number(sp.get("conv")));
    setFrotas(Number(sp.get("fro")));
    setTorres5g(Number(sp.get("t5g")));
    setAluguelCarros(Number(sp.get("alc")));
    setLavagem(Number(sp.get("lav")));
    setLavanderia(Number(sp.get("lavd")));
    try {
      const ib = JSON.parse(sp.get("ib") || "[]");
      if (ib.length) setInvestmentBreakdown(ib);
      const df = JSON.parse(sp.get("df") || "[]");
      if (df.length) setDespesasFixas(df);
      const dv = JSON.parse(sp.get("dv") || "[]");
      if (dv.length) setDespesasVariaveis(dv);
    } catch {}
  }, []);

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const addDespesaFixa = () => {
    setDespesasFixas((prev) => [...prev, { id: nextFixaId, nome: "", valor: 0 }]);
    setNextFixaId((n) => n + 1);
  };

  const updateDespesaFixa = (id: number, field: "nome" | "valor", val: string | number) => {
    setDespesasFixas((prev) =>
      prev.map((d) => (d.id === id ? { ...d, [field]: val } : d))
    );
  };

  const removeDespesaFixa = (id: number) => {
    setDespesasFixas((prev) => prev.filter((d) => d.id !== id));
  };

  const addDespesaVariavel = () => {
    setDespesasVariaveis((prev) => [...prev, { id: nextVarId, nome: "", percentual: 0 }]);
    setNextVarId((n) => n + 1);
  };

  const updateDespesaVariavel = (id: number, field: "nome" | "percentual", val: string | number) => {
    setDespesasVariaveis((prev) =>
      prev.map((d) => (d.id === id ? { ...d, [field]: val } : d))
    );
  };

  const removeDespesaVariavel = (id: number) => {
    setDespesasVariaveis((prev) => prev.filter((d) => d.id !== id));
  };

  const trashIcon = (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );

  // ─── JSX ──────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-white">Calculadora de Viabilidade</h1>
      <p className="mt-1 text-[#8B949E]">
        Simule investimentos em estações de recarga — 100% offline, zero créditos.
      </p>

      <div className="mt-8 space-y-6">
        {/* ─── 1. INVESTIMENTO INICIAL ────────────────────────────────── */}
        <Card>
          <SectionTitle>1. Investimento Inicial</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Tipo de Carregador</Label>
              <select
                className={selectCls}
                value={presetIdx}
                onChange={(e) => handlePreset(Number(e.target.value))}
              >
                {CHARGER_PRESETS.map((p, i) => (
                  <option key={i} value={i}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Potência (kW)</Label>
              <NumInput
                value={potencia}
                onChange={setPotencia}
                readOnly={presetIdx < 3}
              />
            </div>
          </div>

          {/* Breakdown table */}
          <div className="mt-5">
            <h3 className="mb-3 text-sm font-semibold text-[#8B949E]">Composição do Investimento</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-white">
                <thead>
                  <tr className="border-b border-[#30363D] text-left text-[#8B949E]">
                    <th className="pb-2">Item</th>
                    <th className="pb-2 text-right w-48">Valor (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  {investmentBreakdown.map((item, idx) => (
                    <tr key={idx} className="border-b border-[#30363D]/50">
                      <td className="py-2 text-[#C9D1D9]">{item.nome}</td>
                      <td className="py-2 text-right">
                        <NumInput
                          value={item.valor}
                          onChange={(v) => updateBreakdownItem(idx, v)}
                          className={`${inputCls} w-48 text-right ml-auto`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[#C9A84C]/40">
                    <td className="py-3 font-semibold text-[#C9A84C]">TOTAL</td>
                    <td className="py-3 text-right font-semibold text-[#C9A84C]">
                      {fmt(investimento)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </Card>

        {/* ─── 2. PARÂMETROS OPERACIONAIS ─────────────────────────────── */}
        <Card>
          <SectionTitle>2. Parâmetros Operacionais</SectionTitle>
          <div className="grid gap-6 sm:grid-cols-2">
            {/* Horas / dia */}
            <div>
              <Label>Horas de operação / dia: {horasDia}h</Label>
              <input
                type="range"
                min={1}
                max={24}
                value={horasDia}
                onChange={(e) => setHorasDia(Number(e.target.value))}
                className="slider-gold w-full"
              />
              <div className="flex justify-between text-xs text-[#484F58]">
                <span>1h</span>
                <span>24h</span>
              </div>
            </div>
            {/* Ocupação */}
            <div>
              <Label>Taxa de ocupação: {ocupacao}%</Label>
              <input
                type="range"
                min={5}
                max={100}
                value={ocupacao}
                onChange={(e) => setOcupacao(Number(e.target.value))}
                className="slider-gold w-full"
              />
              <div className="flex justify-between text-xs text-[#484F58]">
                <span>5%</span>
                <span>100%</span>
              </div>
            </div>
            {/* Custo kWh */}
            <div>
              <Label>Custo kWh concessionária (R$)</Label>
              <NumInput
                value={custoKwh}
                onChange={setCustoKwh}
                step="0.01"
              />
            </div>
            {/* Preço venda */}
            <div>
              <Label>Preço venda kWh (R$)</Label>
              <NumInput
                value={precoVenda}
                onChange={setPrecoVenda}
                step="0.01"
              />
            </div>
          </div>
        </Card>

        {/* ─── 3. RECEITAS ADICIONAIS ─────────────────────────────────── */}
        <Card>
          <SectionTitle>3. Receitas Adicionais (R$/mês)</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["Publicidade / Totem", publicidade, setPublicidade],
                ["Conveniência", conveniencia, setConveniencia],
                ["Frotas", frotas, setFrotas],
                ["Torres 5G", torres5g, setTorres5g],
                ["Aluguel de Carros", aluguelCarros, setAluguelCarros],
                ["Lavagem", lavagem, setLavagem],
                ["Lavanderia", lavanderia, setLavanderia],
              ] as [string, number, React.Dispatch<React.SetStateAction<number>>][]
            ).map(([label, val, setter]) => (
              <div key={label as string}>
                <Label>{label as string}</Label>
                <NumInput
                  value={val as number}
                  onChange={(v) => (setter as React.Dispatch<React.SetStateAction<number>>)(v)}
                />
              </div>
            ))}
          </div>
        </Card>

        {/* ─── 4. DESPESAS FIXAS ──────────────────────────────────────── */}
        <Card>
          <SectionTitle>4. Despesas Fixas (R$/mês)</SectionTitle>
          <div className="space-y-3">
            {despesasFixas.map((d) => (
              <div key={d.id} className="flex items-end gap-3">
                <div className="flex-1">
                  <Label>Nome</Label>
                  <input
                    type="text"
                    className={inputCls}
                    value={d.nome}
                    onChange={(e) => updateDespesaFixa(d.id, "nome", e.target.value)}
                  />
                </div>
                <div className="w-40">
                  <Label>Valor (R$)</Label>
                  <NumInput
                    value={d.valor}
                    onChange={(v) => updateDespesaFixa(d.id, "valor", v)}
                  />
                </div>
                <button
                  onClick={() => removeDespesaFixa(d.id)}
                  className="mb-0.5 rounded-lg border border-[#30363D] bg-[#0D1117] px-3 py-2.5 text-[#8B949E] hover:border-red-500 hover:text-red-400"
                >
                  {trashIcon}
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={addDespesaFixa}
            className="mt-4 rounded-lg border border-[#C9A84C] px-4 py-2 text-sm font-medium text-[#C9A84C] hover:bg-[#C9A84C] hover:text-[#0D1117] transition-colors"
          >
            + Adicionar Despesa Fixa
          </button>
        </Card>

        {/* ─── 5. DESPESAS VARIÁVEIS ──────────────────────────────────── */}
        <Card>
          <SectionTitle>5. Despesas Variáveis (% da receita)</SectionTitle>
          <p className="mb-3 text-xs text-[#484F58]">
            Inclui Gateway (taxa do meio de pagamento) e Impostos. Ajuste conforme seu regime tributário.
          </p>
          <div className="space-y-3">
            {despesasVariaveis.map((d) => (
              <div key={d.id} className="flex items-end gap-3">
                <div className="flex-1">
                  <Label>Nome</Label>
                  <input
                    type="text"
                    className={inputCls}
                    value={d.nome}
                    onChange={(e) => updateDespesaVariavel(d.id, "nome", e.target.value)}
                  />
                </div>
                <div className="w-40">
                  <Label>Percentual (%)</Label>
                  <NumInput
                    value={d.percentual}
                    onChange={(v) => updateDespesaVariavel(d.id, "percentual", v)}
                    step="0.1"
                  />
                </div>
                <button
                  onClick={() => removeDespesaVariavel(d.id)}
                  className="mb-0.5 rounded-lg border border-[#30363D] bg-[#0D1117] px-3 py-2.5 text-[#8B949E] hover:border-red-500 hover:text-red-400"
                >
                  {trashIcon}
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={addDespesaVariavel}
            className="mt-4 rounded-lg border border-[#C9A84C] px-4 py-2 text-sm font-medium text-[#C9A84C] hover:bg-[#C9A84C] hover:text-[#0D1117] transition-colors"
          >
            + Adicionar Despesa Variável
          </button>
        </Card>

        {/* ─── 6. ANÁLISE FINANCEIRA ──────────────────────────────────── */}
        <div>
          <h2 className="mb-4 text-lg font-bold text-[#C9A84C]">6. Análise Financeira</h2>

          {/* Big cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { label: "Investimento", value: fmt(investimento) },
              {
                label: "Lucro Líquido / mês",
                value: fmt(calc.lucroLiquido),
                color: calc.lucroLiquido >= 0 ? "text-emerald-400" : "text-red-400",
              },
              {
                label: "Payback",
                value:
                  calc.payback === Infinity
                    ? "∞"
                    : calc.payback < 1
                    ? `${(calc.payback * 30).toFixed(0)} dias`
                    : `${calc.payback.toFixed(1)} meses`,
                color:
                  calc.payback <= 12
                    ? "text-emerald-400"
                    : calc.payback <= 24
                    ? "text-yellow-400"
                    : "text-red-400",
              },
            ].map((c) => (
              <div
                key={c.label}
                className="rounded-xl border border-[#C9A84C]/40 bg-[#161B22] p-6 text-center"
              >
                <p className="text-sm text-[#8B949E]">{c.label}</p>
                <p className={`mt-1 text-2xl font-bold ${c.color || "text-white"}`}>
                  {c.value}
                </p>
              </div>
            ))}
          </div>

          {/* Detail breakdown */}
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {/* Receitas */}
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-[#C9A84C]">Receitas</h3>
              <div className="space-y-2 text-sm">
                <Row label="Energia" value={fmt(calc.receitaEnergia)} />
                <Row label="Adicionais" value={fmt(calc.receitasAdicionais)} />
                <Divider />
                <Row label="Total" value={fmt(calc.receitaTotal)} bold />
              </div>
            </Card>

            {/* Custos */}
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-[#C9A84C]">Custos</h3>
              <div className="space-y-2 text-sm">
                <Row label="Energia" value={fmt(calc.custoEnergia)} />
                <Row label="Fixas" value={fmt(calc.totalFixas)} />
                <Row label="Variáveis" value={fmt(calc.totalVariaveis)} />
                <Divider />
                <Row
                  label="Total"
                  value={fmt(calc.custoEnergia + calc.totalFixas + calc.totalVariaveis)}
                  bold
                />
              </div>
            </Card>

            {/* Resultado */}
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-[#C9A84C]">Resultado</h3>
              <div className="space-y-2 text-sm">
                <Row label="Lucro Bruto" value={fmt(calc.lucroBruto)} />
                <Row label="Lucro Líquido" value={fmt(calc.lucroLiquido)} />
                <Row label="Margem Bruta" value={fmtPct(calc.margemBruta)} />
                <Row label="Margem Líquida" value={fmtPct(calc.margemLiquida)} />
                <Row label="ROI" value={fmtPct(calc.roi)} />
              </div>
            </Card>
          </div>

          {/* Projeções */}
          <div className="mt-6">
            <h3 className="mb-3 text-sm font-semibold text-[#C9A84C]">Projeções</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-white">
                <thead>
                  <tr className="border-b border-[#30363D] text-left text-[#8B949E]">
                    <th className="pb-2">Período</th>
                    <th className="pb-2 text-right">Receita</th>
                    <th className="pb-2 text-right">Custos</th>
                    <th className="pb-2 text-right">Lucro</th>
                    <th className="pb-2 text-right">Acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  {calc.projecoes.map((p) => (
                    <tr key={p.meses} className="border-b border-[#30363D]/50">
                      <td className="py-2">{p.meses} meses</td>
                      <td className="py-2 text-right">{fmt(p.receita)}</td>
                      <td className="py-2 text-right">{fmt(p.custos)}</td>
                      <td className="py-2 text-right">{fmt(p.lucro)}</td>
                      <td
                        className={`py-2 text-right font-medium ${
                          p.acumulado >= 0 ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {fmt(p.acumulado)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Gráfico Lucro Acumulado */}
          <Card className="mt-6">
            <h3 className="mb-4 text-sm font-semibold text-[#C9A84C]">
              Lucro Acumulado (24 meses)
            </h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={calc.grafico}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#30363D" />
                  <XAxis
                    dataKey="mes"
                    stroke="#8B949E"
                    tick={{ fill: "#8B949E", fontSize: 12 }}
                    label={{ value: "Meses", position: "insideBottomRight", offset: -5, fill: "#8B949E" }}
                  />
                  <YAxis
                    stroke="#8B949E"
                    tick={{ fill: "#8B949E", fontSize: 12 }}
                    tickFormatter={(v: number) =>
                      v >= 1000 || v <= -1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#161B22",
                      border: "1px solid #30363D",
                      borderRadius: "8px",
                      color: "#fff",
                    }}
                    formatter={(v: unknown) => [fmt(Number(v)), "Acumulado"]}
                    labelFormatter={(l: unknown) => `Mês ${l}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="acumulado"
                    stroke="#C9A84C"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 5, fill: "#C9A84C" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* ─── COMPARTILHAR ──────────────────────────────────────────── */}
        <div className="flex justify-center">
          <button
            onClick={handleShare}
            className="rounded-lg bg-[#C9A84C] px-8 py-3 font-semibold text-[#0D1117] transition-colors hover:bg-[#B89443]"
          >
            Compartilhar Simulação
          </button>
        </div>

        {/* ─── FOOTER ────────────────────────────────────────────────── */}
        <footer className="border-t border-[#30363D] pt-6 text-center text-sm text-[#8B949E]">
          <p>
            <span className="font-semibold text-[#C9A84C]">BLEV EDUCAÇÃO</span> &{" "}
            <span className="font-semibold text-[#C9A84C]">GUILHERME BENTO</span>
          </p>
        </footer>
      </div>
    </div>
  );
}

// ─── Small components ────────────────────────────────────────────────────────

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold text-white" : "text-[#C9D1D9]"}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-[#30363D]" />;
}
