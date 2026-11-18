// Ollama provider: free, local LLM (e.g. on your laptop or home-lab box). Same prompts and guardrails as Claude.
// Install https://ollama.com, run `ollama pull qwen2.5:7b` (or llama3.1:8b), then choose "Ollama" in Settings.
import { SYSTEM, makeLLMProvider } from './llm.js';

export const ollamaHost = () => (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');

export async function ollamaStatus() {
  try {
    const res = await fetch(`${ollamaHost()}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { reachable: false, models: [] };
    return { reachable: true, models: ((await res.json()).models || []).map(m => m.name) };
  } catch { return { reachable: false, models: [] }; }
}

export function makeOllama({ model, onUsage, fetchImpl = fetch }) {
  async function ask(operation, instruction, payload) {
    const res = await fetchImpl(`${ollamaHost()}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(180000),
      body: JSON.stringify({ model, stream: false, format: 'json', options: { temperature: 0.3, num_ctx: 8192 },
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `${instruction}\n\n${payload}` }] })
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    onUsage?.({ provider: 'ollama', operation, input_tokens: data.prompt_eval_count || 0, output_tokens: data.eval_count || 0, cost_usd: 0 });
    const text = data.message?.content || '';
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  }
  return makeLLMProvider({ name: 'ollama', ask });
}
