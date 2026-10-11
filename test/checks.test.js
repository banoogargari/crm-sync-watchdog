// Every number is tested against the answer key of every scenario: the checks
// must find exactly the planted problems, with exact pipeline and ARR, and
// nothing in the clean scenario.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScenario, listScenarios } from '../src/sources/files.js';
import { runChecks } from '../src/checks/index.js';
import { asTable } from '../src/attribution.js';
import { influenceByProgram } from '../src/influence.js';
import { daysBetween } from '../src/lib/dates.js';

const sorted = (xs) => [...xs].sort();

for (const name of listScenarios()) {
  const data = loadScenario(name);
  const { truth } = data;
  const q = truth.report_quarter;
  const { checks, revenue, idx } = runChecks(data, q);

  test(`${name}: only the planted checks report an issue`, () => {
    const flagged = Object.values(checks).filter((c) => c.status === 'issue').map((c) => c.check);
    assert.deepEqual(sorted(flagged), sorted(truth.problems));
  });

  test(`${name}: pipeline and won ARR by channel match the answer key (both views)`, () => {
    for (const view of ['reported', 'if_fixes_approved']) {
      assert.deepEqual(asTable(revenue[view], 'pipeline_created'), truth.report.pipeline_created[view], `pipeline ${view}`);
      assert.deepEqual(asTable(revenue[view], 'closed_won_arr'), truth.report.closed_won_arr[view], `ARR ${view}`);
      assert.deepEqual(revenue[view].totals, truth.report.totals);
    }
  });

  test(`${name}: influence by program matches the answer key`, () => {
    const got = influenceByProgram(data, idx, q);
    for (const p of got.programs) {
      const want = truth.influence.programs[p.program];
      assert.deepEqual(p.opportunity_ids.creation, want.creation, `${p.program} creation`);
      assert.deepEqual(p.opportunity_ids.progression, want.progression, `${p.program} progression`);
      assert.equal(p.influenced_pipeline, want.pipeline, `${p.program} pipeline`);
    }
  });

  for (const c of ['C1', 'C2', 'C3', 'C4', 'C5']) {
    if (!truth[c]) continue;
    test(`${name}: ${c} finds the planted opportunities with exact impact`, () => {
      assert.deepEqual(sorted(checks[c].opportunity_ids), sorted(truth[c].opportunity_ids));
      assert.equal(checks[c].pipeline_created, truth[c].pipeline_created);
      assert.equal(checks[c].closed_won_arr, truth[c].closed_won_arr);
    });
  }

  if (truth.C3) test(`${name}: C3 sorts each form fill into the right group, with the right ABM hint`, () => {
    const got = Object.fromEntries(checks.C3.opportunities.map((o) => [o.opportunity_id, o]));
    for (const k of truth.C3.cases) {
      assert.equal(got[k.opportunity_id].group, k.group, k.opportunity_id);
      assert.equal(got[k.opportunity_id].abm_hint, k.abm_hint, k.opportunity_id);
    }
    // Small breaks are hard to date exactly (normal direct traffic adds noise); allow 14 days.
    assert.ok(Math.abs(daysBetween(truth.C3.start_date, checks.C3.break.start_date)) <= 14,
      `break ${checks.C3.break.start_date} vs ${truth.C3.start_date}`);
  });

  if (truth.C6) test(`${name}: C6 finds the amount mismatches and the unbilled deal`, () => {
    const strip = ({ opportunity_id, opportunity_amount, billed_arr, difference }) => ({ opportunity_id, opportunity_amount, billed_arr, difference });
    const by = (a, b) => a.opportunity_id.localeCompare(b.opportunity_id);
    assert.deepEqual(checks.C6.mismatches.map(strip).sort(by), [...truth.C6.mismatches].sort(by));
    assert.deepEqual(sorted(checks.C6.won_without_subscription.map((u) => u.opportunity_id)), sorted(truth.C6.won_without_subscription));
    assert.equal(checks.C6.overstated_arr, truth.C6.overstated_arr);
  });
}

import { channelBridge } from '../src/bridge.js';
for (const name of listScenarios()) {
  test(`${name}: every move between the two views is explained by a planted problem`, () => {
    const data = loadScenario(name);
    const result = runChecks(data, data.truth.report_quarter);
    const bridge = channelBridge(data, result, data.truth.report_quarter);
    for (const m of bridge.moves) assert.ok(data.truth.problems.includes(m.because_of), `${m.opportunity_id} moved because of ${m.because_of}`);
    for (const r of bridge.rows) assert.equal(r.reported + Object.values(r.changes).reduce((s, x) => s + x, 0), r.if_fixes_approved, r.channel);
  });
}
