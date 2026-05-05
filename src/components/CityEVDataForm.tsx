"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface CityEVManualData {
  bev: number | null;
  phev: number | null;
  chargersAC: number | null;
  chargersDC: number | null;
}

export const EMPTY_MANUAL_DATA: CityEVManualData = {
  bev: null,
  phev: null,
  chargersAC: null,
  chargersDC: null,
};

interface Props {
  city: string;
  state: string;
  value: CityEVManualData;
  onChange: (v: CityEVManualData) => void;
  disabled?: boolean;
}

function parseInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function formatBR(n: number | null): string {
  if (n === null) return "";
  return String(n);
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return "";
  }
}

export default function CityEVDataForm({ city, state, value, onChange, disabled }: Props) {
  const [cacheDate, setCacheDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!city || !state) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCacheDate(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setCacheDate(null);
    const supabase = createClient();
    supabase
      .from("city_ev_data")
      .select("bev, phev, chargers_ac, chargers_dc, updated_at")
      .eq("city", city)
      .eq("state", state)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) {
          onChangeRef.current({
            bev: data.bev ?? null,
            phev: data.phev ?? null,
            chargersAC: data.chargers_ac ?? null,
            chargersDC: data.chargers_dc ?? null,
          });
          setCacheDate(data.updated_at ?? null);
        } else {
          onChangeRef.current({ bev: null, phev: null, chargersAC: null, chargersDC: null });
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [city, state]);

  const totalEVs = (value.bev ?? 0) + (value.phev ?? 0);
  const totalChargers = (value.chargersAC ?? 0) + (value.chargersDC ?? 0);

  function update<K extends keyof CityEVManualData>(field: K, raw: string) {
    onChange({ ...value, [field]: parseInput(raw) });
  }

  const fieldClass =
    "w-full rounded-md border border-[#30363D] bg-[#0D1117] px-3 py-2 text-sm text-white placeholder-[#484F58] outline-none transition-colors focus:border-[#C9A84C] disabled:opacity-60";
  const computedClass =
    "w-full rounded-md border border-[#21262D] bg-[#0D1117] px-3 py-2 text-sm text-[#8B949E]";
  const labelClass = "mb-1 block text-xs font-medium text-[#C9D1D9]";

  return (
    <div className="rounded-lg border border-[#30363D] bg-[#0D1117]/60 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[#C9A84C]">
          Dados da Frota e Infraestrutura{" "}
          <span className="text-xs font-normal text-[#8B949E]">(opcional)</span>
        </h3>
        {loading && <span className="text-[10px] text-[#8B949E]">Buscando dados salvos...</span>}
        {!loading && cacheDate && (
          <span className="text-[10px] font-medium text-[#66BB6A]">
            Dados salvos em {formatDate(cacheDate)}
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-[#8B949E]">
        Preencha com dados reais da ABVE para maior precisão. Se deixar em branco, será estimado
        automaticamente.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B949E]">Frota</p>
          <div>
            <label className={labelClass}>BEV (100% Elétricos)</label>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="Ex: 6357"
              value={formatBR(value.bev)}
              onChange={(e) => update("bev", e.target.value)}
              disabled={disabled}
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>PHEV (Híbridos Plug-in)</label>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="Ex: 7453"
              value={formatBR(value.phev)}
              onChange={(e) => update("phev", e.target.value)}
              disabled={disabled}
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>
              Total EVs <span className="text-[10px] text-[#484F58]">(calculado)</span>
            </label>
            <div className={computedClass}>{totalEVs > 0 ? totalEVs.toLocaleString("pt-BR") : "—"}</div>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B949E]">
            Infraestrutura
          </p>
          <div>
            <label className={labelClass}>Carregadores AC</label>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="Ex: 305"
              value={formatBR(value.chargersAC)}
              onChange={(e) => update("chargersAC", e.target.value)}
              disabled={disabled}
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>Carregadores DC</label>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="Ex: 199"
              value={formatBR(value.chargersDC)}
              onChange={(e) => update("chargersDC", e.target.value)}
              disabled={disabled}
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>
              Total Carregadores <span className="text-[10px] text-[#484F58]">(calculado)</span>
            </label>
            <div className={computedClass}>
              {totalChargers > 0 ? totalChargers.toLocaleString("pt-BR") : "—"}
            </div>
          </div>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-[#8B949E]">
        Fonte recomendada:{" "}
        <a
          href="https://abve.org.br/abve-data"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#C9A84C] hover:underline"
        >
          abve.org.br/abve-data
        </a>
      </p>
    </div>
  );
}

export function hasAnyManualValue(m: CityEVManualData): boolean {
  return (
    (m.bev !== null && m.bev > 0) ||
    (m.phev !== null && m.phev > 0) ||
    (m.chargersAC !== null && m.chargersAC > 0) ||
    (m.chargersDC !== null && m.chargersDC > 0)
  );
}
