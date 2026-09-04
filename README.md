# NomeEmpresas IA

Aplicação web para criar nomes de empresas com ajuda de IA em tempo real.

- Montagem de nome no centro (prefixo, raiz e sufixo).
- Sugestões contínuas da IA conforme você digita perfil, contexto e palavras-chave.
- Opções de palavras e nomes sugeridos pela IA.
- Favoritos e cópia rápida.
- Undo/Redo da montagem atual.

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
```

3. Inicie o projeto.

> Em produção, a chave é lida por variável de ambiente no Netlify Functions, não no frontend.

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

Observação: o fallback final no servidor também tenta `gpt-4.1`, para manter operação se houver indisponibilidade temporária de 5.6.

Deploy automático é disparado no push do `main`.
