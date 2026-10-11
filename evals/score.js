#!/usr/bin/env node
// Runs the agent on every scenario and grades it against the answer keys.
//
//   npm run eval                     real Claude, 1 run per scenario (about $1-2)
//   npm run eval -- --runs 3         steadier numbers
//   npm run eval -- --sim            scripted stand-in, free (tests the scorer itself)
//
// Writes evals/results.md (the table for the README) and evals/results.json.
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { loadScenario, listScenarios } from '../src/sources/files.js';
import { runAgent } from '../src/agent.js';
import { makeSimClient } from '../src/sim-client.js';
import { asTable } from '../src/attribution.js';
import { influenceByProgram } from '../src/influence.js';

const { values: args } = parseArgs({
  options: {
    runs: { type: 'string', default: '1' },
    scenario: { type: 'string', multiple: true },
    sim: { type: 'boolean', default: false },
    model: { type: 'string' },
  },
});
const runs = Number(args.runs);
const model = args.sim ? 'simulated' : args.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5';
if (!args.sim && !process.env.ANTHROPIC_API_KEY) {
  console.error('No ANTHROPIC_API_KEY in .env. Use --sim to test the scorer without one.');
  process.exit(1);
}
const scenarios = args.scenario ?? listScenarios();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (x) => [...x].sort();

/** Channel rows the answer key says are affected, from the answer key's own tables. */
export function truthAffectedChannels(truth, run) {
  const s = new Set();
  for (const field of ['pipeline_created', 'closed_won_arr']) {
    const { reported, if_fixes_approved: fixed } = truth.report[field];
    const total = (t, ch) => Object.entries(t).filter(([k]) => k.split('|')[0] === ch).reduce((x, [, v]) => x + v, 0);
    const chans = new Set([...Object.keys(reported), ...Object.keys(fixed)].map((k) => k.split('|')[0]));
    for (const ch of chans) if (total(reported, ch) !== total(fixed, ch)) s.add(ch);
  }
  if (truth.C3?.cases.some((c) => c.group !== 'dropped_paid_click')) s.add('No source');
  if (truth.C5) s.add('No marketing activity');
  // C6: the answer key has no channel for the won deals, so use the rows the report code puts them in.
  if (truth.C6) for (const [ch, list] of Object.entries(run.results.affected)) if (list.includes('C6')) s.add(ch);
  return s;
}

function grade(run, truth, data) {
  const { checks, revenue, idx } = run.results;
  const planted = new Set(truth.problems);
  const ok = run.verification.passed;
  const reported = new Set(ok ? run.findings.issues.map((i) => i.check) : []);
  const trust = new Map((ok ? run.findings.channel_trust : []).map((t) => [t.channel, t.trusted]));
  const affected = truthAffectedChannels(truth, run);
  const rows = Object.keys(run.results.totals.reported);
  const exact = [...planted].filter((c) => c === 'C6'
    ? checks.C6.overstated_arr === truth.C6.overstated_arr && same(sorted(checks.C6.opportunity_ids), sorted(truth.C6.opportunity_ids))
    : same(sorted(checks[c].opportunity_ids), sorted(truth[c].opportunity_ids)) && checks[c].pipeline_created === truth[c].pipeline_created && checks[c].closed_won_arr === truth[c].closed_won_arr).length;
  const reportExact = ['reported', 'if_fixes_approved'].every((v) => same(asTable(revenue[v], 'pipeline_created'), truth.report.pipeline_created[v]) && same(asTable(revenue[v], 'closed_won_arr'), truth.report.closed_won_arr[v]));
  const cases = truth.C3?.cases ?? [];
  const byOpp = new Map(checks.C3.opportunities.map((o) => [o.opportunity_id, o]));
  const sortedRight = cases.filter((k) => byOpp.get(k.opportunity_id)?.group === k.group).length;
  const hints = cases.filter((k) => byOpp.get(k.opportunity_id)?.abm_hint);
  const hintsRight = hints.filter((k) => byOpp.get(k.opportunity_id).abm_hint === k.true_channel).length;
  const inf = influenceByProgram(data, idx, truth.report_quarter).programs;
  const influenceExact = inf.every((p) => same(p.opportunity_ids.total, truth.influence.programs[p.program].total) && p.influenced_pipeline === truth.influence.programs[p.program].pipeline);
  return {
    planted: planted.size,
    detected: [...planted].filter((c) => reported.has(c)).length,
    false_alarms: [...reported].filter((c) => !planted.has(c)).length,
    impact_exact: exact,
    report_exact: reportExact,
    wrongly_trusted: [...affected].filter((ch) => trust.get(ch) === true).length,
    cautious_on_clean: rows.filter((ch) => !affected.has(ch) && trust.get(ch) === false).length,
    form_fills: cases.length, form_fills_sorted_right: sortedRight,
    hints: hints.length, hints_right: hintsRight,
    influence_exact: influenceExact,
    passed_verification: ok,
    first_try: ok && run.submitAttempts === 1,
    turns: run.turns, cost_usd: run.usage.cost_usd, seconds: run.seconds,
  };
}

const all = [];
for (const name of scenarios) {
  const { truth, ...data } = loadScenario(name);
  for (let i = 1; i <= runs; i++) {
    const t0 = Date.now();
    process.stdout.write(`${name.padEnd(18)} run ${i}/${runs} … `);
    let g;
    try {
      const run = await runAgent({ client: args.sim ? makeSimClient() : new Anthropic(), model, data, quarter: truth.report_quarter });
      run.seconds = Math.round((Date.now() - t0) / 1000);
      g = grade(run, truth, data);
    } catch (err) {
      g = { error: String(err.message ?? err), planted: truth.problems.length, detected: 0, false_alarms: 0, impact_exact: 0, report_exact: false, wrongly_trusted: 0, cautious_on_clean: 0, form_fills: 0, form_fills_sorted_right: 0, hints: 0, hints_right: 0, influence_exact: false, passed_verification: false, first_try: false, turns: 0, cost_usd: 0, seconds: 0 };
    }
    all.push({ scenario: name, run: i, ...g });
    console.log(g.error ? `ERROR ${g.error}` : `${g.detected}/${g.planted} found · ${g.false_alarms} false alarms · ${g.wrongly_trusted} wrongly trusted · ${g.passed_verification ? 'verified' : 'NOT verified'} · ${g.turns} turns · $${g.cost_usd}`);
  }
}

// ---- summary tables -------------------------------------------------------
const sum = (rows, k) => rows.reduce((s, r) => s + (typeof r[k] === 'boolean' ? Number(r[k]) : r[k]), 0);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const lines = [
  '| Scenario | Problems found | False alarms | Impact exact | Report exact (both views) | Affected channels shown as trusted | Passed verification (1st try) | Avg cost |',
  '|---|---|---|---|---|---|---|---|',
];
for (const name of scenarios) {
  const rs = all.filter((r) => r.scenario === name);
  lines.push(`| ${name} | ${sum(rs, 'detected')}/${sum(rs, 'planted')} | ${sum(rs, 'false_alarms')} | ${sum(rs, 'impact_exact')}/${sum(rs, 'planted')} | ${sum(rs, 'report_exact')}/${rs.length} | ${sum(rs, 'wrongly_trusted')} | ${sum(rs, 'passed_verification')}/${rs.length} (${sum(rs, 'first_try')}) | $${(sum(rs, 'cost_usd') / rs.length).toFixed(3)} |`);
}
lines.push(`| **All** | **${sum(all, 'detected')}/${sum(all, 'planted')} (${pct(sum(all, 'detected'), sum(all, 'planted'))})** | **${sum(all, 'false_alarms')}** | **${sum(all, 'impact_exact')}/${sum(all, 'planted')}** | **${sum(all, 'report_exact')}/${all.length}** | **${sum(all, 'wrongly_trusted')}** | **${sum(all, 'passed_verification')}/${all.length} (${sum(all, 'first_try')})** | **$${sum(all, 'cost_usd').toFixed(2)} total** |`);
lines.push('', `No-UTM form fills sorted into the right group: **${sum(all, 'form_fills_sorted_right')}/${sum(all, 'form_fills')} (${pct(sum(all, 'form_fills_sorted_right'), sum(all, 'form_fills'))})** · ABM hint accuracy: **${sum(all, 'hints_right')}/${sum(all, 'hints')} (${pct(sum(all, 'hints_right'), sum(all, 'hints'))})** (hints are never added to the numbers) · Influence by program exact: **${sum(all, 'influence_exact')}/${all.length}**`);

const header = `Model: \`${model}\` · ${runs} run(s) per scenario · ${new Date().toISOString().slice(0, 10)}\n\n`;
writeFileSync(new URL('./results.md', import.meta.url), header + lines.join('\n') + '\n');
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify({ model, runs, results: all }, null, 2) + '\n');
console.log(`\n${header}${lines.join('\n')}\n\nSaved to evals/results.md`);
