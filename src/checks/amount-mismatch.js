// C6 — Opportunity amount vs. subscription.
// Billing is the source of truth for ARR. Each won opportunity is matched to
// the subscription that started at its account within 10 days after it closed.
import { addDays } from '../lib/dates.js';
import { inRange } from '../attribution.js';
import { WON } from '../config.js';

export const billedArr = (s) => (s.interval === 'month' ? s.amount * 12 : s.amount);

export function checkAmountMismatch(data, idx, quarter) {
  const won = data.opportunities.filter((o) => o.stage === WON && inRange(o.closedate, quarter));
  const used = new Set();
  const mismatches = [];
  const unbilled = [];
  for (const o of won.sort((a, b) => a.closedate.localeCompare(b.closedate))) {
    const sub = data.subscriptions.find((s) => !used.has(s.id) && s.account_id === o.account_id && s.start_date >= o.closedate && s.start_date <= addDays(o.closedate, 10));
    if (!sub) { unbilled.push({ opportunity_id: o.id, name: o.name, amount: o.amount, closedate: o.closedate }); continue; }
    used.add(sub.id);
    const billed = billedArr(sub);
    if (billed !== o.amount) mismatches.push({ opportunity_id: o.id, name: o.name, subscription_id: sub.id, opportunity_amount: o.amount, billed_arr: billed, difference: o.amount - billed });
  }
  return {
    check: 'C6', name: 'Opportunity amount vs. subscription',
    status: mismatches.length || unbilled.length ? 'issue' : 'ok',
    opportunity_ids: [...mismatches.map((m) => m.opportunity_id), ...unbilled.map((u) => u.opportunity_id)],
    won_deals_checked: won.length,
    overstated_arr: mismatches.reduce((s, m) => s + m.difference, 0),
    mismatches,
    won_without_subscription: unbilled,
    proposed_fix: 'Billing is correct: update the opportunity amounts to the billed ARR (or record the discount), and confirm whether the unbilled deals are really live.',
  };
}
