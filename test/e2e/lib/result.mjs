// Gate result model. A gate is a list of checks; each check has a measured value, an operator and a limit.
// A check whose value could not be measured is a FAIL with the reason in `detail` (never a silent pass).

export function newGate(id, title, group, spec) {
  return { id, title, group, spec, status: 'pending', checks: [], notes: [], shots: [], ms: 0 };
}

const fmt = (v) => (v === null || v === undefined ? '—' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 0.1 ? 4 : Math.abs(v) < 10 ? 2 : 1)) : String(v));

/**
 * op: '<' | '<=' | '>' | '>=' | '==' | 'between' (limit [lo, hi]) | 'within' (limit [target, tol]) | 'true' | 'info'
 */
export function check(g, name, value, op, limit, { unit = '', detail = '', scope = '' } = {}) {
  let pass;
  if (op === 'info') pass = true;
  else if (value === null || value === undefined || (typeof value === 'number' && Number.isNaN(value))) pass = false;
  else switch (op) {
    case '<': pass = value < limit; break;
    case '<=': pass = value <= limit; break;
    case '>': pass = value > limit; break;
    case '>=': pass = value >= limit; break;
    case '==': pass = value === limit; break;
    case 'between': pass = value >= limit[0] && value <= limit[1]; break;
    case 'within': pass = Math.abs(value - limit[0]) <= limit[1]; break;
    case 'true': pass = value === true; break;
    default: throw new Error(`unknown op ${op}`);
  }
  const lim = op === 'between' ? `${fmt(limit[0])}–${fmt(limit[1])}` : op === 'within' ? `${fmt(limit[0])}±${fmt(limit[1])}` : op === 'true' ? 'true' : op === 'info' ? '' : `${op} ${fmt(limit)}`;
  const c = { name, scope, value: typeof value === 'number' ? +value.toFixed(4) : value, shown: fmt(value) + (unit && value !== null && value !== undefined ? ` ${unit}` : ''), op, limit: lim, pass, detail };
  g.checks.push(c);
  return pass;
}

export function finish(g) {
  if (g.status === 'error' || g.status === 'skip') return g;
  const real = g.checks.filter(c => c.op !== 'info');
  g.status = real.length === 0 ? (g.checks.length ? 'info' : 'fail') : real.every(c => c.pass) ? 'pass' : 'fail';
  if (!g.checks.length) g.notes.push('no checks ran');
  return g;
}
