const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

const sanitizeList = (items) =>
  Array.isArray(items)
    ? [...new Set(items.map((item) => String(item).trim()).filter(Boolean))]
    : [];

const parseResponseJson = (content) => {
  if (!content || typeof content !== 'string') return null;
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

const makePayload = (model, body) => {
  const { businessContext, baseWords, currentNameParts } = body;

  return {
    model,
    messages: [
      {
        role: 'system',
        content:
          'Você é um assistente de branding focado em nomes de empresas e startups. Sempre responda em JSON puro, sem markdown, com o objeto: { "suggestedWords": string[], "suggestedNames": string[], "notes": string[] } .'
      },
      {
        role: 'user',
        content: JSON.stringify({
          businessContext,
          baseWords,
          currentNameParts,
          request:
            'Sugira até 8 palavras e até 6 nomes completos para montar uma marca de empresa. Use português como principal, com tom da marca indicado. Gere apenas sugestões úteis e únicas.'
        })
      }
    ],
    temperature: 0.8,
    max_tokens: 700,
    response_format: { type: 'json_object' }
  };
};

const callOpenAI = async (apiKey, model, body) => {
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(makePayload(model, body))
  });

  const raw = await response.json();

  if (!response.ok) {
    throw new Error(raw?.error?.message || `Erro da OpenAI: ${response.status}`);
  }

  const content = raw?.choices?.[0]?.message?.content || '';
  const parsed = parseResponseJson(content);
  if (!parsed) throw new Error('Não foi possível interpretar a resposta da IA.');

  return {
    suggestedWords: sanitizeList(parsed.suggestedWords).slice(0, 8),
    suggestedNames: sanitizeList(parsed.suggestedNames).slice(0, 6),
    notes: sanitizeList(parsed.notes).slice(0, 5),
    modelUsed: model
  };
};

const buildHeaders = (statusCode = 200, extra = {}) => ({
  statusCode,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Content-Type': 'application/json',
    ...extra
  }
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return buildHeaders();
  }

  if (event.httpMethod !== 'POST') {
    return {
      ...buildHeaders(405),
      body: JSON.stringify({ error: { message: 'Método não permitido. Use POST.' } })
    };
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        ...buildHeaders(500),
        body: JSON.stringify({
          error: {
            message:
              'OPENAI_API_KEY não encontrada nas variáveis de ambiente do Netlify.'
          }
        })
      };
    }

    const body = JSON.parse(event.body || '{}');
    const primaryModel = process.env.OPENAI_MODEL || 'gpt-5.6-sol';
    const fallbackModel = process.env.OPENAI_FALLBACK_MODEL || 'gpt-5.6-terra';
    const tertiaryModel = 'gpt-4.1';

    const attempts = [primaryModel, fallbackModel, tertiaryModel];
    const errors = [];

    for (const model of attempts) {
      try {
        const data = await callOpenAI(apiKey, model, body);
        return {
          ...buildHeaders(200),
          body: JSON.stringify({
            suggestions: data,
            modelUsed: data.modelUsed,
            requestModel: model
          })
        };
      } catch (error) {
        errors.push(`${model}: ${error.message}`);
        if (model === fallbackModel) throw error;
      }
    }

    return {
      ...buildHeaders(500),
      body: JSON.stringify({ error: { message: errors.join(' | ') } })
    };
  } catch (error) {
    return {
      ...buildHeaders(500),
      body: JSON.stringify({ error: { message: error.message } })
    };
  }
};
