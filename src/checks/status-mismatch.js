// C2 — Success status not synced.
// The marketing tool says the person succeeded (e.g. Attended), the CRM still
// shows a non-success status (e.g. Registered), so the activity doesn't count.
import { normalizeEmail } from '../lib/email.js';
import { lastActivity } from '../attribution.js';
import { impactOf, reportOpps, channelChange } from './common.js';

export function checkStatusMismatch(data, idx, quarter) {
  const crmByKey = new Map();
  for (const m of data.crmMembers) {
    const email = normalizeEmail(idx.contactById.get(m.contact_id)?.email);
    crmByKey.set(`${m.campaign_id}|${email}|${m.activity_date}`, m);
  }
  const mismatches = [];
  for (const m of data.mapMembers) {
    const campaign = idx.mapCampaignById.get(m.campaign_id);
    if (!m.is_success || !campaign?.crm_campaign_id) continue; // unsynced campaigns are C1
    const crm = crmByKey.get(`${campaign.crm_campaign_id}|${normalizeEmail(m.email)}|${m.activity_date}`);
    if (crm && !crm.is_success) {
      mismatches.push({ map_member_id: m.id, crm_member_id: crm.id, campaign_name: campaign.name, email: m.email, date: m.activity_date, map_status: m.status, crm_status: crm.status });
    }
  }
  const mismatchIds = new Set(mismatches.map((x) => x.map_member_id));
  const affected = reportOpps(data, quarter).filter((o) => mismatchIds.has(lastActivity(o, idx, 'if_fixes_approved')?.id));
  return {
    check: 'C2', name: 'Success status not synced',
    status: mismatches.length ? 'issue' : 'ok',
    mismatched_members: mismatches.length,
    ...impactOf(affected, quarter),
    opportunities: affected.map((o) => ({ opportunity_id: o.id, amount: o.amount, stage: o.stage, ...channelChange(o, idx), member: mismatches.find((x) => x.map_member_id === lastActivity(o, idx, 'if_fixes_approved').id) })),
    items: mismatches,
    proposed_fix: 'Update the CRM status of the listed members to match the marketing tool, and check the status sync mapping for these programs.',
  };
}
