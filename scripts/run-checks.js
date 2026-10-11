// Runs the checks on one scenario and prints a plain summary (no AI).
//   npm run checks -- everything
import { loadScenario } from '../src/sources/files.js';
import { runChecks } from '../src/checks/index.js';
import { influenceByProgram } from '../src/influence.js';
import { channelBridge } from '../src/bridge.js';

const name = process.argv[2] ?? 'everything';
const data = loadScenario(name);
const q = data.truth.report_quarter;
const result = runChecks(data, q);
const { checks, revenue, idx } = result;
const $ = (n) => `$${n.toLocaleString('en-US')}`;
const byChannel = (view, field) => {
  const out = {};
  for (const r of revenue[view].rows) out[r.channel] = (out[r.channel] ?? 0) + r[field];
  return out;
};

console.log(`\nScenario: ${name} — ${data.truth.description}\nQuarter: ${q.label}\n`);
for (const [field, title] of [['pipeline_created', 'Pipeline created'], ['closed_won_arr', 'Closed-won ARR']]) {
  const rep = byChannel('reported', field), fix = byChannel('if_fixes_approved', field);
  console.log(`${title.padEnd(24)} reported   if fixes approved`);
  for (const ch of [...new Set([...Object.keys(rep), ...Object.keys(fix)])].sort()) {
    console.log(`  ${ch.padEnd(22)} ${$(rep[ch] ?? 0).padStart(10)}  ${$(fix[ch] ?? 0).padStart(12)}`);
  }
  console.log();
}
for (const c of Object.values(checks)) {
  const detail = c.status !== 'issue' ? '' : c.check === 'C6'
    ? `  deals: ${c.opportunity_ids.length}, overstated ARR: ${$(c.overstated_arr)}`
    : `  opportunities: ${c.opportunity_ids.length}, pipeline: ${$(c.pipeline_created)}, won ARR: ${$(c.closed_won_arr)}`;
  console.log(`${c.status === 'issue' ? '⚠️ ' : '✅'} ${c.check} ${c.name}${detail}`);
}
if (checks.C3.break) console.log(`   C3: form fills with no UTM and no clues rose from ${checks.C3.break.share_before_pct}% to ${checks.C3.break.share_after_pct}% around ${checks.C3.break.start_date}`);
// What moved, and which problem moved it.
const bridge = channelBridge(data, result, q, 'pipeline_created');
if (bridge.moves.length) {
  const ids = [...new Set(bridge.moves.map((m) => m.because_of))].sort();
  const sign = (n) => (n ? `${n > 0 ? '+' : '−'}${$(Math.abs(n))}` : '');
  console.log('\nWhy pipeline moves between the two views (by problem)');
  console.log(`  ${'Channel'.padEnd(22)} ${'reported'.padStart(10)}  ${ids.map((i) => i.padStart(10)).join(' ')}  ${'if fixed'.padStart(10)}`);
  for (const r of bridge.rows) {
    if (!Object.keys(r.changes).length) continue;
    console.log(`  ${r.channel.padEnd(22)} ${$(r.reported).padStart(10)}  ${ids.map((i) => sign(r.changes[i] ?? 0).padStart(10)).join(' ')}  ${$(r.if_fixes_approved).padStart(10)}`);
  }
  console.log('\nOpportunities that move');
  for (const m of bridge.moves) console.log(`  ${m.opportunity_id}  ${m.because_of}  ${$(m.amount).padStart(8)}  ${m.from} → ${m.to}   (${m.name})`);
}
for (const c of ['C3', 'C5']) {
  const open = c === 'C3' ? checks.C3.opportunities.filter((o) => o.group !== 'dropped_paid_click') : checks.C5.items;
  if (open.length) console.log(`\n${c}: ${open.length} opportunities stay unresolved until a person reviews them (${open.map((o) => o.opportunity_id).join(', ')})`);
}
console.log('\nInfluenced opportunities by program (as reported)');
for (const p of influenceByProgram(data, idx, q).programs) {
  console.log(`  ${p.program.padEnd(20)} creation ${String(p.influenced_creation).padStart(2)}  progression ${String(p.influenced_progression).padStart(2)}  total ${String(p.influenced_opportunities).padStart(2)}  pipeline ${$(p.influenced_pipeline).padStart(11)}  cost/opp ${p.cost_per_influenced_opportunity === null ? '—' : $(p.cost_per_influenced_opportunity)}`);
}
console.log();
