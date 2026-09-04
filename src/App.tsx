import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

type NameParts = { prefix: string; core: string; suffix: string };
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
  reasoningEffort?: string;
};
type ComposerState = { parts: NameParts; history: NameParts[]; historyIndex: number };
type ComposerAction =
  | { type: 'set-field'; key: keyof NameParts; value: string }
  | { type: 'replace'; parts: NameParts }
  | { type: 'complete'; parts: NameParts }
  | { type: 'undo' }
  | { type: 'redo' };

const emptyParts: NameParts = { prefix: '', core: '', suffix: '' };
const initialContext: BusinessContext = {
  sector: '',
  audience: '',
  values: '',
  country: 'Brasil / Português',
  style: 'Moderno e confiável'
};
const starterSuggestions: SuggestionsResponse = {
  suggestedWords: ['Nexa', 'Vértice', 'Brio', 'Norte', 'Fluxo', 'Orbe', 'Clara', 'Pulso'],
  suggestedNames: ['Nexa Norte', 'Brio Digital', 'Clara Labs', 'Vértice Uno'],
  notes: ['Descreva a empresa para receber sugestões mais específicas.'],
  modelUsed: 'gpt-5.6-sol',
  reasoningEffort: 'max'
};

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ');
const buildName = (parts: NameParts) =>
  [parts.prefix, parts.core, parts.suffix].map(normalize).filter(Boolean).join(' ');
const unique = (items: unknown, limit: number) => {
  if (!Array.isArray(items)) return [];
  return [...new Set(items.map((value) => normalize(String(value))).filter(Boolean))].slice(0, limit);
};
const parseSuggestedName = (name: string): NameParts => {
  const chunks = normalize(name).split(' ').filter(Boolean);
  if (chunks.length === 0) return emptyParts;
  if (chunks.length === 1) return { prefix: '', core: chunks[0], suffix: '' };
  if (chunks.length === 2) return { prefix: '', core: chunks[0], suffix: chunks[1] };
  return { prefix: chunks[0], core: chunks.slice(1, -1).join(' '), suffix: chunks[chunks.length - 1] || '' };
};
const commitParts = (state: ComposerState, parts: NameParts): ComposerState => {
  if (buildName(parts) === buildName(state.parts)) return { ...state, parts };
  const history = [...state.history.slice(0, state.historyIndex + 1), parts].slice(-30);
  return { parts, history, historyIndex: history.length - 1 };
};
const composerReducer = (state: ComposerState, action: ComposerAction): ComposerState => {
  if (action.type === 'undo') {
    const historyIndex = Math.max(0, state.historyIndex - 1);
    return historyIndex === state.historyIndex ? state : { ...state, historyIndex, parts: state.history[historyIndex] };
  }
  if (action.type === 'redo') {
    const historyIndex = Math.min(state.history.length - 1, state.historyIndex + 1);
    return historyIndex === state.historyIndex ? state : { ...state, historyIndex, parts: state.history[historyIndex] };
  }
  if (action.type === 'set-field') {
    return commitParts(state, { ...state.parts, [action.key]: action.value.slice(0, 48) });
  }
  if (action.type === 'complete') {
    return commitParts(state, {
      prefix: normalize(state.parts.prefix) || action.parts.prefix,
      core: normalize(state.parts.core) || action.parts.core,
      suffix: normalize(state.parts.suffix) || action.parts.suffix
    });
  }
  return commitParts(state, action.parts);
};
const formatModelName = (model: string) => ({
  'gpt-5.6': 'GPT-5.6 Sol',
  'gpt-5.6-sol': 'GPT-5.6 Sol',
  'gpt-5.6-terra': 'GPT-5.6 Terra',
  'gpt-4.1': 'GPT-4.1'
}[model] || model);

async function requestSuggestions(
  payload: { businessContext: BusinessContext; baseWords: string[]; currentNameParts: NameParts },
  signal: AbortSignal
): Promise<SuggestionsResponse> {
  const response = await fetch('/.netlify/functions/suggest-name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || 'Não foi possível atualizar as sugestões.');
  const result = data?.suggestions ?? data;
  const normalized: SuggestionsResponse = {
    suggestedWords: unique(result?.suggestedWords, 8),
    suggestedNames: unique(result?.suggestedNames, 6),
    notes: unique(result?.notes, 3),
    modelUsed: result?.modelUsed ?? data?.modelUsed ?? 'gpt-5.6-sol',
    reasoningEffort: result?.reasoningEffort ?? data?.reasoningEffort ?? 'max'
  };
  if (!normalized.suggestedNames.length) throw new Error('A IA não retornou nomes válidos. Tente novamente.');
  return normalized;
}

function App() {
  const [composer, dispatch] = useReducer(composerReducer, {
    parts: emptyParts,
    history: [emptyParts],
    historyIndex: 0
  });
  const [businessContext, setBusinessContext] = useState<BusinessContext>(initialContext);
  const [baseWords, setBaseWords] = useState<string[]>(['ágil', 'digital', 'humano']);
  const [wordInput, setWordInput] = useState('');
  const [suggestions, setSuggestions] = useState<SuggestionsResponse>(starterSuggestions);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = window.localStorage.getItem('nomeempresas:favorites');
      return saved ? unique(JSON.parse(saved), 20) : [];
    } catch {
      return [];
    }
  });

  const activeRequest = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const copyTimer = useRef<number | undefined>(undefined);
  const composedName = useMemo(() => buildName(composer.parts), [composer.parts]);
  const modelLabel = formatModelName(suggestions.modelUsed || 'gpt-5.6-sol');

  useEffect(() => {
    try { window.localStorage.setItem('nomeempresas:favorites', JSON.stringify(favorites)); } catch { /* storage is optional */ }
  }, [favorites]);

  const updateContext = useCallback((key: keyof BusinessContext, value: string) => {
    setBusinessContext((current) => ({ ...current, [key]: value.slice(0, 180) }));
  }, []);
  const addWord = useCallback(() => {
    const word = normalize(wordInput);
    if (!word) return;
    setBaseWords((current) => unique([...current, word], 10));
    setWordInput('');
  }, [wordInput]);
  const copyToClipboard = useCallback(async (value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(`“${value}” foi copiado.`);
    } catch {
      setCopyStatus('Não foi possível copiar automaticamente.');
    }
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyStatus(''), 2400);
  }, []);
  const saveFavorite = useCallback((value: string) => {
    const name = normalize(value);
    if (name) setFavorites((current) => unique([name, ...current], 20));
  }, []);
  const runSuggestions = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError('');
    try {
      const response = await requestSuggestions(
        { businessContext, baseWords, currentNameParts: composer.parts },
        controller.signal
      );
      if (sequence === requestSequence.current) setSuggestions(response);
    } catch (requestError) {
      if ((requestError as Error).name !== 'AbortError' && sequence === requestSequence.current) {
        setError((requestError as Error).message);
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [baseWords, businessContext, composer.parts]);

  useEffect(() => () => {
    activeRequest.current?.abort();
    window.clearTimeout(copyTimer.current);
  }, []);

  const applySuggestedWord = (word: string) => {
    const target: keyof NameParts = !normalize(composer.parts.prefix)
      ? 'prefix'
      : !normalize(composer.parts.core)
        ? 'core'
        : !normalize(composer.parts.suffix)
          ? 'suffix'
          : 'core';
    dispatch({ type: 'set-field', key: target, value: word });
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="NomeEmpresas, início">
          <span className="brand-mark" aria-hidden="true"><i /><i /></span>
          <span><strong>Nome</strong>Empresas</span>
        </a>
        <div className="model-pill" title="Modelo usado nas sugestões">
          <span className={`status-dot ${loading ? 'is-loading' : ''}`} />
          {modelLabel}
        </div>
      </header>

      <main>
        <section className="intro">
          <span>Gerador de nomes com inteligência artificial</span>
          <h1>Encontre um nome que combina com sua empresa.</h1>
          <p>Descreva sua ideia, monte o nome e escolha entre as sugestões.</p>
        </section>

        <div className="workspace">
          <div className="main-flow">
            <section className="card setup-card" aria-labelledby="setup-title">
              <header className="section-header">
                <span className="section-number">1</span>
                <div>
                  <h2 id="setup-title">Conte sobre a empresa</h2>
                  <p>Uma frase já é suficiente para começar.</p>
                </div>
              </header>

              <label className="field wide" htmlFor="sector">
                <span>O que a empresa faz?</span>
                <textarea
                  id="sector"
                  rows={3}
                  value={businessContext.sector}
                  onChange={(event) => updateContext('sector', event.target.value)}
                  placeholder="Ex.: Aplicativo que simplifica as finanças de pequenos negócios"
                />
              </label>

              <div className="field-row">
                <label className="field" htmlFor="audience">
                  <span>Para quem?</span>
                  <input
                    id="audience"
                    value={businessContext.audience}
                    onChange={(event) => updateContext('audience', event.target.value)}
                    placeholder="Ex.: pequenos empreendedores"
                  />
                </label>
                <label className="field" htmlFor="style">
                  <span>Qual estilo?</span>
                  <select
                    id="style"
                    value={businessContext.style}
                    onChange={(event) => updateContext('style', event.target.value)}
                  >
                    <option>Moderno e confiável</option>
                    <option>Premium e sofisticado</option>
                    <option>Jovem e descontraído</option>
                    <option>Minimalista e direto</option>
                    <option>Criativo e ousado</option>
                  </select>
                </label>
              </div>

              <div className="keywords-block">
                <label htmlFor="base-word">Palavras importantes</label>
                <div className="word-entry">
                  <input
                    id="base-word"
                    value={wordInput}
                    onChange={(event) => setWordInput(event.target.value.slice(0, 36))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addWord();
                      }
                    }}
                    placeholder="Ex.: simples, rápido, próximo"
                  />
                  <button type="button" onClick={addWord} disabled={!normalize(wordInput)}>Adicionar</button>
                </div>
                <div className="tag-list" aria-label="Palavras importantes adicionadas">
                  {baseWords.map((word) => (
                    <button
                      key={word}
                      type="button"
                      onClick={() => setBaseWords((current) => current.filter((item) => item !== word))}
                      aria-label={`Remover ${word}`}
                    >
                      {word}<span aria-hidden="true">x</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="card builder-card" aria-labelledby="builder-title">
              <header className="section-header builder-header">
                <span className="section-number">2</span>
                <div>
                  <h2 id="builder-title">Monte o nome</h2>
                  <p>Use um, dois ou três campos. Você não precisa preencher todos.</p>
                </div>
                <div className="history-controls" aria-label="Histórico">
                  <button type="button" onClick={() => dispatch({ type: 'undo' })} disabled={composer.historyIndex <= 0} aria-label="Desfazer">↶</button>
                  <button type="button" onClick={() => dispatch({ type: 'redo' })} disabled={composer.historyIndex >= composer.history.length - 1} aria-label="Refazer">↷</button>
                </div>
              </header>

              <div className="name-stage" aria-live="polite">
                <span>Seu nome</span>
                <strong className={composedName ? '' : 'empty'}>{composedName || 'Comece digitando abaixo'}</strong>
                <div className="name-actions">
                  <button type="button" onClick={() => saveFavorite(composedName)} disabled={!composedName}>Salvar</button>
                  <button className="primary-button" type="button" onClick={() => copyToClipboard(composedName)} disabled={!composedName}>Copiar</button>
                </div>
              </div>

              <div className="parts-grid">
                <label className="field" htmlFor="prefix">
                  <span>Início <small>opcional</small></span>
                  <input id="prefix" value={composer.parts.prefix} onChange={(event) => dispatch({ type: 'set-field', key: 'prefix', value: event.target.value })} placeholder="Ex.: Nova" />
                </label>
                <label className="field main-part" htmlFor="core">
                  <span>Palavra principal</span>
                  <input id="core" value={composer.parts.core} onChange={(event) => dispatch({ type: 'set-field', key: 'core', value: event.target.value })} placeholder="Ex.: Vela" />
                </label>
                <label className="field" htmlFor="suffix">
                  <span>Final <small>opcional</small></span>
                  <input id="suffix" value={composer.parts.suffix} onChange={(event) => dispatch({ type: 'set-field', key: 'suffix', value: event.target.value })} placeholder="Ex.: Labs" />
                </label>
              </div>

              <div className="ai-tip" role="status">
                <span className={`status-dot ${loading ? 'is-loading' : ''}`} />
                <div>
                  <strong>{loading ? 'Atualizando sugestões...' : 'Dica da IA'}</strong>
                  <p>{suggestions.notes[0]}</p>
                </div>
              </div>
            </section>

            {favorites.length > 0 && (
              <section className="card favorites-card" aria-labelledby="favorites-title">
                <div className="simple-heading">
                  <h2 id="favorites-title">Seus favoritos</h2>
                  <span>{favorites.length}</span>
                </div>
                <div className="favorites-list">
                  {favorites.map((name) => (
                    <div key={name}>
                      <button className="favorite-name" type="button" onClick={() => dispatch({ type: 'replace', parts: parseSuggestedName(name) })}>{name}</button>
                      <button type="button" onClick={() => copyToClipboard(name)}>Copiar</button>
                      <button className="remove-button" type="button" onClick={() => setFavorites((current) => current.filter((item) => item !== name))}>Remover</button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="card suggestions-panel" aria-labelledby="suggestions-title">
            <header className="suggestions-header">
              <div>
                <span>Preencha os campos e clique para gerar</span>
                <h2 id="suggestions-title">Sugestões da IA</h2>
              </div>
              <button type="button" onClick={() => void runSuggestions()} disabled={loading}>{loading ? 'Gerando...' : 'Gerar sugestões'}</button>
            </header>

            {error && (
              <div className="error-banner" role="alert">
                <strong>Não foi possível atualizar.</strong>
                <span>As sugestões anteriores continuam disponíveis.</span>
              </div>
            )}

            <div className={`names-list ${loading ? 'is-loading' : ''}`} aria-busy={loading}>
              {suggestions.suggestedNames.map((name, index) => (
                <article key={name} className={index === 0 ? 'featured' : ''}>
                  <div>
                    <span>{index === 0 ? 'Melhor combinação' : `Opção ${index + 1}`}</span>
                    <strong>{name}</strong>
                  </div>
                  <button type="button" onClick={() => dispatch({ type: 'replace', parts: parseSuggestedName(name) })}>Usar</button>
                </article>
              ))}
            </div>

            <button
              className="complete-button"
              type="button"
              disabled={!suggestions.suggestedNames[0]}
              onClick={() => dispatch({ type: 'complete', parts: parseSuggestedName(suggestions.suggestedNames[0]) })}
            >
              Preencher somente campos vazios
            </button>

            <div className="words-section">
              <h3>Palavras para experimentar</h3>
              <p>Clique em uma palavra para colocá-la no próximo campo vazio.</p>
              <div className="suggested-words">
                {suggestions.suggestedWords.map((word) => (
                  <button key={word} type="button" onClick={() => applySuggestedWord(word)}>+ {word}</button>
                ))}
              </div>
            </div>

            <p className="disclaimer">Verifique a disponibilidade da marca e do domínio antes de decidir.</p>
          </aside>
        </div>
      </main>

      <div className="toast" aria-live="polite" data-visible={Boolean(copyStatus)}>{copyStatus}</div>
    </div>
  );
}

export default App;
