import Link from "next/link";

const metrics = [
  { label: "Cidades Analisadas", value: "0" },
  { label: "Pontos Avaliados", value: "0" },
  { label: "BPs Gerados", value: "0" },
  { label: "Score Médio", value: "0" },
];

const modules = [
  {
    href: "/dashboard/heatmap",
    title: "Mapa de Calor",
    description: "Visualize as melhores regiões para instalação de eletropostos com dados geoespaciais.",
    icon: (
      <svg className="h-8 w-8 text-[#00D97E]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/score",
    title: "Score do Ponto",
    description: "Avalie a qualidade de um ponto específico com base em múltiplos critérios.",
    icon: (
      <svg className="h-8 w-8 text-[#00D97E]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/business-plan",
    title: "Business Plan",
    description: "Gere um plano de negócios completo com projeções financeiras e análise de viabilidade.",
    icon: (
      <svg className="h-8 w-8 text-[#00D97E]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
];

export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white">Dashboard</h1>
      <p className="mt-1 text-[#8B949E]">Visão geral da plataforma</p>

      {/* Metric Cards */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-xl border border-[#30363D] bg-[#161B22] p-6"
          >
            <p className="text-sm text-[#8B949E]">{metric.label}</p>
            <p className="mt-2 text-3xl font-bold text-white">{metric.value}</p>
          </div>
        ))}
      </div>

      {/* Module Cards */}
      <h2 className="mt-10 text-lg font-semibold text-white">Acesso Rápido</h2>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {modules.map((mod) => (
          <div
            key={mod.title}
            className="flex flex-col justify-between rounded-xl border border-[#30363D] bg-[#161B22] p-6"
          >
            <div>
              <div className="mb-4">{mod.icon}</div>
              <h3 className="text-lg font-semibold text-white">{mod.title}</h3>
              <p className="mt-2 text-sm text-[#8B949E]">{mod.description}</p>
            </div>
            <Link
              href={mod.href}
              className="mt-6 inline-flex items-center justify-center rounded-lg bg-[#00D97E] px-4 py-2.5 text-sm font-semibold text-[#0D1117] transition-colors hover:bg-[#00c06e]"
            >
              Iniciar Análise
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
