// Metrics for the chat (SPEC section 7). Plain code: every number the chat
// shows comes from here, for any quarter or year, by channel and by new logo /
// expansion, as reported today or if fixes are approved.
import { normalizeEmail } from './lib/email.js';
import { daysBetween } from './lib/dates.js';
import { channelOf, channelFor, inRange } from './attribution.js';
import { QUARTERS, CHANNELS, NO_SOURCE, NO_ACTIVITY, WON, LOST, TODAY } from './config.js';

export const ALL_CHANNELS = [...CHANNELS, NO_SOURCE, NO_ACTIVITY];
export const isMarketingChannel = (ch) => ch !== NO_SOURCE && ch !== NO_ACTIVITY;

/** "Q3-2026" → that quarter; "2026" → the year (quarters in it, up to today). */
export function resolvePeriod(id) {
  const q = QUARTERS.find((x) => x.id === id);
  if (q) return { id: q.id, label: q.label, start: q.start, end: q.end, quarters: [q.id], in_progress: !!q.inProgress };
  const year = /^\d{4}$/.test(id ?? '') ? id : null;
  const qs = QUARTERS.filter((x) => year && x.start.startsWith(year));
  if (!qs.length) throw new Error(`Unknown period "${id}". Use a quarter id (${QUARTERS.map((x) => x.id).join(', ')}) or a year (2026).`);
  const inProgress = qs.some((x) => x.inProgress);
  return { id: year, label: `${year}${inProgress ? ` (through ${TODAY})` : ''}`, start: qs[0].start, end: qs[qs.length - 1].end, quarters: qs.map((x) => x.id), in_progress: inProgress };
}

/** Channel of a contact's last successful activity on or before a date (used for MQLs). */
function contactChannel(contact, date, idx, view) {
  const list = view === 'reported' ? idx.crmByContact.get(contact.id) : idx.mapByEmail.get(normalizeEmail(contact.email));
  let last = null;
  for (const m of list ?? []) { if (m.activity_date > date) break; last = m; }
  return channelOf(last, last?.campaign, { useClickIds: view === 'if_fixes_approved' });
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const blank = () => ({ mqls: 0, opportunities_created: 0, pipeline_created: 0, deals_won: 0, won_arr: 0, deals_lost: 0, cycle_days: 0 });
const finish = (m) => {
  const { cycle_days, ...rest } = m;
  return {
    ...rest,
    win_rate_pct: pct(m.deals_won, m.deals_won + m.deals_lost),
    avg_deal_size: m.deals_won ? Math.round(m.won_arr / m.deals_won) : null,
    avg_sales_cycle_days: m.deals_won ? Math.round(cycle_days / m.deals_won) : null,
  };
};

/**
 * All metrics for a period in one view.
 * Opportunities: created in the period (pipeline) and closed in the period (won / lost).
 * Segment: 'all' | 'new_logo' | 'expansion' (MQLs have no segment and are only counted for 'all').
 */
export function metricsFor(data, idx, period, { view = 'reported', segment = 'all' } = {}) {
  const total = blank();
  const byChannel = Object.fromEntries(ALL_CHANNELS.map((c) => [c, blank()]));
  const add = (ch, f, v) => { total[f] += v; byChannel[ch][f] += v; };
  if (segment === 'all') {
    for (const c of data.contacts) if (inRange(c.mql_date, period)) add(contactChannel(c, c.mql_date, idx, view), 'mqls', 1);
  }
  for (const o of data.opportunities) {
    if (segment !== 'all' && o.type !== segment) continue;
    const touched = inRange(o.createdate, period) || (inRange(o.closedate, period) && (o.stage === WON || o.stage === LOST));
    if (!touched) continue;
    const ch = channelFor(o, idx, view);
    if (inRange(o.createdate, period)) { add(ch, 'opportunities_created', 1); add(ch, 'pipeline_created', o.amount); }
    if (o.stage === WON && inRange(o.closedate, period)) { add(ch, 'deals_won', 1); add(ch, 'won_arr', o.amount); add(ch, 'cycle_days', daysBetween(o.createdate, o.closedate)); }
    if (o.stage === LOST && inRange(o.closedate, period)) add(ch, 'deals_lost', 1);
  }
  const channels = Object.fromEntries(Object.entries(byChannel).filter(([, m]) => Object.values(m).some((v) => v)).map(([c, m]) => [c, finish(m)]));
  const ms = blank();
  for (const [c, m] of Object.entries(byChannel)) if (isMarketingChannel(c)) for (const k of Object.keys(ms)) ms[k] += m[k];
  return {
    total: finish(total),
    marketing_sourced: { pipeline_created: ms.pipeline_created, share_of_pipeline_pct: pct(ms.pipeline_created, total.pipeline_created), won_arr: ms.won_arr, share_of_won_arr_pct: pct(ms.won_arr, total.won_arr), mqls: ms.mqls },
    channels,
  };
}

export const METRICS = ['mqls', 'opportunities_created', 'pipeline_created', 'deals_won', 'won_arr', 'deals_lost', 'win_rate_pct', 'avg_deal_size', 'avg_sales_cycle_days'];

/** One metric across periods, with the change between each pair of consecutive periods, computed here. */
export function compareMetric(data, idx, periodIds, metric, { view = 'reported', segment = 'all', channel = null } = {}) {
  if (!METRICS.includes(metric) && metric !== 'marketing_sourced_pipeline') throw new Error(`Unknown metric "${metric}".`);
  const values = periodIds.map((id) => {
    const p = resolvePeriod(id);
    const m = metricsFor(data, idx, p, { view, segment });
    const v = metric === 'marketing_sourced_pipeline' ? m.marketing_sourced.pipeline_created
      : channel ? (m.channels[channel]?.[metric] ?? (['win_rate_pct', 'avg_deal_size', 'avg_sales_cycle_days'].includes(metric) ? null : 0))
      : m.total[metric];
    return { period: p.id, label: p.label, in_progress: p.in_progress, value: v };
  });
  const changes = [];
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1].value, b = values[i].value;
    if (a === null || b === null) { changes.push({ from: values[i - 1].period, to: values[i].period, change: null, change_pct: null }); continue; }
    const change = Math.round((b - a) * 10) / 10;
    changes.push({ from: values[i - 1].period, to: values[i].period, change, change_pct: a ? Math.round(((b - a) / Math.abs(a)) * 1000) / 10 : null, direction: change > 0 ? 'up' : change < 0 ? 'down' : 'same' });
  }
  return { metric, view, segment, channel, values, changes };
}
