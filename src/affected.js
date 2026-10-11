// Which channel rows each problem touches. A channel is affected when an
// opportunity a check flagged sits in it today (reported) or would move into
// it if the fix is approved. Affected rows can never be shown as trusted.
import { channelFor } from './attribution.js';

export function affectedChannels(data, result) {
  const { checks, idx } = result;
  const byId = new Map(data.opportunities.map((o) => [o.id, o]));
  const out = {};
  const add = (ch, c) => { (out[ch] ??= []).includes(c) || out[ch].push(c); };
  for (const c of Object.values(checks)) {
    if (c.status !== 'issue') continue;
    for (const id of c.opportunity_ids ?? []) {
      const o = byId.get(id);
      if (!o) continue;
      add(channelFor(o, idx, 'reported'), c.check);
      add(channelFor(o, idx, 'if_fixes_approved'), c.check);
    }
  }
  for (const list of Object.values(out)) list.sort();
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** Pipeline and won ARR per channel (new logo + expansion together) in one view. */
export function channelTotals(revenueView) {
  const out = {};
  for (const r of revenueView.rows) {
    const t = (out[r.channel] ??= { channel: r.channel, pipeline_created: 0, opps_created: 0, closed_won_arr: 0, deals_won: 0, new_logo: { pipeline_created: 0, closed_won_arr: 0 }, expansion: { pipeline_created: 0, closed_won_arr: 0 } });
    t.pipeline_created += r.pipeline_created; t.opps_created += r.opps_created;
    t.closed_won_arr += r.closed_won_arr; t.deals_won += r.deals_won;
    t[r.type].pipeline_created += r.pipeline_created; t[r.type].closed_won_arr += r.closed_won_arr;
  }
  return out;
}

/** Channels whose pipeline or won ARR differs between the two views, with the checks that moved them. */
export function changedChannels(bridges) {
  const out = {};
  for (const b of bridges) {
    for (const r of b.rows) {
      const causes = Object.entries(r.changes).filter(([, v]) => v !== 0).map(([k]) => k);
      if (!causes.length) continue;
      const e = (out[r.channel] ??= { channel: r.channel, causes: [] });
      e[b.field] = { reported: r.reported, if_fixes_approved: r.if_fixes_approved, change: r.if_fixes_approved - r.reported, by_check: r.changes };
      for (const c of causes) if (!e.causes.includes(c)) e.causes.push(c);
    }
  }
  for (const e of Object.values(out)) e.causes.sort();
  return out;
}
