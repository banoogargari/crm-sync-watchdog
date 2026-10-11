// C3 — UTM dropped on the form fill.
// Form fills with no UTM are sorted by their clues (SPEC section 5):
//   dropped_paid_click  a click ID (gclid / li_fat_id) proves an ad click
//   organic             search-engine referrer, no click ID: a real organic visit (not an issue)
//   likely_abm          no click ID, but the account clicked ABA ads in the 14 days before (hint only)
//   unknown             no clues
// It also looks for a sudden rise in unexplained form fills (a form or tracking break).
import { normalizeEmail } from '../lib/email.js';
import { addDays } from '../lib/dates.js';
import { lastActivity } from '../attribution.js';
import { CLICK_ID_CHANNEL, SEARCH_REFERRERS, WINDOWS } from '../config.js';
import { impactOf, reportOpps, channelChange } from './common.js';

const ABA_HINT_CHANNEL = { linkedin_aba: 'LinkedIn', '6sense': '6sense' };

export function classifyFormFill(m, accountId, aba) {
  const clickId = Object.keys(CLICK_ID_CHANNEL).find((k) => m[k]);
  if (clickId) return { group: 'dropped_paid_click', channel: CLICK_ID_CHANNEL[clickId], evidence: `${clickId} present` };
  if (SEARCH_REFERRERS.includes(m.referrer)) return { group: 'organic', channel: 'Organic', evidence: `referrer ${m.referrer}` };
  const from = addDays(m.activity_date, -WINDOWS.abmHintDays);
  const clicks = {};
  for (const r of aba) {
    if (r.account_id === accountId && r.week_start >= from && r.week_start <= m.activity_date) clicks[r.platform] = (clicks[r.platform] ?? 0) + r.clicks;
  }
  const [platform, n] = Object.entries(clicks).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (n >= WINDOWS.abmHintMinClicks) return { group: 'likely_abm', channel: null, hint: ABA_HINT_CHANNEL[platform], evidence: `${n} ${platform} ABA clicks in the ${WINDOWS.abmHintDays} days before` };
  return { group: 'unknown', channel: null, evidence: 'no click ID, no search referrer, no ABA engagement' };
}

/** Date from which the share of unexplained no-UTM form fills jumps. */
export function findBreak(fills, { minBefore = 60, minAfter = 25, minRateAfter = 0.1, minRatio = 3 } = {}) {
  const sorted = [...fills].sort((a, b) => a.date.localeCompare(b.date));
  const n = sorted.length;
  const bad = [0];
  sorted.forEach((f, i) => bad.push(bad[i] + (f.unexplained ? 1 : 0)));
  let best = null;
  for (let i = minBefore; i <= n - minAfter; i++) {
    if (sorted[i].date === sorted[i - 1].date) continue;
    const rb = bad[i] / i;
    const ra = (bad[n] - bad[i]) / (n - i);
    const score = (ra - rb) * Math.sqrt((i * (n - i)) / n);
    if (!best || score > best.score) best = { i, rb, ra, score };
  }
  if (!best || best.ra < minRateAfter || best.ra < minRatio * best.rb) return null;
  const first = sorted.slice(best.i).find((f) => f.unexplained) ?? sorted[best.i];
  const pct = (x) => Math.round(x * 1000) / 10;
  return { start_date: first.date, share_before_pct: pct(best.rb), share_after_pct: pct(best.ra) };
}

export function checkUtmDropped(data, idx, quarter) {
  const webForms = new Set(data.mapCampaigns.filter((c) => c.type === 'web_form').map((c) => c.id));
  const accountOf = (email) => idx.contactsByEmail.get(normalizeEmail(email))?.[0]?.account_id;
  const fills = data.mapMembers.filter((m) => webForms.has(m.campaign_id) && m.is_success).map((m) => {
    const noUtm = !m.utm_source;
    const cls = noUtm ? classifyFormFill(m, accountOf(m.email), data.aba) : null;
    return { m, date: m.activity_date, noUtm, cls, unexplained: noUtm && cls.group !== 'organic' };
  });
  const brk = findBreak(fills);

  const affected = [];
  for (const o of reportOpps(data, quarter)) {
    const last = lastActivity(o, idx, 'reported');
    // (the CRM copy of the form campaign has its own ID, so compare by type)
    if (!last || last.campaign.type !== 'web_form' || last.utm_source) continue;
    const cls = classifyFormFill(last, o.account_id, data.aba);
    if (cls.group === 'organic') continue;
    affected.push({ o, last, cls });
  }
  const groups = {};
  for (const f of fills.filter((x) => x.unexplained && (!brk || x.date >= brk.start_date))) groups[f.cls.group] = (groups[f.cls.group] ?? 0) + 1;
  const count = (g) => affected.filter((a) => a.cls.group === g);
  const sumOf = (list) => impactOf(list.map((a) => a.o), quarter);

  return {
    check: 'C3', name: 'UTM dropped on form fill',
    status: affected.length || brk ? 'issue' : 'ok',
    break: brk,
    form_fills_without_utm_since_break: brk ? fills.filter((f) => f.unexplained && f.date >= brk.start_date).length : 0,
    form_fills_by_group_since_break: groups,
    ...impactOf(affected.map((a) => a.o), quarter),
    by_group: {
      dropped_paid_click: sumOf(count('dropped_paid_click')),
      likely_abm: sumOf(count('likely_abm')),
      unknown: sumOf(count('unknown')),
    },
    opportunities: affected.map(({ o, last, cls }) => ({
      opportunity_id: o.id, amount: o.amount, stage: o.stage, form_fill_date: last.activity_date, landing_page: last.landing_page,
      group: cls.group, evidence: cls.evidence, proposed_channel: cls.channel, abm_hint: cls.hint ?? null,
      needs_review: true, ...channelChange(o, idx),
    })),
    proposed_fix: 'Check the contact-sales form and tracking script around the start date. Dropped paid clicks can be credited by their click ID after review; ABM hints are suggestions only.',
  };
}
