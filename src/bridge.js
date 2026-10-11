// "What moved and why": explains the difference between the reported view and
// the if-fixes-approved view, channel by channel and opportunity by
// opportunity, by naming the check (problem) behind each move.
import { channelFor, inRange } from './attribution.js';
import { WON } from './config.js';

export function channelBridge(data, result, quarter, field = 'pipeline_created') {
  const { checks, idx } = result;
  const causeOf = new Map();
  for (const c of Object.values(checks)) for (const id of c.opportunity_ids ?? []) if (!causeOf.has(id)) causeOf.set(id, c.check);
  const inScope = field === 'pipeline_created'
    ? (o) => inRange(o.createdate, quarter)
    : (o) => o.stage === WON && inRange(o.closedate, quarter);

  const moves = [];
  for (const o of data.opportunities.filter(inScope)) {
    const from = channelFor(o, idx, 'reported');
    const to = channelFor(o, idx, 'if_fixes_approved');
    if (from !== to) moves.push({ opportunity_id: o.id, name: o.name, amount: o.amount, from, to, because_of: causeOf.get(o.id) ?? 'unexplained' });
  }
  const rows = new Map();
  const row = (ch) => rows.get(ch) ?? rows.set(ch, { channel: ch, reported: 0, changes: {}, if_fixes_approved: 0 }).get(ch);
  for (const r of result.revenue.reported.rows) row(r.channel).reported += r[field];
  for (const r of result.revenue.if_fixes_approved.rows) row(r.channel).if_fixes_approved += r[field];
  for (const m of moves) {
    row(m.from).changes[m.because_of] = (row(m.from).changes[m.because_of] ?? 0) - m.amount;
    row(m.to).changes[m.because_of] = (row(m.to).changes[m.because_of] ?? 0) + m.amount;
  }
  return { field, rows: [...rows.values()].sort((a, b) => a.channel.localeCompare(b.channel)), moves };
}
