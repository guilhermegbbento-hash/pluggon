# Regressão ao vivo — Mapa de Calor

Só métricas agregadas (contagens, distâncias máximas, descartes por motivo). Nenhum conteúdo do Google é versionado. Gerado por `npm run test:heatmap-live`.

## 2026-09-14T22:18:03.186Z — gerador v3.2.0 — código 7d15ae9414154b77 — APROVADO

| Caso | Modo | Raio (origem) | Âncoras | Compl. | Conc. (DC/AC/NI) | Dist. máx âncora / compl. / conc. | Fora do raio | Tipo inválido | Duplicata | Ponto de ônibus s/ terminal | Buscas truncadas | fitBounds = escopo | QA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a) Morumbi — São Paulo/SP | bairro | 1,76 km (bounds) | 30 | 119 | 11 (2/5/4) | 1,71 / 1,76 / 1,64 km | 81 | 0 | 12 | 0 | 0 | sim | ok |
| b) Itaim Bibi — São Paulo/SP | bairro | 1,50 km (bounds) | 38 | 164 | 59 (1/42/16) | 1,47 / 1,50 / 1,42 km | 82 | 0 | 24 | 2 | 1 | sim | ok |
| c) Batel — Curitiba/PR | bairro | 1,50 km (bounds) | 71 | 299 | 28 (2/16/10) | 1,46 / 1,50 / 1,41 km | 125 | 0 | 15 | 1 | 1 | sim | ok |
| d) Centro — Florianópolis/SC | bairro | 5,00 km (bounds) | 114 | 401 | 39 (6/28/5) | 4,96 / 4,97 / 4,74 km | 31 | 0 | 14 | 0 | 1 | sim | ok |
| e) Jardim Ângela — São Paulo/SP | bairro | 2,00 km (fallback) | 12 | 60 | 0 (0/0/0) | 1,70 / 1,89 / 0,00 km | 54 | 0 | 1 | 0 | 0 | sim | ok |
| f) Curitiba/PR (cidade inteira) | cidade | 19,29 km (bounds) | 130 | 356 | 89 (14/48/27) | 17,98 / 14,11 / 18,32 km | 1 | 0 | 13 | 7 | 1 | sim | ok |

Desambiguação (têm que abortar):
- x1) Morumbi — Curitiba/PR: abortou (bairro_nao_encontrado)
- x2) Bairro inexistente — Curitiba/PR: abortou (bairro_nao_encontrado)

## 2026-09-14T22:24:12.181Z — gerador v3.2.0 — código 705725cd0bd4670e — APROVADO

| Caso | Modo | Raio (origem) | Âncoras | Compl. | Conc. (DC/AC/NI) | Dist. máx âncora / compl. / conc. | Fora do raio | Tipo inválido | Tipo principal divergente | Duplicata | Ponto de ônibus s/ terminal | Aeroporto s/ porte | Buscas truncadas | fitBounds = escopo | QA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a) Morumbi — São Paulo/SP | bairro | 1,76 km (bounds) | 29 | 113 | 11 (2/5/4) | 1,71 / 1,76 / 1,64 km | 82 | 0 | 1 | 12 | 0 | 0 | 0 | sim | ok |
| b) Itaim Bibi — São Paulo/SP | bairro | 1,50 km (bounds) | 34 | 145 | 59 (1/42/16) | 1,47 / 1,50 / 1,42 km | 82 | 0 | 4 | 24 | 2 | 0 | 1 | sim | ok |
| c) Batel — Curitiba/PR | bairro | 1,50 km (bounds) | 69 | 294 | 28 (2/16/10) | 1,46 / 1,50 / 1,41 km | 125 | 0 | 2 | 15 | 1 | 0 | 1 | sim | ok |
| d) Centro — Florianópolis/SC | bairro | 5,00 km (bounds) | 113 | 400 | 40 (7/28/5) | 4,96 / 4,97 / 4,74 km | 31 | 0 | 1 | 14 | 0 | 0 | 1 | sim | ok |
| e) Jardim Ângela — São Paulo/SP | bairro | 2,00 km (fallback) | 12 | 60 | 0 (0/0/0) | 1,70 / 1,89 / 0,00 km | 53 | 0 | 0 | 1 | 0 | 0 | 0 | sim | ok |
| f) Curitiba/PR (cidade inteira) | cidade | 19,29 km (bounds) | 128 | 351 | 88 (14/48/26) | 17,98 / 9,81 / 18,32 km | 1 | 0 | 1 | 13 | 7 | 1 | 1 | sim | ok |

Desambiguação (têm que abortar):
- x1) Morumbi — Curitiba/PR: abortou (bairro_nao_encontrado)
- x2) Bairro inexistente — Curitiba/PR: abortou (bairro_nao_encontrado)

## 2026-09-14T23:08:06.410Z — gerador v3.2.0 — código 796e78df89d08c21 — APROVADO

| Caso | Modo | Raio (origem; cobertura) | Âncoras | Compl. | Conc. (DC/AC/NI) | Busca conc.: células / prof. / no teto | Dist. máx âncora / compl. / conc. | Fora do raio | Tipo inválido | Tipo principal divergente | Duplicata | Ponto de ônibus s/ terminal | Aeroporto s/ porte | Compl. sem âncora ≤ 500 m | Buscas de apoio no teto | fitBounds = escopo | QA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a) Morumbi — São Paulo/SP | bairro | 1,76 km (bounds; 96%) | 28 | 112 | 11 (2/5/4) | 3 / 0 / 0 | 1,71 / 1,76 / 1,64 km | 80 | 0 | 1 | 16 | 0 | 0 | 57 | 2 | sim | ok |
| b) Itaim Bibi — São Paulo/SP | bairro | 1,50 km (bounds, piso; 99%) | 34 | 146 | 134 (4/88/42) | 42 / 4 / 0 | 1,47 / 1,50 / 1,50 km | 113 | 0 | 4 | 25 | 2 | 0 | 50 | 2 | sim | ok |
| c) Batel — Curitiba/PR | bairro | 1,50 km (bounds, piso; 99%) | 66 | 281 | 43 (6/20/17) | 15 / 2 / 0 | 1,46 / 1,50 / 1,48 km | 137 | 0 | 2 | 16 | 1 | 0 | 1 | 5 | sim | ok |
| d) Centro — Florianópolis/SC | bairro | 5,00 km (bounds, teto; 56%) | 107 | 392 | 71 (11/46/14) | 27 / 3 / 0 | 4,96 / 4,97 / 4,83 km | 41 | 0 | 1 | 24 | 0 | 0 | 81 | 10 | sim | ok |
| e) Jardim Ângela — São Paulo/SP | bairro | 2,00 km (fallback; —) | 12 | 60 | 0 (0/0/0) | 3 / 0 / 0 | 1,70 / 1,91 / 0,00 km | 45 | 0 | 0 | 1 | 0 | 0 | 78 | 1 | sim | ok |
| f) Curitiba/PR (cidade inteira) | cidade | 19,29 km (bounds; 82%) | 125 | 359 | 252 (47/113/92) | 91 / 6 / 0 | 17,98 / 9,81 / 18,44 km | 4 | 0 | 1 | 20 | 7 | 1 | 177 | 12 | sim | ok |

Desambiguação (têm que abortar):
- x1) Morumbi — Curitiba/PR: abortou (bairro_nao_encontrado)
- x2) Bairro inexistente — Curitiba/PR: abortou (bairro_nao_encontrado)

## 2026-09-14T23:14:29.934Z — gerador v3.2.0 — código 3a1d73ba49365c7a — APROVADO

| Caso | Modo | Raio (origem; cobertura) | Âncoras | Compl. | Conc. (DC/AC/NI) | Busca conc.: células / prof. / no teto | Dist. máx âncora / compl. / conc. | Fora do raio | Tipo inválido | Tipo principal divergente | Duplicata | Ponto de ônibus s/ terminal | Aeroporto s/ porte | Compl. sem âncora ≤ 500 m | Buscas de apoio no teto | fitBounds = escopo | QA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a) Morumbi — São Paulo/SP | bairro | 1,76 km (bounds; 96%) | 28 | 112 | 11 (2/5/4) | 3 / 0 / 0 | 1,71 / 1,76 / 1,64 km | 80 | 0 | 1 | 16 | 0 | 0 | 57 | 2 | sim | ok |
| b) Itaim Bibi — São Paulo/SP | bairro | 1,50 km (bounds, piso; 99%) | 34 | 146 | 134 (4/88/42) | 42 / 4 / 0 | 1,47 / 1,50 / 1,50 km | 113 | 0 | 4 | 25 | 2 | 0 | 50 | 2 | sim | ok |
| c) Batel — Curitiba/PR | bairro | 1,50 km (bounds, piso; 99%) | 66 | 281 | 43 (6/20/17) | 15 / 2 / 0 | 1,46 / 1,50 / 1,48 km | 137 | 0 | 2 | 16 | 1 | 0 | 1 | 5 | sim | ok |
| d) Centro — Florianópolis/SC | bairro | 5,00 km (bounds, teto; 56%) | 107 | 392 | 71 (11/46/14) | 27 / 3 / 0 | 4,96 / 4,97 / 4,83 km | 41 | 0 | 1 | 24 | 0 | 0 | 81 | 10 | sim | ok |
| e) Jardim Ângela — São Paulo/SP | bairro | 2,00 km (fallback; —) | 12 | 60 | 0 (0/0/0) | 3 / 0 / 0 | 1,70 / 1,91 / 0,00 km | 45 | 0 | 0 | 1 | 0 | 0 | 78 | 1 | sim | ok |
| f) Curitiba/PR (cidade inteira) | cidade | 19,29 km (bounds; 82%) | 125 | 359 | 252 (47/113/92) | 91 / 6 / 0 | 17,98 / 9,81 / 18,44 km | 4 | 0 | 1 | 20 | 7 | 1 | 178 | 12 | sim | ok |

Desambiguação (têm que abortar):
- x1) Morumbi — Curitiba/PR: abortou (bairro_nao_encontrado)
- x2) Bairro inexistente — Curitiba/PR: abortou (bairro_nao_encontrado)

## 2026-09-14T23:18:38.449Z — gerador v3.2.0 — código 6edd3696756dae79 — APROVADO

| Caso | Modo | Raio (origem; cobertura) | Âncoras | Compl. | Conc. (DC/AC/NI) | Busca conc.: células / prof. / no teto | Dist. máx âncora / compl. / conc. | Fora do raio | Tipo inválido | Tipo principal divergente | Duplicata | Ponto de ônibus s/ terminal | Aeroporto s/ porte | Compl. sem âncora ≤ 500 m | Buscas de apoio no teto | fitBounds = escopo | Render no navegador | QA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a) Morumbi — São Paulo/SP | bairro | 1,76 km (bounds; 96%) | 28 | 112 | 11 (2/5/4) | 3 / 0 / 0 | 1,71 / 1,76 / 1,64 km | 80 | 0 | 1 | 16 | 0 | 0 | 57 | 2 | sim | ok | ok |
| b) Itaim Bibi — São Paulo/SP | bairro | 1,50 km (bounds, piso; 99%) | 34 | 146 | 134 (4/88/42) | 42 / 4 / 0 | 1,47 / 1,50 / 1,50 km | 113 | 0 | 4 | 25 | 2 | 0 | 50 | 2 | sim | ok | ok |
| c) Batel — Curitiba/PR | bairro | 1,50 km (bounds, piso; 99%) | 66 | 281 | 43 (6/20/17) | 15 / 2 / 0 | 1,46 / 1,50 / 1,48 km | 137 | 0 | 2 | 16 | 1 | 0 | 1 | 5 | sim | ok | ok |
| d) Centro — Florianópolis/SC | bairro | 5,00 km (bounds, teto; 56%) | 107 | 392 | 71 (11/46/14) | 27 / 3 / 0 | 4,96 / 4,97 / 4,83 km | 41 | 0 | 1 | 24 | 0 | 0 | 81 | 10 | sim | ok | ok |
| e) Jardim Ângela — São Paulo/SP | bairro | 2,00 km (fallback; —) | 12 | 60 | 0 (0/0/0) | 3 / 0 / 0 | 1,70 / 1,91 / 0,00 km | 45 | 0 | 0 | 1 | 0 | 0 | 78 | 1 | sim | ok | ok |
| f) Curitiba/PR (cidade inteira) | cidade | 19,29 km (bounds; 82%) | 125 | 359 | 252 (47/113/92) | 91 / 6 / 0 | 17,98 / 9,81 / 18,44 km | 4 | 0 | 1 | 20 | 7 | 1 | 178 | 12 | sim | ok | ok |

Desambiguação (têm que abortar):
- x1) Morumbi — Curitiba/PR: abortou (bairro_nao_encontrado)
- x2) Bairro inexistente — Curitiba/PR: abortou (bairro_nao_encontrado)

## 2026-09-15T20:29:06.909Z — gerador v3.2.1 — código df52cd8bf97a86de — APROVADO

| Caso | Modo | Raio (origem; cobertura) | Âncoras | Compl. | Conc. (DC/AC/NI) | Busca conc.: células / prof. / no teto | Dist. máx âncora / compl. / conc. | Fora do raio | Tipo inválido | Tipo principal divergente | Duplicata | Ponto de ônibus s/ terminal | Aeroporto s/ porte | Compl. sem âncora ≤ 500 m | Buscas de apoio no teto | fitBounds = escopo | Render: online / sem rede / firewall pendurado / sem Leaflet / sem JS | 1ª pintura máx | QA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a) Morumbi — São Paulo/SP | bairro | 1,76 km (bounds; 96%) | 28 | 113 | 11 (2/5/4) | 3 / 0 / 0 | 1,71 / 1,76 / 1,64 km | 82 | 0 | 1 | 15 | 0 | 0 | 60 | 2 | sim | ok / ok / ok / ok / ok | 212 ms | ok |
| b) Itaim Bibi — São Paulo/SP | bairro | 1,50 km (bounds, piso; 99%) | 36 | 151 | 134 (4/88/42) | 42 / 4 / 0 | 1,49 / 1,50 / 1,50 km | 120 | 0 | 4 | 23 | 2 | 0 | 29 | 2 | sim | ok / ok / ok / ok / ok | 280 ms | ok |
| c) Batel — Curitiba/PR | bairro | 1,50 km (bounds, piso; 99%) | 66 | 284 | 43 (6/20/17) | 15 / 2 / 0 | 1,49 / 1,50 / 1,48 km | 134 | 0 | 2 | 19 | 1 | 0 | 4 | 5 | sim | ok / ok / ok / ok / ok | 296 ms | ok |
| d) Centro — Florianópolis/SC | bairro | 5,00 km (bounds, teto; 56%) | 110 | 406 | 71 (11/46/14) | 27 / 3 / 0 | 4,96 / 4,97 / 4,83 km | 40 | 0 | 1 | 27 | 0 | 0 | 78 | 10 | sim | ok / ok / ok / ok / ok | 372 ms | ok |
| e) Jardim Ângela — São Paulo/SP | bairro | 2,00 km (fallback; —) | 12 | 60 | 0 (0/0/0) | 3 / 0 / 0 | 1,70 / 1,88 / 0,00 km | 51 | 0 | 0 | 3 | 0 | 0 | 75 | 1 | sim | ok / ok / ok / ok / ok | 212 ms | ok |
| f) Curitiba/PR (cidade inteira) | cidade | 19,29 km (bounds; 82%) | 126 | 373 | 252 (47/113/92) | 95 / 6 / 0 | 17,98 / 9,81 / 18,44 km | 3 | 0 | 1 | 23 | 7 | 0 | 127 | 12 | sim | ok / ok / ok / ok / ok | 356 ms | ok |

Desambiguação (têm que abortar):
- x1) Morumbi — Curitiba/PR: abortou (bairro_nao_encontrado)
- x2) Bairro inexistente — Curitiba/PR: abortou (bairro_nao_encontrado)

> **Como ler o tempo:** a prova de tempo é a coluna "1ª pintura máx" (first-contentful-paint, medida em tempo real via Chrome DevTools Protocol, HTML aberto de `file://`). Os prints (`.heatmap-regression-output/<caso>.<cenário>.png`) mostram *o que* o cliente vê, não *quando*: com a página travada esperando rede, o Chrome só entrega a captura depois que ela destrava — um print pedido "aos 5 s" pode mostrar o estado de 30 s. "firewall pendurado" = proxy que aceita a conexão e nunca responde; "sem Leaflet" = cópia do HTML sem o Leaflet embutido; "sem JS" = JavaScript desligado.
