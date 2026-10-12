// The chat: metrics, tools and the answer checker, tested with the scripted stand-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScenario } from '../src/sources/files.js';
import { buildIndex } from '../src/attribution.js';
import { analyze } from '../src/analyze.js';
import { metricsFor, compareMetric, resolvePeriod } from '../src/metrics.js';
import { createChat } from '../src/chat/agent.js';
import { makeChatSimClient } from '../src/chat/sim-client.js';
import { makeChatTools } from '../src/chat/tools.js';
import { verifyAnswer, channelsIn } from '../src/chat/verify.js';

const { truth, ...data } = loadScenario('everything');
const idx = buildIndex(data);
const q3 = resolvePeriod('Q3-2026');

test('chat metrics agree with the report for the same quarter (both views)', () => {
  const a = analyze(data, truth.report_quarter);
  for (const view of ['reported', 'if_fixes_approved']) {
    const m = metricsFor(data, idx, q3, { view });
    assert.equal(m.total.pipeline_created, a.revenue[view].totals.pipeline_created);
    assert.equal(m.total.won_arr, a.revenue[view].totals.closed_won_arr);
    assert.equal(m.marketing_sourced.pipeline_created, a.marketing_sourced[view].pipeline_created.amount);
    for (const [ch, t] of Object.entries(a.totals[view])) assert.equal(m.channels[ch]?.pipeline_created ?? 0, t.pipeline_created, `${view} ${ch}`);
  }
});

test('a year adds up its quarters', () => {
  const year = metricsFor(data, idx, resolvePeriod('2026')).total;
  const sum = ['Q1-2026', 'Q2-2026', 'Q3-2026', 'Q4-2026'].reduce((s, p) => s + metricsFor(data, idx, resolvePeriod(p)).total.pipeline_created, 0);
  assert.equal(year.pipeline_created, sum);
});

test('compare_periods computes the change, so the model never has to', () => {
  const c = compareMetric(data, idx, ['Q2-2026', 'Q3-2026'], 'pipeline_created', { channel: 'Events' });
  const [a, b] = c.values.map((v) => v.value);
  assert.equal(c.changes[0].change, b - a);
  assert.equal(c.changes[0].direction, 'down');
});

test('a simulated question gets a checked answer with a caveat for the broken channel', async () => {
  const chat = createChat({ client: makeChatSimClient(), model: 'simulated', data });
  const r = await chat.ask('How much pipeline did events create in Q3?');
  assert.ok(r.verified, JSON.stringify(r.errors));
  assert.match(r.answer, /\$12,000/);
  assert.equal(r.caveats[0].channel, 'Events');
});

test('an answer that mentions a broken channel without a caveat is rejected, then fixed', async () => {
  const events = [];
  const chat = createChat({ client: makeChatSimClient({ forgetCaveatFirst: true }), model: 'simulated', data });
  const r = await chat.ask('Events pipeline in Q3?', { onEvent: (e) => events.push(e) });
  const first = events.find((e) => e.type === 'verification');
  assert.equal(first.passed, false);
  assert.equal(first.errors[0].rule, 'A3');
  assert.ok(r.verified);
  assert.equal(r.attempts, 2);
});

test('the answer checker rejects invented numbers and internal codes', () => {
  const tools = makeChatTools(data);
  tools.call('get_metrics', { period: 'Q2-2026' });
  const v = verifyAnswer({ answer: 'Pipeline was about $1,234,567 because of C1.', caveats: [] }, tools);
  assert.deepEqual(v.errors.map((e) => e.rule).sort(), ['A1', 'A2']);
});

test('influence programs are not mistaken for sourced channels', () => {
  assert.deepEqual(channelsIn('LinkedIn ABA influenced 41 opportunities; 6sense ABA 41.'), []);
  assert.deepEqual(channelsIn('Events and Paid Search grew.'), ['Events', 'Paid Search']);
});
