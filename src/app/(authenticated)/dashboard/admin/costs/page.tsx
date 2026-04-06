"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const ADMIN_EMAIL = "guilherme@bfranca.com"; // ajustar conforme necessário

interface UsageLog {
  id: number;
  user_id: string;
  module: string;
  city: string | null;
  claude_tokens_in: number;
  claude_tokens_out: number;
  claude_cost_usd: number;
  google_places_queries: number;
  google_places_cost_usd: number;
  total_cost_usd: number;
  created_at: string;
}

interface Summary {
  today: number;
  week: number;
  month: number;
  byModule: Record<string, number>;
  byCity: Record<string, number>;
}

export default function CostsPage() {
  const [logs, setLogs] = useState<UsageLog[]>([]);
  const [summary, setSummary] = useState<Summary>({
    today: 0,
    week: 0,
    month: 0,
    byModule: {},
    byCity: {},
  });
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filterModule, setFilterModule] = useState<string>("all");
  const [filterDays, setFilterDays] = useState<number>(30);
  const router = useRouter();

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || user.email !== ADMIN_EMAIL) {
        router.push("/dashboard");
        return;
      }
      setIsAdmin(true);

      // Fetch logs
      const since = new Date(
        Date.now() - filterDays * 24 * 60 * 60 * 1000
      ).toISOString();
      let query = supabase
        .from("usage_logs")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500);

      if (filterModule !== "all") {
        query = query.eq("module", filterModule);
      }

      const { data } = await query;
      const rows = (data || []) as UsageLog[];
      setLogs(rows);

      // Calculate summary
      const now = new Date();
      const todayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      ).toISOString();
      const weekStart = new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000
      ).toISOString();
      const monthStart = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000
      ).toISOString();

      const byModule: Record<string, number> = {};
      const byCity: Record<string, number> = {};
      let today = 0,
        week = 0,
        month = 0;

      for (const row of rows) {
        const cost = Number(row.total_cost_usd) || 0;
        const mod = row.module || "unknown";
        const city = row.city || "N/A";

        byModule[mod] = (byModule[mod] || 0) + cost;
        byCity[city] = (byCity[city] || 0) + cost;

        if (row.created_at >= monthStart) month += cost;
        if (row.created_at >= weekStart) week += cost;
        if (row.created_at >= todayStart) today += cost;
      }

      setSummary({ today, week, month, byModule, byCity });
      setLoading(false);
    }

    load();
  }, [filterModule, filterDays, router]);

  if (!isAdmin || loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#C9A84C]" />
      </div>
    );
  }

  const moduleLabels: Record<string, string> = {
    heatmap: "Mapa de Calor",
    score: "Score do Ponto",
    bp: "Business Plan",
    market: "Inteligência de Mercado",
    mentor: "Mentor BLEV",
  };

  const maxModuleCost = Math.max(
    ...Object.values(summary.byModule),
    0.001
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Painel de Custos</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-5">
          <p className="text-sm text-[#8B949E]">Custo Hoje</p>
          <p className="mt-1 text-2xl font-bold text-[#C9A84C]">
            US$ {summary.today.toFixed(4)}
          </p>
        </div>
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-5">
          <p className="text-sm text-[#8B949E]">Esta Semana</p>
          <p className="mt-1 text-2xl font-bold text-[#C9A84C]">
            US$ {summary.week.toFixed(4)}
          </p>
        </div>
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-5">
          <p className="text-sm text-[#8B949E]">Este Mes</p>
          <p className="mt-1 text-2xl font-bold text-[#C9A84C]">
            US$ {summary.month.toFixed(4)}
          </p>
        </div>
      </div>

      {/* Cost by module - bar chart */}
      <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-5">
        <h2 className="mb-4 text-lg font-semibold text-white">
          Custo por Modulo
        </h2>
        <div className="space-y-3">
          {Object.entries(summary.byModule)
            .sort(([, a], [, b]) => b - a)
            .map(([mod, cost]) => (
              <div key={mod} className="flex items-center gap-3">
                <span className="w-40 text-sm text-[#8B949E]">
                  {moduleLabels[mod] || mod}
                </span>
                <div className="flex-1 h-6 rounded bg-[#21262D] overflow-hidden">
                  <div
                    className="h-full rounded bg-[#C9A84C]"
                    style={{
                      width: `${(cost / maxModuleCost) * 100}%`,
                    }}
                  />
                </div>
                <span className="w-24 text-right text-sm font-mono text-white">
                  US$ {cost.toFixed(4)}
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* Cost by city */}
      <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-5">
        <h2 className="mb-4 text-lg font-semibold text-white">
          Custo por Cidade
        </h2>
        <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
          {Object.entries(summary.byCity)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 20)
            .map(([city, cost]) => (
              <div
                key={city}
                className="flex justify-between rounded-lg bg-[#21262D] px-3 py-2"
              >
                <span className="text-sm text-[#8B949E]">{city}</span>
                <span className="text-sm font-mono text-white">
                  US$ {cost.toFixed(4)}
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <select
          value={filterModule}
          onChange={(e) => setFilterModule(e.target.value)}
          className="rounded-lg border border-[#30363D] bg-[#21262D] px-3 py-2 text-sm text-white"
        >
          <option value="all">Todos os modulos</option>
          <option value="heatmap">Mapa de Calor</option>
          <option value="score">Score do Ponto</option>
          <option value="bp">Business Plan</option>
          <option value="market">Inteligencia de Mercado</option>
          <option value="mentor">Mentor BLEV</option>
        </select>
        <select
          value={filterDays}
          onChange={(e) => setFilterDays(Number(e.target.value))}
          className="rounded-lg border border-[#30363D] bg-[#21262D] px-3 py-2 text-sm text-white"
        >
          <option value={7}>Ultimos 7 dias</option>
          <option value={30}>Ultimos 30 dias</option>
          <option value={90}>Ultimos 90 dias</option>
          <option value={365}>Ultimo ano</option>
        </select>
      </div>

      {/* All logs table */}
      <div className="rounded-xl border border-[#30363D] bg-[#161B22] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#30363D] text-left text-[#8B949E]">
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Modulo</th>
                <th className="px-4 py-3">Cidade</th>
                <th className="px-4 py-3 text-right">Tokens In</th>
                <th className="px-4 py-3 text-right">Tokens Out</th>
                <th className="px-4 py-3 text-right">Claude USD</th>
                <th className="px-4 py-3 text-right">Google Queries</th>
                <th className="px-4 py-3 text-right">Google USD</th>
                <th className="px-4 py-3 text-right font-bold">Total USD</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="border-b border-[#30363D]/50 hover:bg-[#21262D]"
                >
                  <td className="px-4 py-2 text-[#8B949E]">
                    {new Date(log.created_at).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-2 text-white">
                    {moduleLabels[log.module] || log.module}
                  </td>
                  <td className="px-4 py-2 text-[#8B949E]">
                    {log.city || "-"}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-[#8B949E]">
                    {(log.claude_tokens_in || 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-[#8B949E]">
                    {(log.claude_tokens_out || 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-white">
                    ${Number(log.claude_cost_usd || 0).toFixed(4)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-[#8B949E]">
                    {log.google_places_queries || 0}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-white">
                    ${Number(log.google_places_cost_usd || 0).toFixed(4)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-bold text-[#C9A84C]">
                    ${Number(log.total_cost_usd || 0).toFixed(4)}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-8 text-center text-[#8B949E]"
                  >
                    Nenhum registro encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
