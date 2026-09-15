# PLUGGON

> ## ⚠ HTML exportado para cliente — regras permanentes
>
> Os relatórios HTML baixados pela plataforma (Mapa de Calor, score de ponto,
> inteligência de mercado) são **material comercial**: o cliente abre o arquivo
> em reunião, às vezes meses depois, de `file://`, sem internet boa ou atrás de
> firewall corporativo. Por decisão de produto:
>
> 1. **O HTML exportado é autocontido.** Nenhuma dependência externa bloqueante:
>    nada de `<script src>`, `<link rel="stylesheet">`, `@import` ou fonte de CDN.
>    O Leaflet vai embutido (`src/lib/heatmap/leaflet-vendor.ts`, gerado por
>    `npm run vendor:leaflet`). **Não reintroduza `<script src>` no `report-html.ts`.**
> 2. **Os tiles da base cartográfica são a única requisição de rede**, e não
>    bloqueiam a primeira pintura. Se não carregarem, o mapa degrada: fundo
>    neutro, pontos e círculos visíveis, e um aviso de que pontos, raios e
>    contagens continuam válidos. Nunca tela branca.
> 3. **Listas e contadores não dependem do mapa.** Saem prontos no HTML; o mapa
>    é uma camada visual sobre um documento que já se sustenta sozinho.
> 4. A regressão ao vivo (`npm run test:heatmap-live`) abre cada HTML no Chrome
>    online, sem rede, com firewall pendurado e sem Leaflet, e falha se alguma
>    dessas regras quebrar.
>
> ### 🔒 Chave do CARTO: NÃO restringir por domínio, NÃO rotacionar
>
> **A chave do CARTO vai embutida em cada HTML exportado.** Enquanto houver
> relatório em campo, ela **não pode ser restringida por domínio nem rotacionada
> ou revogada**: cada arquivo busca os tiles na hora em que é aberto, de
> `file://`, sem `Referer` — restringir ou trocar a chave quebra a base
> cartográfica de **todos** os relatórios já entregues, e não há como recolher
> arquivo que está com cliente.
>
> | Variável | Uso |
> |---|---|
> | `NEXT_PUBLIC_CARTO_API_KEY` | mapas do app **e**, hoje, a chave gravada nos HTML exportados |
> | `NEXT_PUBLIC_CARTO_EXPORT_API_KEY` | opcional; se existir, substitui a de cima **só nos HTML exportados** |
>
> - Hoje é **uma chave só** (sem `NEXT_PUBLIC_CARTO_EXPORT_API_KEY`), então a
>   chave do app **também** não pode ser restrita.
> - **Para separar um dia:** a chave **atual** vira `NEXT_PUBLIC_CARTO_EXPORT_API_KEY`
>   (continua intocável: está dentro dos relatórios enviados) e uma chave **nova**
>   vai para `NEXT_PUBLIC_CARTO_API_KEY` — só essa nova pode ser restrita.
> - Sem **nenhuma** das duas, a exportação falha com erro explícito: nunca sai
>   HTML sem base cartográfica.
>
> Licenciamento da base cartográfica (termos da CARTO gratuita): issue #1.

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
