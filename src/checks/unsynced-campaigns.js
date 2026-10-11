// C1 — Campaign not synced.
// A program exists in the marketing tool but has no CRM campaign, so none of
// its members (and none of their activities) exist in the CRM.
import { lastActivity } from '../attribution.js';
import { impactOf, reportOpps, channelChange } from './common.js';

export function checkUnsyncedCampaigns(data, idx, quarter) {
  const crmIds = new Set(data.crmCampaigns.map((c) => c.id));
  const unsynced = data.mapCampaigns.filter((c) => !c.crm_campaign_id || !crmIds.has(c.crm_campaign_id));
  const ids = new Set(unsynced.map((c) => c.id));
  const affected = reportOpps(data, quarter).filter((o) => ids.has(lastActivity(o, idx, 'if_fixes_approved')?.campaign_id));

  const items = unsynced.map((c) => {
    const members = data.mapMembers.filter((m) => m.campaign_id === c.id);
    const opps = affected.filter((o) => lastActivity(o, idx, 'if_fixes_approved').campaign_id === c.id);
    return {
      campaign_id: c.id, campaign_name: c.name, type: c.type, date: c.start_date,
      members: members.length, successful_members: members.filter((m) => m.is_success).length,
      opportunities: opps.map((o) => ({ opportunity_id: o.id, amount: o.amount, stage: o.stage, ...channelChange(o, idx) })),
      ...impactOf(opps, quarter),
    };
  });
  return {
    check: 'C1', name: 'Campaign not synced to the CRM',
    status: unsynced.length ? 'issue' : 'ok',
    ...impactOf(affected, quarter),
    items,
    proposed_fix: unsynced.map((c) => `Create/link a CRM campaign for "${c.name}" and sync its ${data.mapMembers.filter((m) => m.campaign_id === c.id).length} members`),
  };
}
