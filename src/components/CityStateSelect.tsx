'use client';
import { useState, useEffect, useMemo, useRef } from 'react';

const ESTADOS = [
  { sigla: 'AC', nome: 'Acre' },
  { sigla: 'AL', nome: 'Alagoas' },
  { sigla: 'AP', nome: 'Amapá' },
  { sigla: 'AM', nome: 'Amazonas' },
  { sigla: 'BA', nome: 'Bahia' },
  { sigla: 'CE', nome: 'Ceará' },
  { sigla: 'DF', nome: 'Distrito Federal' },
  { sigla: 'ES', nome: 'Espírito Santo' },
  { sigla: 'GO', nome: 'Goiás' },
  { sigla: 'MA', nome: 'Maranhão' },
  { sigla: 'MT', nome: 'Mato Grosso' },
  { sigla: 'MS', nome: 'Mato Grosso do Sul' },
  { sigla: 'MG', nome: 'Minas Gerais' },
  { sigla: 'PA', nome: 'Pará' },
  { sigla: 'PB', nome: 'Paraíba' },
  { sigla: 'PR', nome: 'Paraná' },
  { sigla: 'PE', nome: 'Pernambuco' },
  { sigla: 'PI', nome: 'Piauí' },
  { sigla: 'RJ', nome: 'Rio de Janeiro' },
  { sigla: 'RN', nome: 'Rio Grande do Norte' },
  { sigla: 'RO', nome: 'Rondônia' },
  { sigla: 'RR', nome: 'Roraima' },
  { sigla: 'RS', nome: 'Rio Grande do Sul' },
  { sigla: 'SC', nome: 'Santa Catarina' },
  { sigla: 'SP', nome: 'São Paulo' },
  { sigla: 'SE', nome: 'Sergipe' },
  { sigla: 'TO', nome: 'Tocantins' },
];

interface CityStateSelectProps {
  onSelect: (city: string, state: string) => void;
  initialCity?: string;
  initialState?: string;
}

export default function CityStateSelect({ onSelect, initialCity, initialState }: CityStateSelectProps) {
  const initialStateLabel = initialState
    ? (() => {
        const s = ESTADOS.find((e) => e.sigla === initialState);
        return s ? `${s.nome} (${s.sigla})` : initialState;
      })()
    : '';

  const [stateInput, setStateInput] = useState(initialStateLabel);
  const [selectedState, setSelectedState] = useState<string | null>(initialState || null);
  const [showStates, setShowStates] = useState(false);

  const [cityInput, setCityInput] = useState(initialCity || '');
  const [cities, setCities] = useState<string[]>([]);
  const [showCities, setShowCities] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);

  const stateRef = useRef<HTMLDivElement>(null);
  const cityRef = useRef<HTMLDivElement>(null);

  const filteredStates = ESTADOS.filter(
    (e) =>
      e.nome.toLowerCase().includes(stateInput.toLowerCase()) ||
      e.sigla.toLowerCase().includes(stateInput.toLowerCase())
  );

  useEffect(() => {
    if (!selectedState) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingCities(true);
    fetch(
      `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${selectedState}/municipios?orderBy=nome`
    )
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setCities(data.map((m: { nome: string }) => m.nome));
        setLoadingCities(false);
      })
      .catch(() => {
        if (!cancelled) setLoadingCities(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedState]);

  const availableCities = useMemo(() => (selectedState ? cities : []), [selectedState, cities]);

  const filteredCities = useMemo(() => {
    if (cityInput.length < 3) return [];
    const norm = (s: string) =>
      s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const needle = norm(cityInput);
    return availableCities.filter((c) => norm(c).includes(needle)).slice(0, 15);
  }, [cityInput, availableCities]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (stateRef.current && !stateRef.current.contains(e.target as Node)) setShowStates(false);
      if (cityRef.current && !cityRef.current.contains(e.target as Node)) setShowCities(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function selectState(sigla: string, nome: string) {
    setSelectedState(sigla);
    setStateInput(nome + ' (' + sigla + ')');
    setShowStates(false);
    setCityInput('');
    onSelect('', sigla);
  }

  function selectCity(city: string) {
    setCityInput(city);
    setShowCities(false);
    if (selectedState) onSelect(city, selectedState);
  }

  return (
    <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
      <div ref={stateRef} style={{ position: 'relative', flex: '0 0 220px' }}>
        <label style={{ display: 'block', marginBottom: 6, color: '#C9A84C', fontSize: 14, fontWeight: 600 }}>
          Estado
        </label>
        <input
          type="text"
          value={stateInput}
          onChange={(e) => {
            setStateInput(e.target.value);
            setShowStates(true);
            setSelectedState(null);
          }}
          onFocus={() => setShowStates(true)}
          placeholder="Digite o estado..."
          style={{
            width: '100%',
            padding: '10px 12px',
            background: '#0D1117',
            color: '#fff',
            border: '1px solid #333',
            borderRadius: 6,
            fontSize: 14,
          }}
        />
        {showStates && filteredStates.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              maxHeight: 250,
              overflowY: 'auto',
              background: '#161B22',
              border: '1px solid #333',
              borderRadius: 6,
              zIndex: 50,
              marginTop: 4,
            }}
          >
            {filteredStates.map((e) => (
              <div
                key={e.sigla}
                onClick={() => selectState(e.sigla, e.nome)}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  color: '#fff',
                  fontSize: 14,
                  borderBottom: '1px solid #222',
                }}
                onMouseEnter={(ev) => ((ev.currentTarget as HTMLElement).style.background = '#C9A84C22')}
                onMouseLeave={(ev) => ((ev.currentTarget as HTMLElement).style.background = 'transparent')}
              >
                <span style={{ color: '#C9A84C', fontWeight: 600 }}>{e.sigla}</span> — {e.nome}
              </div>
            ))}
          </div>
        )}
      </div>

      <div ref={cityRef} style={{ position: 'relative', flex: 1 }}>
        <label style={{ display: 'block', marginBottom: 6, color: '#C9A84C', fontSize: 14, fontWeight: 600 }}>
          Cidade
        </label>
        <input
          type="text"
          value={cityInput}
          onChange={(e) => {
            setCityInput(e.target.value);
            setShowCities(true);
          }}
          onFocus={() => setShowCities(true)}
          placeholder={
            selectedState
              ? loadingCities
                ? 'Carregando cidades...'
                : 'Digite a cidade (mín. 3 letras)...'
              : 'Selecione o estado primeiro'
          }
          disabled={!selectedState || loadingCities}
          style={{
            width: '100%',
            padding: '10px 12px',
            background: selectedState ? '#0D1117' : '#0a0a0a',
            color: '#fff',
            border: '1px solid #333',
            borderRadius: 6,
            fontSize: 14,
            opacity: selectedState ? 1 : 0.5,
          }}
        />
        {showCities && filteredCities.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              maxHeight: 250,
              overflowY: 'auto',
              background: '#161B22',
              border: '1px solid #333',
              borderRadius: 6,
              zIndex: 50,
              marginTop: 4,
            }}
          >
            {filteredCities.map((c) => (
              <div
                key={c}
                onClick={() => selectCity(c)}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  color: '#fff',
                  fontSize: 14,
                  borderBottom: '1px solid #222',
                }}
                onMouseEnter={(ev) => ((ev.currentTarget as HTMLElement).style.background = '#C9A84C22')}
                onMouseLeave={(ev) => ((ev.currentTarget as HTMLElement).style.background = 'transparent')}
              >
                {c}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
