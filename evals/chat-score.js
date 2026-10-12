#!/usr/bin/env node
// Grades the chat on questions whose answers are known (computed by the metrics code).
//   npm run eval:chat              real Claude (about $0.30-0.60 for all questions)
//   npm run eval:chat -- --sim     scripted stand-in (tests the scorer itself)
// Writes evals/chat-results.md.
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { loadScenario } from '../src/sources/files.js';
import { createChat } from '../src/chat/agent.js';
import { makeChatSimClient } from '../src/chat/sim-client.js';
import { buildIndex } from '../src/attribution.js';
import { metricsFor, resolvePeriod } from '../src/metrics.js';
import { influenceByProgram } from '../src/influence.js';
import { numbersInText } from '../src/verify.js';

const { values: args } = parseArgs({ options: { sim: { type: 'boolean', default: false }, model: { type: 'string' } } });
const model = args.sim ? 'simulated' : args.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5';
if (!args.sim && !process.env.ANTHROPIC_API_KEY) { console.error('No ANTHROPIC_API_KEY in .env. Use --sim to test the scorer.'); process.exit(1); }

const { truth, ...data } = loadScenario('everything');
const idx = buildIndex(data);
const m = (p, view = 'reported') => metricsFor(data, idx, resolvePeriod(p), { view });
const inf = (p, program) => influenceByProgram(data, idx, resolvePeriod(p)).programs.find((x) => x.program === program);

// expect: numbers the answer must contain · caveat: channels that must have a caveat · decline: the honest answer is "I can't"
export const QUESTIONS = [
  { q: 'How much pipeline did events create in Q3 2026?', expect: [m('Q3-2026').channels.Events.pipeline_created], caveat: ['Events'] },
  { q: 'Was Q3 2026 better than Q2 2026 for pipeline created?', expect: [m('Q2-2026').total.pipeline_created, m('Q3-2026').total.pipeline_created] },
  { q: 'How many MQLs did we get in Q2 2026 vs Q3 2026?', expect: [m('Q2-2026').total.mqls, m('Q3-2026').total.mqls] },
  { q: 'What was our win rate in Q3 2026?', expect: [m('Q3-2026').total.win_rate_pct] },
  { q: 'How much pipeline did 6sense source in Q3 2026?', expect: [m('Q3-2026').channels['6sense'].pipeline_created], caveat: ['6sense'] },
  { q: 'How many opportunities did LinkedIn ABA influence in Q3 2026, compared with content syndication?', expect: [inf('Q3-2026', 'LinkedIn ABA').influenced_opportunities, inf('Q3-2026', 'Content Syndication').influenced_opportunities] },
  { q: 'What share of our pipeline was marketing-sourced in Q3 2026?', expect: [m('Q3-2026').marketing_sourced.share_of_pipeline_pct], anyCaveat: true },
  { q: 'Events pipeline dropped a lot from Q2 to Q3 2026. Did events stop working?', expect: [m('Q2-2026').channels.Events.pipeline_created, m('Q3-2026').channels.Events.pipeline_created], caveat: ['Events'] },
  { q: 'How much ARR will we close next quarter?', decline: true },
];

const has = (text, v) => numbersInText(text).some((n) => Math.abs(n.value - v) < 0.051);
const rows = [];
for (const item of QUESTIONS) {
  const chat = createChat({ client: args.sim ? makeChatSimClient() : new Anthropic(), model, data }); // fresh chat per question
  process.stdout.write(`${item.q.slice(0, 70).padEnd(72)} … `);
  let r;
  try { r = await chat.ask(item.q); } catch (err) { r = { verified: false, answer: '', caveats: [], attempts: 0, usage: { cost_usd: 0 }, error: String(err.message ?? err) }; }
  const caveatChannels = new Set(r.caveats.map((c) => c.channel.toLowerCase()));
  const g = {
    question: item.q,
    verified: r.verified,
    first_try: r.verified && r.attempts === 1,
    right_numbers: item.decline ? true : (item.expect ?? []).every((v) => has(r.answer, v)),
    caveats_ok: (item.caveat ?? []).every((ch) => caveatChannels.has(ch.toLowerCase())) && (!item.anyCaveat || r.caveats.length > 0),
    declined_ok: item.decline ? numbersInText(r.answer).length === 0 || /can.?t|cannot|don.?t have|not able|no forecast/i.test(r.answer) : true,
    cost_usd: r.usage.cost_usd,
    answer: r.answer,
  };
  g.pass = g.verified && g.right_numbers && g.caveats_ok && g.declined_ok;
  rows.push(g);
  console.log(`${g.pass ? 'PASS' : 'FAIL'}${g.pass ? '' : ` (${['verified', 'right_numbers', 'caveats_ok', 'declined_ok'].filter((k) => !g[k]).join(', ')})`} · $${g.cost_usd}`);
  if (!g.pass) console.log(`     ${r.answer}${r.error ? ` [${r.error}]` : ''}`);
}

const yes = (b) => (b ? '✅' : '❌');
const lines = ['| Question | Passed checker (1st try) | Right numbers | Caveats where data is broken | Overall |', '|---|---|---|---|---|'];
for (const g of rows) lines.push(`| ${g.question} | ${yes(g.verified)}${g.first_try ? ' (1st)' : ''} | ${yes(g.right_numbers && g.declined_ok)} | ${yes(g.caveats_ok)} | ${yes(g.pass)} |`);
const passed = rows.filter((g) => g.pass).length;
const cost = rows.reduce((s, g) => s + g.cost_usd, 0);
const header = `Model: \`${model}\` · ${new Date().toISOString().slice(0, 10)} · **${passed}/${rows.length} passed** · $${cost.toFixed(2)} total\n\n`;
writeFileSync(new URL('./chat-results.md', import.meta.url), header + lines.join('\n') + '\n\n<details><summary>Answers</summary>\n\n' + rows.map((g) => `**${g.question}**\n\n> ${g.answer.replace(/\n/g, '\n> ')}\n`).join('\n') + '\n</details>\n');
console.log(`\n${header}${lines.join('\n')}\n\nSaved to evals/chat-results.md`);
