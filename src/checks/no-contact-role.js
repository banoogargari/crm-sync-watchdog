// C5 — Opportunity with no contact.
// Sales created the opportunity without a contact role, so there is no person
// to trace back to marketing. A contact at the same account is suggested for
// review; the opportunity stays unattributed until a person confirms.
import { impactOf, reportOpps } from './common.js';

export function checkNoContactRole(data, idx, quarter) {
  const missing = reportOpps(data, quarter).filter((o) => !o.contact_roles.length);
  const items = missing.map((o) => {
    const candidates = data.contacts.filter((c) => c.account_id === o.account_id)
      .map((c) => ({ c, n: (idx.crmByContact.get(c.id) ?? []).filter((m) => m.activity_date <= o.createdate).length }))
      .sort((a, b) => b.n - a.n || a.c.createdate.localeCompare(b.c.createdate));
    const s = candidates[0];
    return {
      opportunity_id: o.id, name: o.name, amount: o.amount, stage: o.stage, createdate: o.createdate,
      suggested_contact_id: s?.c.id ?? null, suggested_contact_email: s?.c.email ?? null,
      suggested_contact_activities: s?.n ?? 0, candidates: candidates.length, needs_review: true,
    };
  });
  return {
    check: 'C5', name: 'Opportunity with no contact',
    status: missing.length ? 'issue' : 'ok',
    ...impactOf(missing, quarter),
    items,
    proposed_fix: 'Ask the opportunity owners to add the contact role; suggested contacts are listed for review. Consider making a contact role required at opportunity creation.',
  };
}
