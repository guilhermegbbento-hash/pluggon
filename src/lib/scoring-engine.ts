export interface ScoreInput {
  // Dados cidade (IBGE)
  population: number;
  gdpPerCapita: number;

  // Dados do ponto
  establishmentType: string;
  is24h: boolean;
  observations: string;

  // Google Places - POIs no entorno
  restaurantsIn500m: number;
  farmaciasIn500m: number;
  supermercadosIn500m: number;
  postosIn500m: number;
  shoppingsIn1km: number;
  hospitaisIn1km: number;
  estacionamentosIn500m: number;

  // Concorrentes (do cache)
  totalCompetitorsCity: number;
  competitorsIn200m: number;
  competitorsIn2km: number;

  // Google Places - dados do local
  rating: number;
  reviews: number;

  // Localização
  lat: number;
  lng: number;
  cityLat: number;
  cityLng: number;
}

export interface ScoreVariable {
  id: number;
  name: string;
  category: string;
  score: number; // 0-10
  weight: number; // 1, 2, or 3
  justification: string;
}

export interface ScoreResult {
  overallScore: number;
  classification: string;
  variables: ScoreVariable[];
}

export function calculateScore(input: ScoreInput): ScoreResult {
  const vars: ScoreVariable[] = [];
  let id = 1;

  // Helper
  const add = (name: string, category: string, score: number, weight: number, just: string) => {
    vars.push({ id: id++, name, category, score: Math.min(10, Math.max(0, Math.round(score))), weight, justification: just });
  };

  // Distância ao centro da cidade (km)
  const distCenter = Math.sqrt(Math.pow((input.lat - input.cityLat) * 111, 2) + Math.pow((input.lng - input.cityLng) * 111 * Math.cos(input.cityLat * Math.PI / 180), 2));

  // Fator cidade: cidade grande tem base mais alta
  const cityFactor = input.population > 2000000 ? 1.0 : input.population > 1000000 ? 0.95 : input.population > 500000 ? 0.88 : input.population > 200000 ? 0.80 : input.population > 100000 ? 0.72 : 0.60;

  // ===== CATEGORIA 1: DEMANDA E MOBILIDADE (15 variáveis) =====

  // 1. Volume veículos estimado (Alto=3)
  const volScore = input.population > 1000000 ? 9 : input.population > 500000 ? 7 : input.population > 200000 ? 5 : input.population > 100000 ? 4 : 2;
  add('Volume de Veículos/Dia', 'Demanda e Mobilidade', volScore, 3, input.population > 500000 ? 'Cidade grande com alto fluxo' : 'Cidade de médio porte');

  // 2. Fluxo motoristas app (Alto=3)
  const appScore = input.population > 1000000 ? 9 : input.population > 500000 ? 7 : input.population > 200000 ? 5 : 3;
  add('Fluxo Motoristas App', 'Demanda e Mobilidade', appScore, 3, input.population > 500000 ? 'Alta concentração Uber/99' : 'Presença moderada de apps');

  // 3. Proximidade corredores principais (Alto=3)
  const corrScore = distCenter < 3 ? 9 : distCenter < 6 ? 7 : distCenter < 10 ? 5 : 3;
  add('Proximidade Corredores Principais', 'Demanda e Mobilidade', corrScore, 3, distCenter < 3 ? 'Próximo ao centro e vias principais' : distCenter < 6 ? 'Acesso moderado a vias principais' : 'Distante dos corredores principais');

  // 4. Fluxo pico manhã (Médio=2)
  const picoManha = ['posto_24h', 'shopping', 'rodoviaria', 'aeroporto'].includes(input.establishmentType) ? 8 : ['supermercado', 'universidade'].includes(input.establishmentType) ? 6 : 4;
  add('Fluxo Horário Pico Manhã', 'Demanda e Mobilidade', picoManha, 2, 'Estimativa por tipo de estabelecimento');

  // 5. Fluxo pico noite (Médio=2)
  const picoNoite = ['posto_24h', 'shopping', 'restaurante'].includes(input.establishmentType) ? 8 : ['hospital_24h', 'hotel'].includes(input.establishmentType) ? 7 : 4;
  add('Fluxo Horário Pico Noite', 'Demanda e Mobilidade', picoNoite, 2, 'Estimativa por tipo e operação');

  // 6. Fluxo noturno (Médio=2)
  const noturno = input.is24h ? 8 : ['hospital_24h', 'hotel', 'posto_24h'].includes(input.establishmentType) ? 7 : 2;
  add('Fluxo Noturno (22h-06h)', 'Demanda e Mobilidade', noturno, 2, input.is24h ? 'Operação 24h garante fluxo noturno' : 'Fluxo noturno limitado');

  // 7. Fluxo fim de semana (Médio=2)
  const fds = ['shopping', 'restaurante', 'hotel', 'posto_24h'].includes(input.establishmentType) ? 8 : ['universidade'].includes(input.establishmentType) ? 2 : 5;
  add('Fluxo Fim de Semana', 'Demanda e Mobilidade', fds, 2, 'Estimativa por tipo de estabelecimento');

  // 8. Padrão de tráfego (Médio=2)
  const padrao = ['posto_24h', 'shopping'].includes(input.establishmentType) ? 8 : ['universidade'].includes(input.establishmentType) ? 4 : 6;
  add('Padrão de Tráfego', 'Demanda e Mobilidade', padrao, 2, 'Constante = melhor para utilização');

  // 9. Proximidade rodovias (Alto=3)
  const rodovia = input.observations?.toLowerCase().includes('rodovia') || input.observations?.toLowerCase().includes('br-') ? 9 : distCenter < 5 ? 6 : 4;
  add('Proximidade Rodovias', 'Demanda e Mobilidade', rodovia, 3, input.observations?.toLowerCase().includes('rodovia') ? 'Próximo a rodovia' : 'Verificar proximidade a rodovias');

  // 10. Distância ao centro (Médio=2)
  const centroScore = distCenter < 2 ? 10 : distCenter < 4 ? 8 : distCenter < 7 ? 6 : distCenter < 12 ? 4 : 2;
  add('Distância ao Centro', 'Demanda e Mobilidade', centroScore, 2, distCenter.toFixed(1) + 'km do centro');

  // 11. Pontos taxi/Uber próximos (Baixo=1)
  add('Pontos Taxi/Uber Próximos', 'Demanda e Mobilidade', appScore > 6 ? 7 : 4, 1, 'Baseado na população');

  // 12. Proximidade terminal ônibus (Médio=2)
  const termScore = input.establishmentType === 'rodoviaria' ? 10 : distCenter < 3 ? 6 : 3;
  add('Proximidade Terminal Ônibus', 'Demanda e Mobilidade', termScore, 2, input.establishmentType === 'rodoviaria' ? 'É a rodoviária' : 'Verificar in loco');

  // 13. Proximidade aeroporto (Médio=2)
  const aeroScore = input.establishmentType === 'aeroporto' ? 10 : 4;
  add('Proximidade Aeroporto', 'Demanda e Mobilidade', aeroScore, 2, input.establishmentType === 'aeroporto' ? 'É o aeroporto' : 'Verificar distância');

  // 14. Proximidade rodoviária (Médio=2)
  const rodoScore = input.establishmentType === 'rodoviaria' ? 10 : distCenter < 3 ? 6 : 3;
  add('Proximidade Rodoviária', 'Demanda e Mobilidade', rodoScore, 2, input.establishmentType === 'rodoviaria' ? 'É a rodoviária' : 'Verificar distância');

  // 15. Veículos por habitante (Médio=2)
  const vphScore = input.gdpPerCapita > 50000 ? 8 : input.gdpPerCapita > 30000 ? 6 : 4;
  add('Veículos por Habitante', 'Demanda e Mobilidade', vphScore, 2, 'Estimativa baseada em PIB per capita');

  // ===== CATEGORIA 2: FROTA DE EVs (10 variáveis) =====

  // 16. Total EVs cidade (Alto=3)
  const evEstimate = input.population * (input.gdpPerCapita > 60000 ? 0.008 : input.gdpPerCapita > 40000 ? 0.005 : 0.002);
  const evScore = evEstimate > 10000 ? 9 : evEstimate > 5000 ? 8 : evEstimate > 2000 ? 6 : evEstimate > 500 ? 4 : 2;
  add('Total EVs na Cidade', 'Frota de EVs', evScore, 3, Math.round(evEstimate) + ' EVs estimados');

  // 17. Crescimento frota 12 meses (Alto=3)
  add('Crescimento Frota EV 12 Meses', 'Frota de EVs', 8, 3, 'Crescimento nacional 26% ao ano (ABVE 2025)');

  // 18. EVs por carregador rápido (Alto=3)
  const ratio = input.totalCompetitorsCity > 0 ? Math.round(evEstimate / input.totalCompetitorsCity) : 999;
  const ratioScore = ratio > 200 ? 10 : ratio > 100 ? 8 : ratio > 50 ? 6 : ratio > 20 ? 4 : 2;
  add('EVs por Carregador', 'Frota de EVs', ratioScore, 3, ratio > 200 ? 'Demanda muito reprimida' : ratio + ' EVs por carregador');

  // 19. Vendas mensais EVs (Alto=3)
  const vendasScore = input.population > 1000000 ? 8 : input.population > 500000 ? 7 : input.population > 200000 ? 5 : 3;
  add('Vendas Mensais EVs', 'Frota de EVs', vendasScore, 3, 'Estimativa baseada na população');

  // 20. Concessionárias EV (Médio=2)
  const concEV = input.population > 500000 ? 8 : input.population > 200000 ? 6 : 3;
  add('Concessionárias EV na Cidade', 'Frota de EVs', concEV, 2, input.population > 500000 ? 'BYD, GWM, Volvo presentes' : 'Verificar presença');

  // 21. Market share EVs (Médio=2)
  add('Market Share EVs Regional', 'Frota de EVs', 7, 2, 'Market share nacional 14% (fev/2026 ABVE)');

  // 22. Projeção frota 5 anos (Alto=3)
  add('Projeção Frota 5 Anos', 'Frota de EVs', 8, 3, 'Crescimento acelerado projetado');

  // 23. Frotas corporativas elétricas (Baixo=1)
  const frotasCorp = input.population > 500000 ? 7 : input.population > 200000 ? 5 : 3;
  add('Frotas Corporativas Elétricas', 'Frota de EVs', frotasCorp, 1, 'ML, Amazon, iFood presentes em cidades grandes');

  // 24. Locadoras com EVs (Baixo=1)
  const locScore = input.population > 500000 ? 6 : 3;
  add('Locadoras com EVs', 'Frota de EVs', locScore, 1, 'Verificar presença local');

  // 25. Densidade EVs/km² (Médio=2)
  const densEV = input.population > 1000000 ? 7 : input.population > 500000 ? 6 : 4;
  add('Densidade EVs/km²', 'Frota de EVs', densEV, 2, 'Estimativa baseada na população');

  // ===== CATEGORIA 3: CONCORRÊNCIA E SATURAÇÃO (10 variáveis) =====

  // 26. Total carregadores cidade (Alto=3)
  const totalCompScore = input.totalCompetitorsCity === 0 ? 8 : input.totalCompetitorsCity < 20 ? 7 : input.totalCompetitorsCity < 50 ? 6 : input.totalCompetitorsCity < 100 ? 5 : 5;
  add('Total Carregadores na Cidade', 'Concorrência', totalCompScore, 3, input.totalCompetitorsCity + ' identificados via Google Places');

  // 27. Carregadores DC rápidos (Alto=3)
  add('Carregadores DC Rápidos', 'Concorrência', 6, 3, 'Quantidade DC exata a verificar no carregados.com.br');

  // 28. Carregadores AC (Baixo=1)
  add('Carregadores AC Lentos', 'Concorrência', 6, 1, 'AC não compete diretamente com DC');

  // 29. Concorrentes raio 200m (Alto=3) - CRÍTICO
  const comp200 = input.competitorsIn200m === 0 ? 10 : input.competitorsIn200m === 1 ? 5 : input.competitorsIn200m <= 3 ? 3 : 1;
  add('Concorrência Direta (<200m)', 'Concorrência', comp200, 3, input.competitorsIn200m === 0 ? 'ZERO concorrentes diretos - excelente' : input.competitorsIn200m + ' concorrentes muito próximos');

  // 30. Concorrentes raio 2km (Médio=2)
  const comp2k = input.competitorsIn2km === 0 ? 9 : input.competitorsIn2km <= 3 ? 7 : input.competitorsIn2km <= 8 ? 5 : 4;
  add('Densidade Regional (2km)', 'Concorrência', comp2k, 2, input.competitorsIn2km + ' na região de 2km');

  // 31. Tipo concorrentes (Médio=2)
  add('Tipo Concorrentes Próximos', 'Concorrência', 6, 2, 'Tipo AC/DC a verificar in loco');

  // 32. Preço médio praticado (Médio=2)
  add('Preço Médio kWh na Região', 'Concorrência', 7, 2, 'Referência R$2,00/kWh');

  // 33. Disponibilidade concorrentes (Baixo=1)
  add('Disponibilidade Concorrentes', 'Concorrência', 6, 1, 'Verificar status operacional');

  // 34. Operadores na cidade (Baixo=1)
  add('Operadores na Cidade', 'Concorrência', 6, 1, 'Verificar no carregados.com.br');

  // 35. Saturação mercado (Alto=3)
  add('Saturação de Mercado', 'Concorrência', ratioScore, 3, ratio > 100 ? 'Mercado com espaço para crescimento' : 'Verificar saturação local');

  // ===== CATEGORIA 4: INFRAESTRUTURA DO LOCAL (10 variáveis) =====

  const infraScores: Record<string, number> = {
    shopping: 10, aeroporto: 10, rodoviaria: 9, hospital_24h: 9,
    supermercado: 8, posto_24h: 8, universidade: 8, hotel: 7,
    estacionamento: 7, terreno: 5, restaurante: 6, outro: 5
  };
  const infraBase = infraScores[input.establishmentType] || 5;

  // 36. Rede elétrica (Alto=3)
  add('Rede Elétrica Disponível', 'Infraestrutura', infraBase, 3, 'Estimativa por tipo - verificar conta de luz');

  // 37. Custo conexão (Médio=2)
  add('Custo Estimado Conexão', 'Infraestrutura', infraBase > 7 ? 7 : 5, 2, 'Estabelecimentos grandes geralmente tem rede adequada');

  // 38. Acessibilidade entrada/saída (Alto=3)
  const acessScore = ['shopping', 'posto_24h', 'supermercado', 'aeroporto'].includes(input.establishmentType) ? 9 : ['estacionamento', 'terreno'].includes(input.establishmentType) ? 7 : 6;
  add('Acessibilidade Entrada/Saída', 'Infraestrutura', acessScore, 3, 'Estimativa por tipo');

  // 39. Espaço físico (Alto=3)
  const espacoScore = ['shopping', 'aeroporto', 'terreno', 'supermercado', 'estacionamento'].includes(input.establishmentType) ? 9 : ['posto_24h'].includes(input.establishmentType) ? 8 : 6;
  add('Espaço Físico para Vagas', 'Infraestrutura', espacoScore, 3, 'Estimativa por tipo');

  // 40. Segurança (Alto=3)
  const segScore = ['shopping', 'aeroporto', 'hospital_24h'].includes(input.establishmentType) ? 9 : ['posto_24h', 'hotel', 'universidade'].includes(input.establishmentType) ? 7 : ['terreno'].includes(input.establishmentType) ? 5 : 6;
  add('Segurança do Local', 'Infraestrutura', segScore, 3, 'Estimativa por tipo');

  // 41. Iluminação (Médio=2)
  add('Iluminação', 'Infraestrutura', segScore > 7 ? 8 : 6, 2, 'Correlacionado com segurança');

  // 42. Acessibilidade PNE (Baixo=1)
  add('Acessibilidade PNE', 'Infraestrutura', ['shopping', 'aeroporto'].includes(input.establishmentType) ? 9 : 6, 1, 'Verificar conformidade');

  // 43. Operação 24h (Alto=3)
  const op24 = input.is24h ? 10 : ['hospital_24h', 'posto_24h'].includes(input.establishmentType) ? 10 : ['hotel'].includes(input.establishmentType) ? 8 : ['shopping'].includes(input.establishmentType) ? 7 : 4;
  add('Operação 24 Horas', 'Infraestrutura', op24, 3, input.is24h ? 'Opera 24h' : 'Horário a verificar');

  // 44. Cobertura chuva (Médio=2)
  const cobScore = ['shopping', 'estacionamento'].includes(input.establishmentType) ? 9 : ['posto_24h'].includes(input.establishmentType) ? 8 : ['terreno'].includes(input.establishmentType) ? 3 : 5;
  add('Cobertura contra Chuva', 'Infraestrutura', cobScore, 2, 'Estimativa por tipo');

  // 45. Distância quadro elétrico (Médio=2)
  add('Distância Quadro Elétrico', 'Infraestrutura', infraBase > 7 ? 7 : 5, 2, 'Verificar in loco - impacta custo instalação');

  // ===== CATEGORIA 5: AMENIDADES E CONVENIÊNCIA (10 variáveis) =====

  // 46. Tempo permanência (Alto=3)
  const tempoMap: Record<string, number> = {
    shopping: 10, restaurante: 9, universidade: 9, hotel: 10, hospital_24h: 7,
    supermercado: 7, posto_24h: 6, aeroporto: 8, rodoviaria: 7,
    estacionamento: 8, terreno: 5, outro: 5
  };
  add('Tempo de Permanência Típico', 'Amenidades', tempoMap[input.establishmentType] || 5, 3, 'Tempo ideal: 30-60min pra DC');

  // 47. Conveniência (Alto=3)
  const convScore = Math.min(10, 3 + input.restaurantsIn500m + input.farmaciasIn500m + input.supermercadosIn500m);
  add('Conveniência no Entorno', 'Amenidades', convScore, 3, input.restaurantsIn500m + ' restaurantes, ' + input.farmaciasIn500m + ' farmácias em 500m');

  // 48. Visibilidade (Alto=3)
  const visScore = ['shopping', 'posto_24h', 'supermercado'].includes(input.establishmentType) ? 9 : distCenter < 3 ? 7 : ['terreno'].includes(input.establishmentType) ? 5 : 6;
  add('Visibilidade da Rua', 'Amenidades', visScore, 3, 'Estimativa por tipo e localização');

  // 49. Tipo estabelecimento (Alto=3)
  const tipoMap: Record<string, number> = {
    posto_24h: 10, shopping: 9, aeroporto: 10, rodoviaria: 9,
    hospital_24h: 7, supermercado: 7, hotel: 8, estacionamento: 7,
    universidade: 7, terreno: 6, restaurante: 6, outro: 5
  };
  add('Tipo de Estabelecimento', 'Amenidades', tipoMap[input.establishmentType] || 5, 3, input.establishmentType);

  // 50. Serviços raio 200m (Médio=2)
  const serv200 = Math.min(10, input.restaurantsIn500m + input.farmaciasIn500m + input.postosIn500m);
  add('Serviços no Raio 200m', 'Amenidades', serv200, 2, 'POIs identificados via Google Places');

  // 51. Restaurantes raio 300m (Médio=2)
  const restScore = input.restaurantsIn500m >= 5 ? 9 : input.restaurantsIn500m >= 3 ? 7 : input.restaurantsIn500m >= 1 ? 5 : 2;
  add('Restaurantes no Raio 300m', 'Amenidades', restScore, 2, input.restaurantsIn500m + ' encontrados');

  // 52. Farmácias 24h (Baixo=1)
  add('Farmácias 24h no Raio 500m', 'Amenidades', input.farmaciasIn500m > 0 ? 7 : 2, 1, input.farmaciasIn500m + ' encontradas');

  // 53. Wi-Fi (Baixo=1)
  const wifiScore = ['shopping', 'universidade', 'hotel', 'aeroporto'].includes(input.establishmentType) ? 9 : 5;
  add('Wi-Fi Disponível', 'Amenidades', wifiScore, 1, 'Estimativa por tipo');

  // 54. Estacionamento vigilância (Médio=2)
  add('Estacionamento com Vigilância', 'Amenidades', segScore, 2, 'Correlacionado com segurança');

  // 55. Loja conveniência (Médio=2)
  const convLoja = ['shopping', 'posto_24h', 'supermercado'].includes(input.establishmentType) ? 9 : 4;
  add('Loja de Conveniência', 'Amenidades', convLoja, 2, 'Estimativa por tipo');

  // ===== CATEGORIA 6: DEMOGRAFIA E ECONOMIA (10 variáveis) =====

  // 56. População (Médio=2)
  const popScore = input.population > 2000000 ? 10 : input.population > 1000000 ? 9 : input.population > 500000 ? 8 : input.population > 200000 ? 6 : input.population > 100000 ? 5 : 3;
  add('População da Cidade', 'Demografia', popScore, 2, input.population.toLocaleString('pt-BR') + ' habitantes');

  // 57. PIB per capita (Alto=3)
  const gdpScore = input.gdpPerCapita > 70000 ? 10 : input.gdpPerCapita > 50000 ? 8 : input.gdpPerCapita > 35000 ? 6 : input.gdpPerCapita > 20000 ? 4 : 2;
  add('PIB per Capita', 'Demografia', gdpScore, 3, 'R$ ' + Math.round(input.gdpPerCapita).toLocaleString('pt-BR'));

  // 58. PIB total (Médio=2)
  const pibTotal = input.population * input.gdpPerCapita;
  const pibScore = pibTotal > 50000000000 ? 9 : pibTotal > 20000000000 ? 7 : pibTotal > 5000000000 ? 5 : 3;
  add('PIB Total Municipal', 'Demografia', pibScore, 2, 'Estimativa baseada em pop x PIB per capita');

  // 59. IDHM (Médio=2)
  const idhmScore = input.gdpPerCapita > 50000 ? 8 : input.gdpPerCapita > 30000 ? 7 : 5;
  add('IDHM', 'Demografia', idhmScore, 2, 'Estimativa baseada em PIB per capita');

  // 60. Renda média bairro (Alto=3)
  const rendaBairro = distCenter < 3 && input.gdpPerCapita > 40000 ? 9 : distCenter < 5 && input.gdpPerCapita > 30000 ? 7 : distCenter < 3 ? 6 : 4;
  add('Renda Média do Bairro', 'Demografia', rendaBairro, 3, distCenter < 3 ? 'Região central - renda mais alta' : 'Verificar perfil socioeconômico');

  // 61. Perfil socioeconômico (Alto=3)
  const perfilSE = input.gdpPerCapita > 50000 && distCenter < 5 ? 9 : input.gdpPerCapita > 35000 ? 7 : 5;
  add('Perfil Socioeconômico', 'Demografia', perfilSE, 3, 'Baseado em PIB e localização');

  // 62. Densidade populacional (Médio=2)
  add('Densidade Populacional', 'Demografia', popScore > 7 ? 8 : 5, 2, 'Estimativa baseada na população');

  // 63. Crescimento populacional (Baixo=1)
  add('Crescimento Populacional', 'Demografia', 6, 1, 'Crescimento estável');

  // 64. Frota total veículos (Médio=2)
  add('Frota Total Veículos', 'Demografia', popScore, 2, 'Correlacionado com população');

  // 65. Veículos por habitante (Médio=2)
  add('Veículos por Habitante', 'Demografia', vphScore, 2, 'Estimativa baseada em PIB');

  // ===== CATEGORIA 7: POTENCIAL COMERCIAL (10 variáveis) =====

  // 66. Potencial parceria (Alto=3)
  const parceriaMap: Record<string, number> = {
    shopping: 9, hotel: 8, universidade: 8, supermercado: 7,
    posto_24h: 7, hospital_24h: 6, aeroporto: 6, rodoviaria: 6,
    estacionamento: 7, terreno: 8, restaurante: 6, outro: 5
  };
  add('Potencial de Parceria', 'Potencial Comercial', parceriaMap[input.establishmentType] || 5, 3, 'Estimativa por tipo');

  // 67. Diferencial competitivo (Alto=3)
  const difScore = input.competitorsIn200m === 0 ? 9 : input.competitorsIn200m <= 2 ? 5 : 2;
  add('Diferencial Competitivo', 'Potencial Comercial', difScore, 3, input.competitorsIn200m === 0 ? 'Sem concorrência direta' : 'Concorrência próxima');

  // 68. Receitas complementares (Médio=2)
  const recCompl = ['shopping', 'posto_24h'].includes(input.establishmentType) ? 8 : ['terreno'].includes(input.establishmentType) ? 6 : 5;
  add('Potencial Receitas Complementares', 'Potencial Comercial', recCompl, 2, 'Totem LED, conveniência, etc');

  // 69. Potencial B2B/Frotas (Alto=3)
  const b2bScore = input.population > 500000 ? 8 : input.population > 200000 ? 6 : 4;
  add('Potencial B2B/Frotas', 'Potencial Comercial', b2bScore, 3, input.population > 500000 ? 'Cidade grande com frotas ativas' : 'Frotas limitadas');

  // 70. Potencial clube assinatura (Médio=2)
  add('Potencial Clube Assinatura', 'Potencial Comercial', appScore > 6 ? 8 : 5, 2, 'Motoristas de app são público ideal');

  // 71. Alinhamento Pluggon (Médio=2)
  const alinhScore = input.is24h && ['posto_24h', 'shopping'].includes(input.establishmentType) ? 10 : input.is24h ? 8 : 5;
  add('Alinhamento Metodologia BLEV', 'Potencial Comercial', alinhScore, 2, 'Rotatividade + 24h + fluxo');

  // 72. Custo aluguel região (Médio=2)
  const aluguelScore = distCenter > 8 ? 8 : distCenter > 4 ? 6 : 4;
  add('Custo Aluguel da Região', 'Potencial Comercial', aluguelScore, 2, distCenter < 4 ? 'Centro - aluguel mais alto' : 'Região com custo moderado');

  // 73. Potencial expansão (Médio=2)
  const expScore = ['terreno', 'estacionamento', 'shopping'].includes(input.establishmentType) ? 9 : 5;
  add('Potencial de Expansão', 'Potencial Comercial', expScore, 2, 'Espaço para 2o e 3o carregador');

  // 74. Incentivos governamentais (Baixo=1)
  add('Incentivos Governamentais', 'Potencial Comercial', 5, 1, 'Verificar programas municipais/estaduais');

  // 75. Tarifa energia (Alto=3)
  add('Tarifa Energia Concessionária', 'Potencial Comercial', 6, 3, 'Referência R$1,00/kWh - verificar tarifa local');

  // ===== CATEGORIA 8: EXCLUSIVAS BRASIL (5 variáveis) =====

  // 76. Usina solar GD (Alto=3)
  add('Usina Solar GD Disponível', 'Exclusivas Brasil', 7, 3, 'Alta oferta de usinas solares no Brasil');

  // 77. Custo energia solar (Médio=2)
  add('Custo Energia Solar GD', 'Exclusivas Brasil', 7, 2, 'Referência R$0,50/kWh');

  // 78. Postos GNV próximos (Baixo=1)
  add('Postos GNV Próximos', 'Exclusivas Brasil', 5, 1, 'Indicador de público aberto a alternativas');

  // 79. Polos universitários (Médio=2)
  const uniScore = input.establishmentType === 'universidade' ? 10 : input.population > 500000 ? 7 : 4;
  add('Polos Universitários', 'Exclusivas Brasil', uniScore, 2, input.establishmentType === 'universidade' ? 'Local é universidade' : 'Verificar proximidade');

  // 80. Corredor eletrovias (Alto=3)
  const eletrovia = input.observations?.toLowerCase().includes('eletrovia') || input.observations?.toLowerCase().includes('copel') || input.observations?.toLowerCase().includes('cpfl') ? 9 : input.population > 500000 ? 6 : 3;
  add('Corredor de Eletrovias', 'Exclusivas Brasil', eletrovia, 3, 'Verificar se cidade está em corredor');

  // ===== CÁLCULO SCORE FINAL =====
  let totalWeighted = 0;
  let maxWeighted = 0;
  for (const v of vars) {
    totalWeighted += v.score * v.weight;
    maxWeighted += 10 * v.weight;
  }

  let overallScore = Math.round((totalWeighted / maxWeighted) * 100);

  // ===== CALIBRAÇÃO CONTEXTUAL =====

  // Rodoviária/Aeroporto SEMPRE acima de posto/terreno na mesma cidade
  if (['aeroporto', 'rodoviaria'].includes(input.establishmentType)) {
    overallScore = Math.max(overallScore, 80 + Math.round(cityFactor * 10));
  }

  // Posto 24h em cidade grande = mínimo alto
  if (['posto_24h'].includes(input.establishmentType) && input.is24h && input.population > 500000) {
    overallScore = Math.max(overallScore, 78 + Math.round(cityFactor * 8));
  }

  // Shopping em cidade grande = mínimo alto
  if (['shopping', 'centro_comercial'].includes(input.establishmentType) && input.population > 300000) {
    overallScore = Math.max(overallScore, 76 + Math.round(cityFactor * 8));
  }

  // Terreno SEMPRE abaixo de rodoviária/aeroporto/shopping/posto24h na mesma cidade
  if (input.establishmentType === 'terreno') {
    const maxTerreno = 75 + Math.round(cityFactor * 10);
    overallScore = Math.min(overallScore, maxTerreno);
    // Terreno longe do centro = penalidade
    if (distCenter > 8) overallScore = Math.max(overallScore - 5, 40);
  }

  // Sem concorrência direta = bônus
  if (input.competitorsIn200m === 0 && input.population > 200000) {
    overallScore = Math.min(100, overallScore + 3);
  }

  // Cidade pequena < 100k tem teto de 75 (a menos que seja aeroporto/rodoviária)
  if (input.population < 100000 && !['aeroporto', 'rodoviaria'].includes(input.establishmentType)) {
    overallScore = Math.min(overallScore, 75);
  }

  // Centro de cidade grande SEMPRE acima de interior
  if (input.population > 1000000 && distCenter < 5) {
    overallScore = Math.max(overallScore, 75);
  }

  const classification = overallScore >= 85 ? 'PREMIUM' : overallScore >= 70 ? 'ESTRATÉGICO' : overallScore >= 55 ? 'VIÁVEL' : overallScore >= 40 ? 'MARGINAL' : 'REJEITADO';

  return { overallScore, classification, variables: vars };
}
