import { useCallback, useEffect, useMemo, useState } from 'react';

type NameParts = {
  prefix: string;
  core: string;
  suffix: string;
};

type BusinessContext = {
  sector: string;
  audience: string;
  values: string;
  country: string;
  style: string;
};

type SuggestionsResponse = {
  suggestedWords: string[];
  suggestedNames: string[];
  notes: string[];
  modelUsed?: string;
};

type HistoryState = {
  parts: NameParts;
  suggestions: string;
};

const initialContext: BusinessContext = {
  sector: '',
  audience: '',
  values: '',
  country: 'Brasil',
  style: 'Moderno e confiável'
};

const trim = (value: string) => value.trim().replace(/\s+/g, ' ');

const buildName = (parts: NameParts) =>
  [parts.prefix, parts.core, parts.suffix].filter(Boolean).map(trim).join(' ').trim();

const unique = (items: string[]) =>
  [...new Set(items.map((value) => trim(value)).filter(Boolean))];

const fallbackSuggestions: SuggestionsResponse = {
  suggestedWords: [
    'Nexa',
    'Vértice',
    'Brilho',
    'Ponte',
    'Auréola',
    'Raiz',
    'Norte',
    'Foco'
  ],
  suggestedNames: ['Nexa Core', 'Foco Norte', 'Brilho Digital', 'Vértice Labs'],
  notes: ['IA indisponível no momento. Ajuste o tom para manter consistência.']
};

async function requestSuggestions(
  payload: {
    businessContext: BusinessContext;
    baseWords: string[];
    currentNameParts: NameParts;
  },
  currentAbortSignal?: AbortSignal
): Promise<SuggestionsResponse> {
  const response = await fetch('/.netlify/functions/suggest-name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: currentAbortSignal
  });

  if (!response.ok) {
    let message = `Erro ${response.status}`;
    try {
      const body = await response.json();
      if (body?.error?.message) message = body.error.message;
    } catch {}
    throw new Error(message);
  }

  const data = await response.json();
  const next = data?.suggestions ?? data;
  const normalized: SuggestionsResponse = {
    suggestedWords: unique(next.suggestedWords ?? []).slice(0, 8),
    suggestedNames: unique(next.suggestedNames ?? []).slice(0, 6),
    notes: unique(next.notes ?? []).slice(0, 5),
    modelUsed: next.modelUsed ?? 'desconhecido'
  };
  return normalized;
}

function App() {
  const [parts, setParts] = useState<NameParts>({ prefix: '', core: '', suffix: '' });
  const [businessContext, setBusinessContext] = useState<BusinessContext>(initialContext);
  const [baseWords, setBaseWords] = useState<string[]>(['rápido', 'novo', 'digital']);
  const [wordInput, setWordInput] = useState('');
  const [suggestions, setSuggestions] = useState<SuggestionsResponse>(fallbackSuggestions);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [modelUsed, setModelUsed] = useState('Aguardando IA');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryState[]>([
    { parts: { prefix: '', core: '', suffix: '' }, suggestions: '' }
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const composedName = useMemo(() => buildName(parts), [parts]);

  const updateHistory = useCallback((next: NameParts) => {
    setHistory((currentHistory) => {
      const entry: HistoryState = { parts: next, suggestions: buildName(next) };
      const reduced = currentHistory.slice(0, historyIndex + 1);
      if (entry.suggestions === reduced[reduced.length - 1]?.suggestions) return currentHistory;
      const nextHistory = [...reduced, entry].slice(-24);
      setHistoryIndex(nextHistory.length - 1);
      return nextHistory;
    });
  }, [historyIndex]);

  const setField = useCallback((key: keyof NameParts, value: string) => {
    setParts((current) => {
      const next = { ...current, [key]: trim(value) };
      updateHistory(next);
      return next;
    });
  }, [updateHistory]);

  const addWord = useCallback(() => {
    const normalized = trim(wordInput);
    if (!normalized) return;
    setBaseWords((current) => unique([...current, normalized]));
    setWordInput('');
  }, [wordInput]);

  const removeBaseWord = useCallback((value: string) => {
    setBaseWords((current) => current.filter((item) => item !== value));
  }, []);

  const applyWord = useCallback((word: string, target: keyof NameParts) => {
    setField(target, ('' as never) || word);
  }, [setField]);

  const pushFavorite = useCallback(() => {
    const name = composedName;
    if (!name || favorites.includes(name)) return;
    setFavorites((current) => [name, ...current].slice(0, 20));
  }, [composedName, favorites]);

  const copyToClipboard = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {}
  }, []);

  const undo = useCallback(() => {
    setHistoryIndex((index) => {
      const next = Math.max(0, index - 1);
      if (next === index) return index;
      setParts(history[next].parts);
      return next;
    });
  }, [history]);

  const redo = useCallback(() => {
    setHistoryIndex((index) => {
      const next = Math.min(history.length - 1, index + 1);
      if (next === index) return index;
      setParts(history[next].parts);
      return next;
    });
  }, [history]);

  const loadSuggestionWithoutReset = useCallback((name: string) => {
    const chunks = name.split(' ').filter(Boolean);
    const next: NameParts = {
      prefix: chunks[0] ?? '',
      core: chunks.slice(1, -1).join(' '),
      suffix: chunks.length > 1 ? chunks[chunks.length - 1] : ''
    };
    setParts((current) => {
      const normalized = {
        prefix: next.prefix || current.prefix,
        core: next.core || current.core,
        suffix: next.suffix || current.suffix
      };
      updateHistory(normalized);
      return normalized;
    });
  }, [updateHistory]);

  useEffect(() => {
    const controller = new AbortController();

    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const response = await requestSuggestions(
          {
            businessContext,
            baseWords,
            currentNameParts: parts
          },
          controller.signal
        );
        setSuggestions(response);
        setNotes(response.notes);
        setModelUsed(response.modelUsed || 'desconhecido');
      } catch (error_) {
        if ((error_ as Error).name !== 'AbortError') {
          setError((error_ as Error).message);
          setSuggestions(fallbackSuggestions);
          setNotes(fallbackSuggestions.notes);
          setModelUsed('fallback local');
        }
      } finally {
        setLoading(false);
      }
    }, 800);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [businessContext, baseWords, parts.prefix, parts.core, parts.suffix]);

  return (
    <div className="page">
      <aside className="panel panel-left">
        <h2>Perfil da empresa</h2>
        <div className="field">
          <label>Setor</label>
          <input
            value={businessContext.sector}
            onChange={(event) =>
              setBusinessContext((current) => ({ ...current, sector: event.target.value }))
            }
            placeholder="ex.: Educação, Tecnologia, Moda"
          />
        </div>
        <div className="field">
          <label>Público-alvo</label>
          <input
            value={businessContext.audience}
            onChange={(event) =>
              setBusinessContext((current) => ({ ...current, audience: event.target.value }))
            }
            placeholder="ex.: pequenas empresas, jovens empreendedores"
          />
        </div>
        <div className="field">
          <label>Valores da marca</label>
          <input
            value={businessContext.values}
            onChange={(event) =>
              setBusinessContext((current) => ({ ...current, values: event.target.value }))
            }
            placeholder="ex.: confiança, agilidade, inovação"
          />
        </div>
        <div className="field">
          <label>País / Idioma</label>
          <input
            value={businessContext.country}
            onChange={(event) =>
              setBusinessContext((current) => ({ ...current, country: event.target.value }))
            }
            placeholder="ex.: Brasil, português"
          />
        </div>
        <div className="field">
          <label>Tom da marca</label>
          <input
            value={businessContext.style}
            onChange={(event) =>
              setBusinessContext((current) => ({ ...current, style: event.target.value }))
            }
            placeholder="ex.: moderno, sério, premium"
          />
        </div>

        <h3>Palavras base</h3>
        <div className="word-entry">
          <input
            value={wordInput}
            onChange={(event) => setWordInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addWord();
              }
            }}
            placeholder="Adicione uma palavra-chave e Enter"
          />
          <button type="button" onClick={addWord}>Adicionar</button>
        </div>
        <div className="pill-list">
          {baseWords.map((word) => (
            <span key={word} className="pill" onClick={() => removeBaseWord(word)} title="Clique para remover">
              {word}
            </span>
          ))}
        </div>

        <p className="small">
          Modelo IA atual: <strong>{modelUsed}</strong>
        </p>
        {error && <p className="error">{error}</p>}
      </aside>

      <main className="center">
        <section className="composer">
          <h1>NomeEmpresas IA</h1>
          <p>Monte e refine nomes em tempo real com ajuda da IA.</p>
          <div className="name-output">
            {composedName || 'Digite partes do nome para começar'}
          </div>

          <div className="composer-grid">
            <label>
              Prefixo
              <input
                value={parts.prefix}
                onChange={(event) => setField('prefix', event.target.value)}
                placeholder="ex.: Nova"
              />
            </label>
            <label>
              Raiz
              <input
                value={parts.core}
                onChange={(event) => setField('core', event.target.value)}
                placeholder="ex.: Vela"
              />
            </label>
            <label>
              Sufixo
              <input
                value={parts.suffix}
                onChange={(event) => setField('suffix', event.target.value)}
                placeholder="ex.: Tech"
              />
            </label>
          </div>

          <div className="toolbar">
            <button type="button" onClick={pushFavorite} disabled={!composedName}>
              Salvar favorito
            </button>
            <button type="button" onClick={() => copyToClipboard(composedName)} disabled={!composedName}>
              Copiar nome atual
            </button>
            <button type="button" onClick={() => loadSuggestionWithoutReset(suggestions.suggestedNames[0] || '')} disabled={!suggestions.suggestedNames.length}>
              Sugerir sem recomeçar
            </button>
            <button type="button" onClick={undo} disabled={historyIndex <= 0}>
              Undo
            </button>
            <button type="button" onClick={redo} disabled={historyIndex >= history.length - 1}>
              Redo
            </button>
          </div>

          <div className="loader" aria-live="polite">
            {loading ? 'Buscando novas sugestões com IA...' : 'IA pronta para ajudar'}
          </div>

          {notes.length > 0 && (
            <div className="notes">
              {notes.slice(0, 3).map((note) => (
                <p key={note}>• {note}</p>
              ))}
            </div>
          )}
        </section>

        {favorites.length > 0 && (
          <section className="favorites">
            <h3>Favoritos</h3>
            <ul>
              {favorites.map((name) => (
                <li key={name}>
                  <span>{name}</span>
                  <button type="button" onClick={() => copyToClipboard(name)}>Copiar</button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <aside className="panel panel-right">
        <div className="header-row">
          <h2>Ajuda da IA</h2>
          <button type="button" onClick={async () => {
            setLoading(true);
            try {
              const response = await requestSuggestions({ businessContext, baseWords, currentNameParts: parts });
              setSuggestions(response);
              setNotes(response.notes);
              setModelUsed(response.modelUsed || 'desconhecido');
            } catch (error_) {
              setError((error_ as Error).message);
              setSuggestions(fallbackSuggestions);
            } finally {
              setLoading(false);
            }
          }}>
            Regenerar
          </button>
        </div>

        <h3>Palavras sugestivas</h3>
        <div className="pill-list">
          {suggestions.suggestedWords.map((word, index) => {
            const target = index % 3 === 0 ? 'prefix' : index % 3 === 1 ? 'core' : 'suffix';
            return (
              <button
                key={`${word}-${index}`}
                type="button"
                className="chip-button"
                onClick={() => setField(target, word)}
                title="Clique para aplicar no nome"
              >
                {word}
              </button>
            );
          })}
        </div>

        <h3>Nomes sugeridos</h3>
        <ol className="names">
          {suggestions.suggestedNames.map((name) => (
            <li key={name}>
              <button type="button" onClick={() => loadSuggestionWithoutReset(name)}>
                {name}
              </button>
            </li>
          ))}
        </ol>

        <button
          type="button"
          className="primary"
          onClick={() => copyToClipboard(composedName)}
          disabled={!composedName}
        >
          Copiar seleção atual
        </button>
      </aside>
    </div>
  );
}

export default App;
