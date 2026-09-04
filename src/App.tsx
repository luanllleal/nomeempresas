import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

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
  reasoningEffort?: string;
  source?: 'openai' | 'local';
};

type ComposerState = {
  parts: NameParts;
  history: NameParts[];
  historyIndex: number;
};

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
  notes: ['Defina o setor e o público para tornar a curadoria mais específica.'],
  modelUsed: 'gpt-5.6-sol',
  reasoningEffort: 'max',
  source: 'local'
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
  return {
    prefix: chunks[0],
    core: chunks.slice(1, -1).join(' '),
    suffix: chunks[chunks.length - 1]
  };
};

const commitParts = (state: ComposerState, parts: NameParts): ComposerState => {
  if (buildName(parts) === buildName(state.parts)) return { ...state, parts };
  const nextHistory = [...state.history.slice(0, state.historyIndex + 1), parts].slice(-30);
  return { parts, history: nextHistory, historyIndex: nextHistory.length - 1 };
};

const composerReducer = (state: ComposerState, action: ComposerAction): ComposerState => {
  if (action.type === 'undo') {
    const historyIndex = Math.max(0, state.historyIndex - 1);
    return historyIndex === state.historyIndex
      ? state
      : { ...state, historyIndex, parts: state.history[historyIndex] };
  }

  if (action.type === 'redo') {
    const historyIndex = Math.min(state.history.length - 1, state.historyIndex + 1);
    return historyIndex === state.historyIndex
      ? state
      : { ...state, historyIndex, parts: state.history[historyIndex] };
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

const formatModelName = (model: string) => {
  const names: Record<string, string> = {
    'gpt-5.6': 'GPT-5.6 Sol',
    'gpt-5.6-sol': 'GPT-5.6 Sol',
    'gpt-5.6-terra': 'GPT-5.6 Terra',
    'gpt-4.1': 'GPT-4.1'
  };
  return names[model] || model;
};

async function requestSuggestions(
  payload: {
    businessContext: BusinessContext;
    baseWords: string[];
    currentNameParts: NameParts;
  },
  signal: AbortSignal
): Promise<SuggestionsResponse> {
  const response = await fetch('/.netlify/functions/suggest-name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Não foi possível conectar à curadoria de IA.');
  }

  const result = data?.suggestions ?? data;
  const normalized: SuggestionsResponse = {
    suggestedWords: unique(result?.suggestedWords, 8),
    suggestedNames: unique(result?.suggestedNames, 6),
    notes: unique(result?.notes, 4),
    modelUsed: result?.modelUsed ?? data?.modelUsed ?? 'gpt-5.6-sol',
    reasoningEffort: result?.reasoningEffort ?? data?.reasoningEffort ?? 'max',
    source: 'openai'
  };

  if (normalized.suggestedNames.length === 0) {
    throw new Error('A IA não retornou nomes válidos. Tente regenerar.');
  }

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
  const primarySuggestion = suggestions.suggestedNames[0] || '';
  const modelLabel = formatModelName(suggestions.modelUsed || 'gpt-5.6-sol');

  useEffect(() => {
    window.localStorage.setItem('nomeempresas:favorites', JSON.stringify(favorites));
  }, [favorites]);

  const updateContext = useCallback((key: keyof BusinessContext, value: string) => {
    setBusinessContext((current) => ({ ...current, [key]: value.slice(0, 140) }));
  }, []);

  const addWord = useCallback(() => {
    const word = normalize(wordInput);
    if (!word) return;
    setBaseWords((current) => unique([...current, word], 12));
    setWordInput('');
  }, [wordInput]);

  const copyToClipboard = useCallback(async (value: string) => {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(`“${value}” copiado.`);
    } catch {
      setCopyStatus('Não foi possível copiar automaticamente.');
    }

    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyStatus(''), 2400);
  }, []);

  const saveFavorite = useCallback((value: string) => {
    const name = normalize(value);
    if (!name) return;
    setFavorites((current) => unique([name, ...current], 20));
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
      if (sequence !== requestSequence.current) return;
      setSuggestions(response);
    } catch (requestError) {
      if ((requestError as Error).name === 'AbortError' || sequence !== requestSequence.current) return;
      setError((requestError as Error).message);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [baseWords, businessContext, composer.parts]);

  useEffect(() => {
    activeRequest.current?.abort();
    const timeout = window.setTimeout(() => void runSuggestions(), 1100);
    return () => window.clearTimeout(timeout);
  }, [runSuggestions]);

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

        <div className="model-badge" title="Modelo usado na última resposta">
          <span className={`status-dot ${loading ? 'is-loading' : ''}`} />
          <span>{modelLabel}</span>
          <small>{suggestions.reasoningEffort === 'max' ? 'raciocínio máximo' : 'modo inteligente'}</small>
        </div>

        <span className="local-state">Favoritos salvos neste dispositivo</span>
      </header>

      <div className="workspace">
        <aside className="panel context-panel" aria-labelledby="context-title">
          <div className="step-label"><span>01</span> Contexto</div>
          <h2 id="context-title">Dê direção à marca</h2>
          <p className="panel-intro">Quanto mais claro o cenário, mais precisas ficam as sugestões.</p>

          <div className="field-stack">
            <div className="field">
              <label htmlFor="sector">Setor da empresa</label>
              <input
                id="sector"
                value={businessContext.sector}
                onChange={(event) => updateContext('sector', event.target.value)}
                placeholder="Ex.: educação financeira"
                autoComplete="organization-title"
              />
            </div>

            <div className="field">
              <label htmlFor="audience">Público principal</label>
              <input
                id="audience"
                value={businessContext.audience}
                onChange={(event) => updateContext('audience', event.target.value)}
                placeholder="Ex.: pequenos empreendedores"
              />
            </div>
          </div>

          <details className="advanced-fields">
            <summary>
              <span>Refinar identidade</span>
              <small>3 campos opcionais</small>
            </summary>
            <div className="field-stack">
              <div className="field">
                <label htmlFor="values">Valores da marca</label>
                <input
                  id="values"
                  value={businessContext.values}
                  onChange={(event) => updateContext('values', event.target.value)}
                  placeholder="Ex.: confiança, clareza, movimento"
                />
              </div>
              <div className="field">
                <label htmlFor="country">Mercado e idioma</label>
                <input
                  id="country"
                  value={businessContext.country}
                  onChange={(event) => updateContext('country', event.target.value)}
                  placeholder="Ex.: Brasil / Português"
                />
              </div>
              <div className="field">
                <label htmlFor="style">Personalidade desejada</label>
                <input
                  id="style"
                  value={businessContext.style}
                  onChange={(event) => updateContext('style', event.target.value)}
                  placeholder="Ex.: premium e minimalista"
                />
              </div>
            </div>
          </details>

          <div className="section-heading">
            <div>
              <span className="eyebrow">Vocabulário</span>
              <h3>Palavras de partida</h3>
            </div>
            <span className="counter">{baseWords.length}/12</span>
          </div>

          <div className="word-entry">
            <input
              id="base-word"
              aria-label="Nova palavra de partida"
              value={wordInput}
              onChange={(event) => setWordInput(event.target.value.slice(0, 36))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addWord();
                }
              }}
              placeholder="Digite uma palavra"
            />
            <button className="add-button" type="button" onClick={addWord} disabled={!normalize(wordInput)}>
              Adicionar
            </button>
          </div>

          <div className="tag-list" aria-label="Palavras de partida adicionadas">
            {baseWords.map((word) => (
              <button
                key={word}
                type="button"
                className="removable-tag"
                onClick={() => setBaseWords((current) => current.filter((item) => item !== word))}
                aria-label={`Remover ${word}`}
              >
                {word}<span aria-hidden="true">x</span>
              </button>
            ))}
          </div>

          <div className={`connection-card ${error ? 'has-error' : ''}`} role="status">
            <span className="connection-icon" aria-hidden="true" />
            <div>
              <strong>{error ? 'Sugestões mantidas' : loading ? 'Analisando contexto' : 'Curadoria conectada'}</strong>
              <span>{error || `${modelLabel} está acompanhando suas escolhas.`}</span>
            </div>
          </div>
        </aside>

        <main className="studio" aria-labelledby="studio-title">
          <section className="studio-card">
            <div className="studio-header">
              <div>
                <div className="step-label"><span>02</span> Construtor</div>
                <h1 id="studio-title">O nome toma forma aqui.</h1>
                <p>Combine as partes livremente. Nada é aplicado sem a sua escolha.</p>
              </div>
              <div className="history-controls" aria-label="Histórico de alterações">
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'undo' })}
                  disabled={composer.historyIndex <= 0}
                  aria-label="Desfazer"
                  title="Desfazer"
                >
                  <span aria-hidden="true">↶</span>
                </button>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'redo' })}
                  disabled={composer.historyIndex >= composer.history.length - 1}
                  aria-label="Refazer"
                  title="Refazer"
                >
                  <span aria-hidden="true">↷</span>
                </button>
              </div>
            </div>

            <div className={`name-stage ${composedName ? 'has-name' : ''}`} aria-live="polite">
              <span className="eyebrow">Prévia ao vivo</span>
              <div className="name-preview">
                {composedName || <span>Seu próximo nome começa aqui</span>}
              </div>
              <div className="stage-actions">
                <button type="button" onClick={() => saveFavorite(composedName)} disabled={!composedName}>
                  Salvar favorito
                </button>
                <button className="primary-button" type="button" onClick={() => copyToClipboard(composedName)} disabled={!composedName}>
                  Copiar nome
                </button>
              </div>
            </div>

            <div className="parts-grid">
              <div className="part-field">
                <div className="part-number">A</div>
                <label htmlFor="prefix">Prefixo <small>abre o nome</small></label>
                <input
                  id="prefix"
                  value={composer.parts.prefix}
                  onChange={(event) => dispatch({ type: 'set-field', key: 'prefix', value: event.target.value })}
                  placeholder="Ex.: Nova"
                />
              </div>
              <div className="part-field is-core">
                <div className="part-number">B</div>
                <label htmlFor="core">Raiz <small>carrega a ideia</small></label>
                <input
                  id="core"
                  value={composer.parts.core}
                  onChange={(event) => dispatch({ type: 'set-field', key: 'core', value: event.target.value })}
                  placeholder="Ex.: Vela"
                />
              </div>
              <div className="part-field">
                <div className="part-number">C</div>
                <label htmlFor="suffix">Sufixo <small>define o território</small></label>
                <input
                  id="suffix"
                  value={composer.parts.suffix}
                  onChange={(event) => dispatch({ type: 'set-field', key: 'suffix', value: event.target.value })}
                  placeholder="Ex.: Labs"
                />
              </div>
            </div>

            <div className="guidance-block">
              <div className="guidance-title">
                <span className={`status-dot ${loading ? 'is-loading' : ''}`} />
                <strong>{loading ? 'Atualizando a direção criativa...' : 'Leitura da marca'}</strong>
              </div>
              <div className="note-list">
                {suggestions.notes.map((note) => <p key={note}>{note}</p>)}
              </div>
            </div>
          </section>

          {favorites.length > 0 && (
            <section className="favorites-card" aria-labelledby="favorites-title">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Sua seleção</span>
                  <h3 id="favorites-title">Nomes salvos</h3>
                </div>
                <span className="counter">{favorites.length}</span>
              </div>
              <div className="favorites-grid">
                {favorites.map((name) => (
                  <div className="favorite-item" key={name}>
                    <strong>{name}</strong>
                    <div>
                      <button type="button" onClick={() => copyToClipboard(name)}>Copiar</button>
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => setFavorites((current) => current.filter((item) => item !== name))}
                        aria-label={`Remover ${name} dos favoritos`}
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>

        <aside className="panel ai-panel" aria-labelledby="ai-title">
          <div className="ai-header">
            <div>
              <div className="step-label"><span>03</span> Curadoria IA</div>
              <h2 id="ai-title">Explore direções</h2>
            </div>
            <button className="refresh-button" type="button" onClick={() => void runSuggestions()} disabled={loading}>
              {loading ? 'Analisando' : 'Regenerar'}
            </button>
          </div>
          <p className="panel-intro">A IA sugere. Você decide o que entra na marca.</p>

          {error && (
            <div className="error-banner" role="alert">
              <strong>Não foi possível atualizar agora.</strong>
              <span>As sugestões anteriores continuam disponíveis.</span>
            </div>
          )}

          <section className="suggestion-section" aria-labelledby="words-title">
            <div className="section-heading compact">
              <div>
                <span className="eyebrow">Ingredientes</span>
                <h3 id="words-title">Palavras sugeridas</h3>
              </div>
              <span className="counter">{suggestions.suggestedWords.length}</span>
            </div>
            <p className="section-help">Clique para preencher o próximo campo livre.</p>
            <div className="suggested-words" aria-busy={loading}>
              {suggestions.suggestedWords.map((word) => (
                <button key={word} type="button" onClick={() => applySuggestedWord(word)}>
                  <span aria-hidden="true">+</span>{word}
                </button>
              ))}
            </div>
          </section>

          <section className="suggestion-section" aria-labelledby="names-title">
            <div className="section-heading compact">
              <div>
                <span className="eyebrow">Rotas completas</span>
                <h3 id="names-title">Nomes sugeridos</h3>
              </div>
              <span className="counter">{suggestions.suggestedNames.length}</span>
            </div>
            <div className={`suggestion-list ${loading ? 'is-refreshing' : ''}`} aria-busy={loading}>
              {suggestions.suggestedNames.map((name, index) => (
                <article className="suggestion-card" key={name}>
                  <span className="suggestion-index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="suggestion-copy">
                    <strong>{name}</strong>
                    <span>Gerado a partir da direção atual</span>
                  </div>
                  <div className="suggestion-actions">
                    <button type="button" onClick={() => saveFavorite(name)} aria-label={`Salvar ${name}`} title="Salvar favorito">+</button>
                    <button
                      className="use-button"
                      type="button"
                      onClick={() => dispatch({ type: 'replace', parts: parseSuggestedName(name) })}
                    >
                      Usar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <button
            type="button"
            className="complete-button"
            disabled={!primarySuggestion}
            onClick={() => dispatch({ type: 'complete', parts: parseSuggestedName(primarySuggestion) })}
          >
            <span>Completar sem apagar</span>
            <small>Preenche apenas os campos vazios</small>
          </button>

          <div className="ai-disclaimer">
            <span aria-hidden="true">i</span>
            <p>Antes de decidir, verifique disponibilidade de marca, domínio e redes sociais.</p>
          </div>
        </aside>
      </div>

      <div className="toast" aria-live="polite" data-visible={Boolean(copyStatus)}>
        {copyStatus}
      </div>
    </div>
  );
}

export default App;
