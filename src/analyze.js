// Everything code computes for one quarter, before the AI sees anything.
import { runChecks } from './checks/index.js';
import { channelBridge } from './bridge.js';
import { affectedChannels, channelTotals, changedChannels } from './affected.js';
import { NO_SOURCE, NO_ACTIVITY } from './config.js';

export function analyze(data, quarter) {
  const result = runChecks(data, quarter);
  const bridges = {
    pipeline_created: channelBridge(data, result, quarter, 'pipeline_created'),
    closed_won_arr: channelBridge(data, result, quarter, 'closed_won_arr'),
  };
  const totals = { reported: channelTotals(result.revenue.reported), if_fixes_approved: channelTotals(result.revenue.if_fixes_approved) };
  return {
    ...result,
    marketing_sourced: marketingSourced(totals, result.revenue),
    quarter,
    affected: affectedChannels(data, result),
    totals,
    bridges,
    changed: changedChannels(Object.values(bridges)),
  };
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

/** Pipeline and won ARR credited to a real channel (not "No source" / "No marketing activity"), in both views. */
export function marketingSourced(totals, revenue) {
  const out = {};
  for (const view of ['reported', 'if_fixes_approved']) {
    const real = Object.values(totals[view]).filter((t) => t.channel !== NO_SOURCE && t.channel !== NO_ACTIVITY);
    out[view] = {};
    for (const m of ['pipeline_created', 'closed_won_arr']) {
      const amount = real.reduce((x, t) => x + t[m], 0);
      out[view][m] = { amount, share_pct: pct(amount, revenue[view].totals[m]) };
      for (const seg of ['new_logo', 'expansion']) out[view][`${m}_${seg}`] = real.reduce((x, t) => x + t[seg][m], 0);
    }
  }
  out.difference = Object.fromEntries(['pipeline_created', 'closed_won_arr'].map((m) => [m, out.if_fixes_approved[m].amount - out.reported[m].amount]));
  return out;
}
