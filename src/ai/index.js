// Provider selection: Claude when configured and the wallet allows it, otherwise the free local provider.
import { local } from './local.js';
import { makeClaude } from './claude.js';
import { makeOllama } from './ollama.js';
import { getSettings, get, run, now } from '../db.js';

const spendSince = (iso) => get('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM usage WHERE created_at >= ?', iso).s;

export function monthSpend() {
  const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  return spendSince(start.toISOString());
}

/**
 * Wallet: a fixed amount for a fixed period (e.g. $30 over 3 months). Spending is pace-tracked, never
 * pace-blocked (early testing may run ahead); it stops at the wallet total or at the daily safety cap.
 */
export function walletStatus() {
  const w = getSettings().wallet || {};
  if (!w.total_usd) return null;
  const start = w.start ? new Date(`${w.start}T00:00:00`) : new Date();
  const days = Math.round((w.months || 3) * 30.4);
  const elapsed = Math.min(days, Math.max(0, (Date.now() - start) / 864e5));
  const spent = spendSince(start.toISOString());
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const spentToday = spendSince(today.toISOString());
  const cap = w.daily_cap_usd ?? 1.5;
  const pace = (w.total_usd * elapsed) / days;
  const r = (v) => Math.round(v * 100) / 100;
  return {
    total_usd: w.total_usd, start: w.start, months: w.months || 3, ends: new Date(start.getTime() + days * 864e5).toISOString().slice(0, 10),
    spent_usd: r(spent), remaining_usd: r(Math.max(0, w.total_usd - spent)), spent_today_usd: r(spentToday), daily_cap_usd: cap,
    on_pace_usd: r(pace), ahead_of_pace: spent > pace + 1, expired: elapsed >= days,
    exhausted: spent >= w.total_usd, capped_today: spentToday >= cap
  };
}

export function providerStatus() {
  const s = getSettings();
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  const spend = monthSpend();
  const wallet = walletStatus();
  const overBudget = wallet ? (wallet.exhausted || wallet.capped_today || wallet.expired) : spend >= (s.budget?.monthly_usd ?? 0);
  const wantClaude = s.ai.provider === 'claude' || (s.ai.provider === 'auto' && hasKey);
  const reason = s.ai.provider === 'ollama' ? null : !hasKey ? 'No ANTHROPIC_API_KEY on the server' : !wantClaude ? 'Provider set to local'
    : wallet?.exhausted ? 'Wallet used up' : wallet?.expired ? 'Wallet period ended'
    : wallet?.capped_today ? `Daily safety cap ($${wallet.daily_cap_usd}) reached; resumes tomorrow` : overBudget ? 'Monthly limit reached' : null;
  return {
    active: s.ai.provider === 'ollama' ? 'ollama' : wantClaude && hasKey && !overBudget ? 'claude' : 'local',
    has_key: hasKey, month_spend_usd: Math.round(spend * 10000) / 10000,
    budget_usd: wallet ? wallet.total_usd : s.budget?.monthly_usd, over_budget: overBudget, model: s.ai.provider === 'ollama' ? (s.ai.ollama_model || 'qwen2.5:7b') : s.ai.model, wallet, reason
  };
}

// Cheap, frequent tasks think less; writing tasks think more.
const EFFORT = { summarize: 'low', careerLens: 'low', angles: 'low', meetingPrep: 'low', interview: 'low', thankYou: 'low', project: 'medium', draft: 'medium', rewriteSection: 'medium', outreach: 'medium' };

const logUsage = (runId) => (u) => run('INSERT INTO usage(run_id, provider, operation, input_tokens, output_tokens, cost_usd, created_at) VALUES(?,?,?,?,?,?,?)',
  runId, u.provider, u.operation, u.input_tokens, u.output_tokens, u.cost_usd, now());

export function getProvider(runId = null) {
  const st = providerStatus();
  const s = getSettings();
  // Free local LLM; any failure falls back to the template engine per call.
  if (st.active === 'ollama') return makeOllama({ model: s.ai.ollama_model || 'qwen2.5:7b', onUsage: logUsage(runId) });
  if (st.active !== 'claude') return local;
  return makeClaude({
    model: s.ai.model,
    effortFor: (op) => (!s.ai.effort || s.ai.effort === 'auto') ? (EFFORT[op] || 'low') : s.ai.effort,
    onUsage: logUsage(runId)
  });
}
