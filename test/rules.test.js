// The small rules everything else depends on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelOf } from '../src/attribution.js';
import { classifyFormFill } from '../src/checks/utm-dropped.js';
import { normalizeEmail } from '../src/lib/email.js';

const form = { type: 'web_form' };
const fill = (x) => ({ utm_source: null, referrer: null, gclid: null, li_fat_id: null, activity_date: '2026-09-10', ...x });

test('channel of a form fill: UTM first, then organic search, otherwise no source', () => {
  assert.equal(channelOf(fill({ utm_source: 'linkedin' }), form), 'LinkedIn');
  assert.equal(channelOf(fill({ referrer: 'https://www.google.com/' }), form), 'Organic');
  assert.equal(channelOf(fill({}), form), 'No source');
});

test('a click ID means a paid click: no source as reported, credited only if fixes are approved', () => {
  const m = fill({ gclid: 'Cj0abc', referrer: 'https://www.google.com/' });
  assert.equal(channelOf(m, form), 'No source');
  assert.equal(channelOf(m, form, { useClickIds: true }), 'Paid Search');
});

test('campaign activities take the campaign channel', () => {
  assert.equal(channelOf({}, { type: 'webinar' }), 'Webinars');
  assert.equal(channelOf(null, form), 'No marketing activity');
});

test('form fills without UTM are sorted by their clues', () => {
  const aba = [
    { account_id: 'A1', platform: '6sense', week_start: '2026-09-03', clicks: 4 },
    { account_id: 'A2', platform: 'linkedin_aba', week_start: '2026-08-01', clicks: 9 }, // too early
  ];
  assert.equal(classifyFormFill(fill({ li_fat_id: '123' }), 'A1', aba).group, 'dropped_paid_click');
  assert.equal(classifyFormFill(fill({ referrer: 'https://www.bing.com/' }), 'A1', aba).group, 'organic');
  const hint = classifyFormFill(fill({}), 'A1', aba);
  assert.equal(hint.group, 'likely_abm');
  assert.equal(hint.hint, '6sense');
  assert.equal(classifyFormFill(fill({}), 'A2', aba).group, 'unknown');
});

test('emails that differ only by case or +tag are the same person', () => {
  assert.equal(normalizeEmail('Jane.Doe+sales@Acme.com'), 'jane.doe@acme.com');
});
