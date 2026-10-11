// C4 — Duplicate contacts.
// Same person twice (same email after normalizing case and +tags); the
// opportunity sits on the copy with no marketing activity.
import { normalizeEmail } from '../lib/email.js';
import { primaryContactId } from '../attribution.js';
import { impactOf, reportOpps, channelChange } from './common.js';

export function checkDuplicates(data, idx, quarter) {
  const activityCount = (c) => (idx.crmByContact.get(c.id) ?? []).length;
  const pairs = [];
  const merges = {};
  for (const [email, group] of idx.contactsByEmail) {
    if (group.length < 2) continue;
    const keep = [...group].sort((a, b) => activityCount(b) - activityCount(a) || a.createdate.localeCompare(b.createdate))[0];
    for (const c of group) if (c !== keep) { merges[c.id] = keep.id; pairs.push({ email, keep_id: keep.id, duplicate_id: c.id, duplicate_email: c.email, keep_activities: activityCount(keep), duplicate_activities: activityCount(c) }); }
  }
  const affected = reportOpps(data, quarter).filter((o) => merges[primaryContactId(o)]);
  const changed = affected.filter((o) => { const ch = channelChange(o, idx); return ch.reported_channel !== ch.channel_if_fixed; });
  return {
    check: 'C4', name: 'Duplicate contacts',
    status: pairs.length ? 'issue' : 'ok',
    duplicate_pairs: pairs.length,
    ...impactOf(changed, quarter),
    opportunities: changed.map((o) => ({ opportunity_id: o.id, amount: o.amount, stage: o.stage, on_contact: primaryContactId(o), keep_contact: merges[primaryContactId(o)], ...channelChange(o, idx) })),
    items: pairs,
    merges,
    proposed_fix: 'Merge each duplicate into the record that has the marketing activity, and move the opportunity contact role to it.',
  };
}
