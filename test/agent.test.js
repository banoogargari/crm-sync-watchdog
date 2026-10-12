// The agent pipeline, tested with the scripted stand-in (no API key, no cost):
// tools -> verifier -> report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScenario, listScenarios } from '../src/sources/files.js';
import { runAgent } from '../src/agent.js';
import { makeSimClient } from '../src/sim-client.js';
import { analyze } from '../src/analyze.js';
import { verifyFindings, numbersInText } from '../src/verify.js';
import { writeReport } from '../src/report.js';

const load = (name) => { const { truth, ...data } = loadScenario(name); return { data, quarter: truth.report_quarter, truth }; };

for (const name of listScenarios()) {
  test(`${name}: the simulated agent passes verification and covers exactly the planted problems`, async () => {
    const { data, quarter, truth } = load(name);
    const run = await runAgent({ client: makeSimClient(), model: 'simulated', data, quarter });
    assert.ok(run.verification.passed, JSON.stringify(run.verification.errors));
    assert.deepEqual(run.findings.issues.map((i) => i.check).sort(), [...truth.problems].sort());
  });
}

test('a wrong first submission is rejected, explained, and then fixed', async () => {
  const { data, quarter } = load('everything');
  const events = [];
  const run = await runAgent({ client: makeSimClient({ mistakeFirst: true }), model: 'simulated', data, quarter, onEvent: (e) => events.push(e) });
  const first = events.find((e) => e.type === 'verification');
  assert.equal(first.passed, false);
  const rules = new Set(first.errors.map((e) => e.rule));
  for (const r of ['V2', 'V3', 'V4', 'V5']) assert.ok(rules.has(r), `expected ${r} in ${[...rules]}`);
  assert.ok(run.verification.passed);
  assert.equal(run.submitAttempts, 2);
});

test('numbers are found in text, but dates, ids, check names and 6sense are not numbers', () => {
  const found = numbersInText('Events rose to $246,000 (C1) after 2026-08-14 in Q3 2026; O5225 moved from 6sense, 28.2% of fills, about $60k.').map((n) => n.value);
  assert.deepEqual(found, [246000, 28.2, 60000]);
});

test('the verifier rejects an explanation that blames the wrong check', () => {
  const { data, quarter } = load('everything');
  const results = analyze(data, quarter);
  const channels = Object.keys(results.totals.reported);
  const findings = {
    headline: 'ok',
    issues: Object.values(results.checks).filter((c) => c.status === 'issue').map((c) => ({ check: c.check, title: c.name, what_happened: '', impact: '', recommended_action: '', needs_human_review: true })),
    channel_explanations: Object.entries(results.changed).map(([channel, c]) => ({ channel, problems: channel === 'Events' ? ['C1', 'C5'] : c.causes, explanation: 'Moved by data problems.' })),
    channel_trust: channels.map((channel) => ({ channel, trusted: false, reason: 'affected' })),
  };
  const v = verifyFindings({ findings, ...results, seenNumbers: new Set() });
  assert.equal(v.passed, false);
  assert.deepEqual(v.errors.map((e) => e.rule), ['V3', 'V3']); // must name C2, and C5 does not move Events
});

test('the report is written with every channel, every fix file and no broken values', async () => {
  const { data, quarter } = load('everything');
  const run = await runAgent({ client: makeSimClient(), model: 'simulated', data, quarter });
  const dir = mkdtempSync(join(tmpdir(), 'csw-'));
  writeReport(run, { dir, source: 'test', data });
  const html = readFileSync(join(dir, 'report.html'), 'utf8');
  assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/);
  for (const ch of Object.keys(run.results.totals.reported)) assert.ok(html.includes(ch), ch);
  assert.equal(readdirSync(join(dir, 'fixes')).length, 6);
  assert.match(readFileSync(join(dir, 'report.md'), 'utf8'), /## What moves and why/);
});

test('the report never shows the codes C1…C6 to the reader', async () => {
  const { data, quarter } = load('everything');
  const run = await runAgent({ client: makeSimClient(), model: 'simulated', data, quarter });
  const dir = mkdtempSync(join(tmpdir(), 'csw-'));
  writeReport(run, { dir, source: 'test', data });
  const visible = readFileSync(join(dir, 'report.html'), 'utf8').replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(visible, /\bC[1-6]\b/);
  assert.doesNotMatch(readFileSync(join(dir, 'report.md'), 'utf8'), /\bC[1-6]\b/);
});

test('marketing-sourced pipeline: total unchanged, marketing share goes up when fixes are approved', () => {
  const { data, quarter } = load('everything');
  const { marketing_sourced: ms, revenue } = analyze(data, quarter);
  assert.equal(revenue.reported.totals.pipeline_created, revenue.if_fixes_approved.totals.pipeline_created);
  assert.equal(ms.reported.pipeline_created.amount, 1064400);
  assert.equal(ms.if_fixes_approved.pipeline_created.amount, 1418400);
  assert.equal(ms.difference.pipeline_created, 354000);
  assert.equal(ms.reported.pipeline_created.share_pct, 51.1);
  assert.equal(ms.if_fixes_approved.pipeline_created.share_pct, 68);
});

test('a headline longer than 3 sentences is rejected', () => {
  const { data, quarter } = load('clean');
  const results = analyze(data, quarter);
  const findings = { headline: 'One. Two. Three. Four.', issues: [], channel_explanations: [], channel_trust: Object.keys(results.totals.reported).map((channel) => ({ channel, trusted: true, reason: 'no open issues' })) };
  const v = verifyFindings({ findings, ...results, seenNumbers: new Set() });
  assert.deepEqual(v.errors.map((e) => e.rule), ['V6']);
});
