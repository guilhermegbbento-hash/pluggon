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

## 2026-09-16T00:50:05.848Z — gerador v3.2.1 — código d3d4178759501ced — REPROVADO

| Caso | Modo | Raio (origem; cobertura) | Âncoras | Compl. | Conc. (DC/AC/NI) | Busca conc.: células / prof. / no teto | Dist. máx âncora / compl. / conc. | Fora do raio | Tipo inválido | Tipo principal divergente | Duplicata | Ponto de ônibus s/ terminal | Aeroporto s/ porte | Compl. sem âncora ≤ 500 m | Buscas de apoio no teto | fitBounds = escopo | Render: online / sem rede / firewall pendurado / sem Leaflet / sem JS | 1ª pintura máx | QA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a) Morumbi — São Paulo/SP | bairro | 2,16 km (bounds; 100%) | 36 | 145 | 17 (3/9/5) | 3 / 0 / 0 | 2,06 / 2,16 / 2,12 km | 126 | 0 | 3 | 17 | 0 | 0 | 89 | 2 | sim | ok / ok / ok / ok / ok | 320 ms | ok |
| b) Itaim Bibi — São Paulo/SP | bairro | 1,66 km (bounds; 100%) | 55 | 228 | 155 (4/104/47) | 46 / 4 / 0 | 1,64 / 1,66 / 1,66 km | 119 | 0 | 3 | 25 | 3 | 0 | 18 | 3 | sim | ok / ok / ok / ok / ok | 376 ms | ok |
| c) Batel — Curitiba/PR | bairro | 1,70 km (bounds; 100%) | 84 | 340 | 50 (10/21/19) | 15 / 2 / 0 | 1,68 / 1,69 / 1,68 km | 160 | 0 | 2 | 21 | 1 | 0 | 2 | 9 | sim | ok / ok / ok / ok / ok | 400 ms | ok |
| d) Centro — Florianópolis/SC | bairro | 9,77 km (bounds; 100%) | 113 | 351 | 113 (23/64/26) | 47 / 4 / 0 | 9,72 / 9,69 / 9,71 km | 66 | 0 | 1 | 14 | 0 | 2 | 126 | 11 | sim | ok / FALHOU (1) / ok / ok / ok | 384 ms | ok |
| e) Jardim Ângela — São Paulo/SP | bairro | 2,00 km (fallback; —) | 12 | 60 | 0 (0/0/0) | 3 / 0 / 0 | 1,70 / 1,91 / 0,00 km | 47 | 0 | 0 | 2 | 0 | 0 | 75 | 1 | sim | ok / ok / ok / ok / ok | 284 ms | ok |
| f) Curitiba/PR (cidade inteira) | cidade | 20,00 km (bounds, teto; 85%) | 125 | 341 | 252 (47/113/92) | 91 / 6 / 0 | 17,98 / 9,81 / 18,44 km | 3 | 0 | 1 | 24 | 7 | 1 | 183 | 12 | sim | — | — | ok |

Desambiguação (têm que abortar):
- x1) Morumbi — Curitiba/PR: abortou (bairro_nao_encontrado)
- x2) Bairro inexistente — Curitiba/PR: abortou (bairro_nao_encontrado)

> **Como ler o tempo:** a prova de tempo é a coluna "1ª pintura máx" (first-contentful-paint, medida em tempo real via Chrome DevTools Protocol, HTML aberto de `file://`). Os prints (`.heatmap-regression-output/<caso>.<cenário>.png`) mostram *o que* o cliente vê, não *quando*: com a página travada esperando rede, o Chrome só entrega a captura depois que ela destrava — um print pedido "aos 5 s" pode mostrar o estado de 30 s. "firewall pendurado" = proxy que aceita a conexão e nunca responde; "sem Leaflet" = cópia do HTML sem o Leaflet embutido; "sem JS" = JavaScript desligado.

## 2026-09-16T01:59:14.228Z — gerador v3.2.1 — código 3fdc9d62a836ca7a — APROVADO

| Caso | Modo | Raio (origem; cobertura) | Âncoras | Compl. | Conc. (DC/AC/NI) | Busca conc.: células / prof. / no teto | Dist. máx âncora / compl. / conc. | Fora do raio | Tipo inválido | Tipo principal divergente | Duplicata | Ponto de ônibus s/ terminal | Aeroporto s/ porte | Compl. sem âncora ≤ 500 m | Buscas de apoio no teto | fitBounds = escopo | Render: online / sem rede / firewall pendurado / sem Leaflet / sem JS | 1ª pintura máx | QA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a) Morumbi — São Paulo/SP | bairro | 2,16 km (bounds; 100%) | 36 | 147 | 17 (3/9/5) | 3 / 0 / 0 | 2,16 / 2,16 / 2,12 km | 122 | 0 | 3 | 13 | 0 | 0 | 88 | 2 | sim | ok / ok / ok / ok / ok | 208 ms | ok |
| b) Itaim Bibi — São Paulo/SP | bairro | 1,66 km (bounds; 100%) | 56 | 227 | 155 (4/104/47) | 46 / 4 / 0 | 1,64 / 1,66 / 1,66 km | 117 | 0 | 4 | 14 | 3 | 0 | 19 | 3 | sim | ok / ok / ok / ok / ok | 268 ms | ok |
| c) Batel — Curitiba/PR | bairro | 1,70 km (bounds; 100%) | 83 | 335 | 50 (10/21/19) | 15 / 2 / 0 | 1,68 / 1,69 / 1,68 km | 163 | 0 | 2 | 20 | 1 | 0 | 2 | 8 | sim | ok / ok / ok / ok / ok | 232 ms | ok |
| d) Centro — Florianópolis/SC | bairro | 9,77 km (bounds; 100%) | 113 | 337 | 113 (23/64/26) | 47 / 4 / 0 | 9,72 / 9,69 / 9,71 km | 65 | 0 | 1 | 14 | 0 | 2 | 135 | 11 | sim | ok / ok / ok / ok / ok | 252 ms | ok |
| e) Jardim Ângela — São Paulo/SP | bairro | 2,00 km (fallback; —) | 12 | 60 | 0 (0/0/0) | 3 / 0 / 0 | 1,70 / 1,91 / 0,00 km | 48 | 0 | 0 | 2 | 0 | 0 | 81 | 1 | sim | ok / ok / ok / ok / ok | 164 ms | ok |
| f) Curitiba/PR (cidade inteira) | cidade | 20,00 km (bounds, teto; 85%) | 125 | 326 | 252 (47/113/92) | 91 / 6 / 0 | 17,98 / 9,81 / 18,44 km | 3 | 0 | 1 | 24 | 7 | 1 | 188 | 12 | sim | ok / ok / ok / ok / ok | 252 ms | ok |

Desambiguação (têm que abortar):
- x1) Morumbi — Curitiba/PR: abortou (bairro_nao_encontrado)
- x2) Bairro inexistente — Curitiba/PR: abortou (bairro_nao_encontrado)

> **Como ler o tempo:** a prova de tempo é a coluna "1ª pintura máx" (first-contentful-paint, medida em tempo real via Chrome DevTools Protocol, HTML aberto de `file://`). Os prints (`.heatmap-regression-output/<caso>.<cenário>.png`) mostram *o que* o cliente vê, não *quando*: com a página travada esperando rede, o Chrome só entrega a captura depois que ela destrava — um print pedido "aos 5 s" pode mostrar o estado de 30 s. "firewall pendurado" = proxy que aceita a conexão e nunca responde; "sem Leaflet" = cópia do HTML sem o Leaflet embutido; "sem JS" = JavaScript desligado.

## 2026-09-22T17:51:01.537Z — gerador v3.2.1 — código 70d86f16847af395 — REPROVADO (PARCIAL)

> ⚠ **Rodada parcial**: só 5 caso(s) rodaram. Ficaram de fora: f) Curitiba/PR (cidade inteira). "Aprovado" aqui NÃO cobre os casos que não rodaram.

| Caso | Modo | Raio (origem; cobertura) | Âncoras | Compl. | Conc. (DC/AC/NI) | Busca conc.: células / prof. / no teto | Dist. máx âncora / compl. / conc. | Fora do raio | Tipo inválido | Tipo principal divergente | Duplicata | Sem porte (ônibus/aero/hosp/shop/posto) | Abaixo do corte (régua/renda) | Compl. sem âncora ≤ 500 m | Buscas de apoio no teto | fitBounds = escopo | Render: online / sem rede / firewall pendurado / sem Leaflet / sem JS | 1ª pintura máx | QA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a) Morumbi — São Paulo/SP | bairro | 2,16 km (bounds; 100%) | 31 | 155 | 17 (3/9/5) | 3 / 0 / 0 | 2,12 / 2,15 / 2,12 km | 54 | 0 | 3 | 20 | 0/0/12/5/7 | 0/0 | 0 | 0 | sim | ok / ok / ok / ok / ok | 192 ms | ok |
| b) Itaim Bibi — São Paulo/SP | ERRO: QaGateError: QA gate reprovou o relatório (15 violação(ões)):
- [referencia_inexistente] complementar "Estapar Estacionamentos" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "ACTION 360° - ESPORTE CLUBE PINHEIROS" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Itau-Faria Lima" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Mania de Churrasco| Prime Steak & Burger" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Varanda Faria Lima" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Charming 1-bedroom apartment in superb Vila Olímpia São Paulo with AC, WiFi" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Rac-Coon Smoke House" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Amazonense - Lanchonete e Restaurante" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Restaurante Sabores da Vida" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Just CT" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Tecnipark Estacionamentos" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "R. Dr. Alceu de Campos Rodrigues, 275 Garage" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Alojamento" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Tradição Lanchonete & Restaurante" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Cachoeira Grill" aponta para âncora ausente do mapa ||||||||||||||||||||
| c) Batel — Curitiba/PR | ERRO: QaGateError: QA gate reprovou o relatório (25 violação(ões)):
- [referencia_inexistente] complementar "Uoki Thai - Restaurante Tailandês" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Auto Park Silva Jardim" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Dassette Pharma" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "EROS - Confeitaria Artesanal" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Farmácia Massala Manipulação & Bem Estar" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Vgm Estacionamento" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Empório Madero Empanadas Batel" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Espaço Pamela Propst" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Madero Steak House Batel" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Burger King" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Trattoria Bella Italia Batel" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Park Me Estacionamento" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Garage Ñanderu Tattoo" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Bento Gastronomia" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "GFarma (Galênica) | Batel" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Estacio Park" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "saferunners" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Hotel Moov Curitiba" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Pizza em Casa Batel" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Saúde Animal na Dose Certa" aponta para âncora ausente do mapa ||||||||||||||||||||
| d) Centro — Florianópolis/SC | ERRO: QaGateError: QA gate reprovou o relatório (133 violação(ões)):
- [referencia_inexistente] complementar "PULSE Funcional e Práticas Corporais" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Kiosque da cana" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Suites Trindade" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Espaço aconchegante próximo a UFSC - One-Bedroom Apartment" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Assado Alemão" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Faculdade Católica de Santa Catarina - FACASC" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Studio Euthymia - Pilates" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Pantanal Lanches" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Padaria e Restaurante Bela Ilha" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "McDonald's" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Valdo Lanches" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Supermercado É de Casa" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Cambirela Hotel" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Restaurante Origens" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Camarão Manezinho" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "FNP São José - O Melhor Delivery de Frango Frito" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Gela Boca - São José" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Restaurante La Nonna - Almoço, Buffet Livre, Churrasco e Eventos" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Aos Sábados Feijoada" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Studio em prédio no Centro c/ Vista DIL0103" aponta para âncora ausente do mapa ||||||||||||||||||||
| e) Jardim Ângela — São Paulo/SP | ERRO: QaGateError: QA gate reprovou o relatório (5 violação(ões)):
- [referencia_inexistente] complementar "Mercearia Santana sikva" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Nossas Delícias" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Salgados fada" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "Jd Angela" aponta para âncora ausente do mapa
- [referencia_inexistente] complementar "PADARIA TURQUESA" aponta para âncora ausente do mapa ||||||||||||||||||||

Desambiguação (têm que abortar):
- x1) Morumbi — Curitiba/PR: abortou (bairro_nao_encontrado)
- x2) Bairro inexistente — Curitiba/PR: abortou (bairro_nao_encontrado)

> **Como ler o tempo:** a prova de tempo é a coluna "1ª pintura máx" (first-contentful-paint, medida em tempo real via Chrome DevTools Protocol, HTML aberto de `file://`). Os prints (`.heatmap-regression-output/<caso>.<cenário>.png`) mostram *o que* o cliente vê, não *quando*: com a página travada esperando rede, o Chrome só entrega a captura depois que ela destrava — um print pedido "aos 5 s" pode mostrar o estado de 30 s. "firewall pendurado" = proxy que aceita a conexão e nunca responde; "sem Leaflet" = cópia do HTML sem o Leaflet embutido; "sem JS" = JavaScript desligado.

## 2026-09-22T19:00:41.569Z — gerador v3.2.1 — código 26de123eef3c5ab1 — APROVADO (PARCIAL)

> ⚠ **Rodada parcial**: só 5 caso(s) rodaram. Ficaram de fora: f) Curitiba/PR (cidade inteira). "Aprovado" aqui NÃO cobre os casos que não rodaram.

| Caso | Modo | Raio (origem; cobertura) | Âncoras | Compl. | Conc. (DC/AC/NI) | Busca conc.: células / prof. / no teto | Dist. máx âncora / compl. / conc. | Fora do raio | Tipo inválido | Tipo principal divergente | Duplicata | Sem porte (ônibus/aero/hosp/shop/posto) | Abaixo do corte (régua/renda) | Compl. sem âncora ≤ 500 m | Buscas de apoio no teto | fitBounds = escopo | Render: online / sem rede / firewall pendurado / sem Leaflet / sem JS | 1ª pintura máx | QA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a) Morumbi — São Paulo/SP | bairro | 2,16 km (bounds; 100%) | 31 | 155 | 17 (3/9/5) | 3 / 0 / 0 | 2,12 / 2,15 / 2,12 km | 55 | 0 | 3 | 20 | 0/0/17/5/6 | 0/0 | 0 | 0 | sim | ok / ok / ok / ok / ok | 216 ms | ok |
| b) Itaim Bibi — São Paulo/SP | bairro | 1,66 km (bounds; 100%) | 44 | 220 | 158 (4/107/47) | 46 / 4 / 0 | 1,64 / 1,64 / 1,66 km | 76 | 0 | 2 | 32 | 3/0/8/7/12 | 3/0 | 0 | 0 | sim | ok / ok / ok / ok / ok | 224 ms | ok |
| c) Batel — Curitiba/PR | bairro | 1,70 km (bounds; 100%) | 64 | 320 | 50 (10/21/19) | 15 / 2 / 0 | 1,68 / 1,68 / 1,68 km | 66 | 0 | 2 | 50 | 1/0/13/26/7 | 5/0 | 0 | 0 | sim | ok / ok / ok / ok / ok | 216 ms | ok |
| d) Centro — Florianópolis/SC | bairro | 9,77 km (bounds; 100%) | 181 | 903 | 113 (23/64/26) | 47 / 4 / 0 | 9,72 / 9,76 / 9,71 km | 49 | 0 | 1 | 207 | 0/3/34/44/67 | 29/0 | 0 | 0 | sim | ok / ok / ok / ok / ok | 336 ms | ok |
| e) Jardim Ângela — São Paulo/SP | bairro | 2,00 km (fallback; —) | 8 | 40 | 0 (0/0/0) | 3 / 0 / 0 | 1,89 / 1,93 / 0,00 km | 8 | 0 | 0 | 1 | 0/0/3/4/1 | 1/0 | 0 | 0 | sim | ok / ok / ok / ok / ok | 188 ms | ok |

Desambiguação (têm que abortar):
- x1) Morumbi — Curitiba/PR: abortou (bairro_nao_encontrado)
- x2) Bairro inexistente — Curitiba/PR: abortou (bairro_nao_encontrado)

> **Como ler o tempo:** a prova de tempo é a coluna "1ª pintura máx" (first-contentful-paint, medida em tempo real via Chrome DevTools Protocol, HTML aberto de `file://`). Os prints (`.heatmap-regression-output/<caso>.<cenário>.png`) mostram *o que* o cliente vê, não *quando*: com a página travada esperando rede, o Chrome só entrega a captura depois que ela destrava — um print pedido "aos 5 s" pode mostrar o estado de 30 s. "firewall pendurado" = proxy que aceita a conexão e nunca responde; "sem Leaflet" = cópia do HTML sem o Leaflet embutido; "sem JS" = JavaScript desligado.
