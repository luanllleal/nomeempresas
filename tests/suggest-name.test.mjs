import assert from 'node:assert/strict';
import test from 'node:test';
import suggestName from '../netlify/functions/suggest-name.js';

const validOutput = JSON.stringify({
  suggestedWords: ['Nexa', 'Clara', 'Pulso', 'Norte', 'Fluxo', 'Brio', 'duas palavras? comentário'],
  suggestedNames: ['Nexa Norte', 'Clara Labs', 'Pulso Digital', 'Brio Uno'],
  notes: ['Direção curta e contemporânea.']
});

const makeOpenAIResponse = (model = 'gpt-5.6-sol') =>
  new Response(JSON.stringify({
    model,
    output: [{
      type: 'message',
      content: [{ type: 'output_text', text: validOutput }]
    }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

const makeRequest = () => new Request('http://localhost/.netlify/functions/suggest-name', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    businessContext: { sector: 'Tecnologia', audience: 'PMEs' },
    baseWords: ['claro', 'ágil'],
    currentNameParts: { prefix: '', core: 'Nexa', suffix: '' }
  })
});

test('usa Responses API e percorre a cadeia de fallback', async () => {
  const environment = new Map([
    ['OPENAI_API_KEY', 'test-key'],
    ['OPENAI_MODEL', 'gpt-5.6-sol'],
    ['OPENAI_FALLBACK_MODEL', 'gpt-5.6-terra'],
    ['OPENAI_REASONING_EFFORT', 'max']
  ]);
  globalThis.Netlify = { env: { get: (key) => environment.get(key) } };

  const calls = [];
  globalThis.fetch = async (url, options) => {
    const payload = JSON.parse(options.body);
    calls.push({ url, payload });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ error: { message: 'modelo indisponível' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return makeOpenAIResponse(payload.model);
  };

  const response = await suggestName(makeRequest());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(calls[0].payload.model, 'gpt-5.6-sol');
  assert.equal(calls[0].payload.reasoning.effort, 'max');
  assert.equal(calls[0].payload.max_output_tokens, 3200);
  assert.equal('max_tokens' in calls[0].payload, false);
  assert.equal(calls[1].payload.model, 'gpt-5.6-terra');
  assert.equal(body.suggestions.modelUsed, 'gpt-5.6-terra');
  assert.equal(body.suggestions.notes[0], 'Direção curta e contemporânea.');
  assert.equal(body.suggestions.suggestedWords.some((word) => /\s/.test(word)), false);
  assert.deepEqual(body.suggestions.suggestedNames, [
    'Nexa Norte',
    'Clara Labs',
    'Pulso Digital',
    'Brio Uno'
  ]);
});
