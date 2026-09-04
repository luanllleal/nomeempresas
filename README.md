# NomeEmpresas IA

Aplicação web para criar nomes de empresas com curadoria de IA em tempo real.

- Montagem de nome no centro (prefixo, raiz e sufixo).
- Sugestões contínuas da IA conforme você digita perfil, contexto e palavras-chave.
- Opções de palavras e nomes sugeridos pela IA.
- Favoritos e cópia rápida.
- Desfazer/refazer da montagem atual.
- Favoritos persistidos localmente no navegador.
- Interface escura responsiva com fluxo em três etapas.

## Como rodar localmente

```bash
npm install
npm run dev
```

## Configuração da IA

1. Copie `.env.example` para `.env`:

```bash
cp .env.example .env
```

2. Preencha:

```bash
OPENAI_API_KEY=COLE_SUA_CHAVE_AQUI
OPENAI_MODEL=gpt-5.6-sol
OPENAI_FALLBACK_MODEL=gpt-5.6-terra
OPENAI_REASONING_EFFORT=max
```

3. Inicie o projeto.

> Em produção, a chave é lida por variável de ambiente na Netlify Function, nunca no frontend.

A função usa a Responses API, Structured Outputs e `reasoning.effort=max` no GPT-5.6 Sol. Se o modelo principal estiver indisponível, tenta GPT-5.6 Terra e depois GPT-4.1.

## Deploy no Netlify

### 1) Suba no GitHub

```bash
git add .
git commit -m "feat: add react app with netlify function for nome suggestions"
git push origin main
```

### 2) Configure no Netlify

- Conecte o repositório `luanllleal/nomeempresas`.
- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`
- Variáveis de ambiente:
  - `OPENAI_API_KEY` (sua chave)
  - `OPENAI_MODEL=gpt-5.6-sol`
  - `OPENAI_FALLBACK_MODEL=gpt-5.6-terra`
  - `OPENAI_REASONING_EFFORT=max`

Observação: o fallback final no servidor também tenta `gpt-4.1`, para manter a operação se houver indisponibilidade temporária da família 5.6.

Deploy automático é disparado no push do `main`.
