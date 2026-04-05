"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type HistoryKind = "map" | "score" | "bp";
type FilterKind = "all" | HistoryKind;

interface HistoryItem {
  id: number;
  kind: HistoryKind;
  city: string;
  state: string;
  status: string;
  created_at: string;
  raw: Record<string, unknown>;
}

const KIND_LABEL: Record<HistoryKind, string> = {
  map: "Mapa",
  score: "Score",
  bp: "BP",
};

const KIND_BADGE: Record<HistoryKind, string> = {
  map: "bg-[#1F3A5F] text-[#7FB3E8]",
  score: "bg-[#3A2F1F] text-[#C9A84C]",
  bp: "bg-[#1F3A2F] text-[#7FD8A8]",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<FilterKind>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError("Sessão expirada. Faça login novamente.");
        setLoading(false);
        return;
      }

      const [cityRes, scoreRes, bpRes] = await Promise.all([
        supabase
          .from("city_analyses")
          .select("id, city, state, status, created_at, population, ev_count, charger_count")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("point_scores")
          .select(
            "id, city, state, status, created_at, address, establishment_name, establishment_type, overall_score, classification"
          )
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("business_plans")
          .select(
            "id, city, state, status, created_at, client_name, client_email, capital_available, objective"
          )
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
      ]);

      if (cityRes.error || scoreRes.error || bpRes.error) {
        setError(
          cityRes.error?.message ||
            scoreRes.error?.message ||
            bpRes.error?.message ||
            "Erro ao carregar histórico."
        );
        setLoading(false);
        return;
      }

      const combined: HistoryItem[] = [
        ...(cityRes.data ?? []).map((r) => ({
          id: r.id as number,
          kind: "map" as HistoryKind,
          city: r.city as string,
          state: r.state as string,
          status: (r.status as string) ?? "done",
          created_at: r.created_at as string,
          raw: r as Record<string, unknown>,
        })),
        ...(scoreRes.data ?? []).map((r) => ({
          id: r.id as number,
          kind: "score" as HistoryKind,
          city: (r.city as string) ?? "—",
          state: (r.state as string) ?? "—",
          status: (r.status as string) ?? "done",
          created_at: r.created_at as string,
          raw: r as Record<string, unknown>,
        })),
        ...(bpRes.data ?? []).map((r) => ({
          id: r.id as number,
          kind: "bp" as HistoryKind,
          city: (r.city as string) ?? "—",
          state: (r.state as string) ?? "—",
          status: (r.status as string) ?? "done",
          created_at: r.created_at as string,
          raw: r as Record<string, unknown>,
        })),
      ].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setItems(combined);
      setLoading(false);
    }

    load();
  }, []);

  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.kind === filter)),
    [items, filter]
  );

  function toggle(key: string) {
    setExpanded((cur) => (cur === key ? null : key));
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-white">Histórico</h1>
      <p className="mt-1 text-[#8B949E]">
        Consulte análises e relatórios anteriores.
      </p>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap gap-2">
        {(["all", "map", "score", "bp"] as FilterKind[]).map((f) => {
          const active = filter === f;
          const label =
            f === "all" ? "Todos" : f === "map" ? "Mapa" : f === "score" ? "Score" : "Business Plan";
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-[#C9A84C] text-[#0D1117]"
                  : "border border-[#30363D] bg-[#161B22] text-[#8B949E] hover:text-white"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="mt-6 overflow-hidden rounded-xl border border-[#30363D] bg-[#161B22]">
        {loading ? (
          <div className="p-8 text-center text-[#8B949E]">Carregando...</div>
        ) : error ? (
          <div className="p-8 text-center text-red-400">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-[#8B949E]">
            Nenhum registro encontrado.
          </div>
        ) : (
          <div className="divide-y divide-[#30363D]">
            {filtered.map((item) => {
              const key = `${item.kind}-${item.id}`;
              const isOpen = expanded === key;
              return (
                <div key={key}>
                  <button
                    onClick={() => toggle(key)}
                    className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-[#1C222A]"
                  >
                    <span
                      className={`inline-flex w-16 justify-center rounded-md px-2 py-1 text-xs font-semibold ${KIND_BADGE[item.kind]}`}
                    >
                      {KIND_LABEL[item.kind]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-white">
                        {item.city}
                        {item.state ? `/${item.state}` : ""}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-[#8B949E]">
                        {formatDate(item.created_at)}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        item.status === "done"
                          ? "bg-[#1F3A2F] text-[#7FD8A8]"
                          : item.status === "error"
                            ? "bg-[#3A1F1F] text-[#E88787]"
                            : "bg-[#2A2A2A] text-[#8B949E]"
                      }`}
                    >
                      {item.status}
                    </span>
                    <svg
                      className={`h-4 w-4 text-[#8B949E] transition-transform ${isOpen ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isOpen && (
                    <div className="border-t border-[#30363D] bg-[#0D1117] px-5 py-4 text-sm">
                      <ItemDetails item={item} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ItemDetails({ item }: { item: HistoryItem }) {
  const r = item.raw as Record<string, unknown>;

  if (item.kind === "map") {
    return (
      <div className="space-y-2 text-[#C9D1D9]">
        <Row label="População" value={fmtInt(r.population)} />
        <Row label="Frota elétrica" value={fmtInt(r.ev_count)} />
        <Row label="Eletropostos cadastrados" value={fmtInt(r.charger_count)} />
        <p className="mt-3 text-xs text-[#8B949E]">
          Abra a página de Mapa de Calor para executar uma nova análise.
        </p>
      </div>
    );
  }

  if (item.kind === "score") {
    return (
      <div className="space-y-2 text-[#C9D1D9]">
        <Row label="Endereço" value={(r.address as string) ?? "—"} />
        <Row label="Estabelecimento" value={(r.establishment_name as string) ?? "—"} />
        <Row label="Tipo" value={(r.establishment_type as string) ?? "—"} />
        <Row
          label="Score"
          value={
            r.overall_score != null
              ? `${Number(r.overall_score).toFixed(1)} — ${(r.classification as string) ?? ""}`
              : "—"
          }
        />
        {r.address ? (
          <Link
            href={`/dashboard/score?address=${encodeURIComponent(r.address as string)}&type=${encodeURIComponent(
              (r.establishment_type as string) ?? ""
            )}&name=${encodeURIComponent((r.establishment_name as string) ?? "")}`}
            className="mt-3 inline-block rounded-lg bg-[#C9A84C] px-4 py-2 text-xs font-semibold text-[#0D1117] hover:bg-[#B89443]"
          >
            Reabrir no Score do Ponto
          </Link>
        ) : null}
      </div>
    );
  }

  // bp
  return (
    <div className="space-y-2 text-[#C9D1D9]">
      <Row label="Cliente" value={(r.client_name as string) ?? "—"} />
      <Row label="Email" value={(r.client_email as string) ?? "—"} />
      <Row label="Capital disponível" value={(r.capital_available as string) ?? "—"} />
      <Row label="Objetivo" value={(r.objective as string) ?? "—"} />
      <Link
        href={`/bp-print/${item.id}`}
        target="_blank"
        className="mt-3 inline-block rounded-lg bg-[#C9A84C] px-4 py-2 text-xs font-semibold text-[#0D1117] hover:bg-[#B89443]"
      >
        Abrir Business Plan
      </Link>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-48 shrink-0 text-[#8B949E]">{label}</span>
      <span className="flex-1 text-white">{value}</span>
    </div>
  );
}

function fmtInt(v: unknown): string {
  if (v == null) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("pt-BR");
}
