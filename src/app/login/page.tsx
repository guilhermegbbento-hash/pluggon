"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError("Email ou senha inválidos.");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0D1117] px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-5xl font-bold text-[#C9A84C] tracking-tight">
            BLEV
          </h1>
          <p className="mt-3 text-lg text-white">
            Intelligence
          </p>
          <p className="mt-1 text-sm text-[#8B949E]">
            Plataforma de Inteligência para Eletropostos
          </p>
        </div>

        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-8">
          <h2 className="mb-6 text-xl font-semibold text-white">Entrar</h2>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-medium text-[#8B949E]"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-3 text-white placeholder-[#484F58] outline-none transition-colors focus:border-[#C9A84C]"
                placeholder="seu@email.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-medium text-[#8B949E]"
              >
                Senha
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-3 text-white placeholder-[#484F58] outline-none transition-colors focus:border-[#C9A84C]"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[#C9A84C] px-4 py-3 font-semibold text-[#0D1117] transition-colors hover:bg-[#B89443] disabled:opacity-50"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
