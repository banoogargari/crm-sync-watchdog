// Shared helpers for the checks.
import { inRange, channelFor } from '../attribution.js';
import { WON } from '../config.js';

/** Pipeline and ARR that a set of opportunities represents in the report quarter. */
export function impactOf(opps, quarter) {
  return {
    opportunity_ids: opps.map((o) => o.id),
    pipeline_created: opps.filter((o) => inRange(o.createdate, quarter)).reduce((s, o) => s + o.amount, 0),
    closed_won_arr: opps.filter((o) => o.stage === WON && inRange(o.closedate, quarter)).reduce((s, o) => s + o.amount, 0),
  };
}

/** Opportunities that matter for the report quarter (created or won in it). */
export const reportOpps = (data, quarter) => data.opportunities.filter((o) => inRange(o.createdate, quarter) || (o.stage === WON && inRange(o.closedate, quarter)));

/** How an opportunity's channel differs between the two views. */
export const channelChange = (o, idx) => ({ reported_channel: channelFor(o, idx, 'reported'), channel_if_fixed: channelFor(o, idx, 'if_fixes_approved') });
