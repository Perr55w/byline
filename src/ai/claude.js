// Claude provider (optional). Used when ANTHROPIC_API_KEY is set and the monthly budget allows.
// Retrieved articles are passed as clearly delimited untrusted data; the system prompt forbids
// following instructions found inside them.
import { SYSTEM, makeLLMProvider } from './llm.js';

const PRICES = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5] };

let clientPromise;
async function client() {
  clientPromise ||= import('@anthropic-ai/sdk').then(m => new m.default());
  return clientPromise;
}

export function makeClaude({ model, effortFor = () => 'low', onUsage, client: injected }) {
  async function ask(operation, instruction, payload) {
    const c = injected || await client();
    const response = await c.beta.messages.create({
      model, max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: effortFor(operation) },
      system: SYSTEM,
      messages: [{ role: 'user', content: `${instruction}\n\n${payload}` }]
    });
    if (response.stop_reason === 'refusal') throw new Error('Model declined the request');
    const [pin, pout] = PRICES[model] || PRICES['claude-opus-5-5'];
    const u = response.usage || {};
    onUsage?.({ provider: 'claude', operation, input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0, cost_usd: ((u.input_tokens || 0) * pin + (u.output_tokens || 0) * pout) / 1e6 });
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    return JSON.parse(json);
  }

  return makeLLMProvider({ name: 'claude', ask });
}
