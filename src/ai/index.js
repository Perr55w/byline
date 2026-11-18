// Provider selection: Claude when configured and within budget, otherwise the local provider.
import { local } from './local.js';
import { makeClaude } from './claude.js';
import { getSettings, get, run, now } from '../db.js';

export function monthSpend() {
  const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  return get('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM usage WHERE created_at >= ?', start.toISOString()).s;
}

export function providerStatus() {
  const s = getSettings();
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  const spend = monthSpend();
  const overBudget = spend >= (s.budget?.monthly_usd ?? 0);
  const wantClaude = s.ai.provider === 'claude' || (s.ai.provider === 'auto' && hasKey);
  return {
    active: wantClaude && hasKey && !overBudget ? 'claude' : 'local',
    has_key: hasKey, month_spend_usd: Math.round(spend * 10000) / 10000,
    budget_usd: s.budget?.monthly_usd, over_budget: overBudget, model: s.ai.model
  };
}

export function getProvider(runId = null) {
  const st = providerStatus();
  if (st.active !== 'claude') return local;
  const s = getSettings();
  return makeClaude({
    model: s.ai.model, effort: s.ai.effort || 'low',
    onUsage: (u) => run('INSERT INTO usage(run_id, provider, operation, input_tokens, output_tokens, cost_usd, created_at) VALUES(?,?,?,?,?,?,?)',
      runId, u.provider, u.operation, u.input_tokens, u.output_tokens, u.cost_usd, now())
  });
}
