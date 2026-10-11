// Attribution: which channel gets credit for an opportunity.
//
// Rule (SPEC section 4): the channel of the LAST successful marketing activity
// of the opportunity's primary contact on or before the day it was created.
//
// Two views:
//   reported          what the CRM shows today (CRM campaign members only)
//   if_fixes_approved what it would show if the safe fixes were applied:
//                     unsynced campaigns and statuses synced (marketing-tool
//                     members), duplicates merged, and dropped paid clicks
//                     credited by their click ID. Form fills with no clues and
//                     opportunities with no contact stay unresolved.

import { normalizeEmail } from './lib/email.js';
import { CAMPAIGN_TYPES, UTM_CHANNEL, CLICK_ID_CHANNEL, SEARCH_REFERRERS, NO_SOURCE, NO_ACTIVITY, WON } from './config.js';

export const inRange = (date, q) => !!date && date >= q.start && date <= q.end;
export const primaryContactId = (o) => o.contact_roles.find((r) => r.is_primary)?.contact_id ?? o.contact_roles[0]?.contact_id ?? null;

/** Channel of one activity (campaign type, or the form fill's UTM / referrer). */
export function channelOf(member, campaign, { useClickIds = false } = {}) {
  if (!member) return NO_ACTIVITY;
  if (campaign.type !== 'web_form') return CAMPAIGN_TYPES[campaign.type]?.channel ?? NO_SOURCE;
  if (member.utm_source) return UTM_CHANNEL[member.utm_source] ?? NO_SOURCE;
  const clickId = Object.keys(CLICK_ID_CHANNEL).find((k) => member[k]);
  if (clickId) return useClickIds ? CLICK_ID_CHANNEL[clickId] : NO_SOURCE;
  if (SEARCH_REFERRERS.includes(member.referrer)) return 'Organic';
  return NO_SOURCE;
}

const byDateThenId = (a, b) => a.activity_date.localeCompare(b.activity_date) || a.id.localeCompare(b.id, 'en', { numeric: true });

/** Everything both views need, indexed once. */
export function buildIndex(data) {
  const contactById = new Map(data.contacts.map((c) => [c.id, c]));
  const contactsByEmail = new Map();
  for (const c of data.contacts) {
    const k = normalizeEmail(c.email);
    if (!contactsByEmail.has(k)) contactsByEmail.set(k, []);
    contactsByEmail.get(k).push(c);
  }
  const crmCampaignById = new Map(data.crmCampaigns.map((c) => [c.id, c]));
  const mapCampaignById = new Map(data.mapCampaigns.map((c) => [c.id, c]));

  // CRM view: successful CRM members, per contact.
  const crmByContact = new Map();
  for (const m of data.crmMembers) {
    if (!m.is_success) continue;
    const campaign = crmCampaignById.get(m.campaign_id);
    if (!campaign) continue;
    const row = { ...m, campaign };
    if (!crmByContact.has(m.contact_id)) crmByContact.set(m.contact_id, []);
    crmByContact.get(m.contact_id).push(row);
  }
  // Marketing-tool view: successful members, per normalized email (so a
  // duplicate contact finds the activities of the original record too).
  const mapByEmail = new Map();
  for (const m of data.mapMembers) {
    if (!m.is_success) continue;
    const row = { ...m, campaign: mapCampaignById.get(m.campaign_id) };
    const k = normalizeEmail(m.email);
    if (!mapByEmail.has(k)) mapByEmail.set(k, []);
    mapByEmail.get(k).push(row);
  }
  for (const list of [...crmByContact.values(), ...mapByEmail.values()]) list.sort(byDateThenId);
  return { contactById, contactsByEmail, crmCampaignById, mapCampaignById, crmByContact, mapByEmail };
}

/** Last successful activity before the opportunity was created, in one view. */
export function lastActivity(o, idx, view) {
  const cid = primaryContactId(o);
  if (!cid) return null;
  const list = view === 'reported'
    ? idx.crmByContact.get(cid)
    : idx.mapByEmail.get(normalizeEmail(idx.contactById.get(cid)?.email));
  let last = null;
  for (const m of list ?? []) { if (m.activity_date > o.createdate) break; last = m; }
  return last;
}

export function channelFor(o, idx, view) {
  const last = lastActivity(o, idx, view);
  return channelOf(last, last?.campaign, { useClickIds: view === 'if_fixes_approved' });
}

/** Pipeline created and closed-won ARR in a quarter, by channel and type, in one view. */
export function revenueByChannel(data, idx, quarter, view) {
  const rows = new Map();
  const add = (o, field) => {
    const channel = channelFor(o, idx, view);
    const key = `${channel}|${o.type}`;
    const r = rows.get(key) ?? { channel, type: o.type, pipeline_created: 0, opps_created: 0, closed_won_arr: 0, deals_won: 0 };
    if (field === 'pipeline') { r.pipeline_created += o.amount; r.opps_created += 1; } else { r.closed_won_arr += o.amount; r.deals_won += 1; }
    rows.set(key, r);
  };
  for (const o of data.opportunities) {
    if (inRange(o.createdate, quarter)) add(o, 'pipeline');
    if (o.stage === WON && inRange(o.closedate, quarter)) add(o, 'won');
  }
  const list = [...rows.values()].sort((a, b) => a.channel.localeCompare(b.channel) || a.type.localeCompare(b.type));
  return {
    rows: list,
    totals: {
      pipeline_created: list.reduce((s, r) => s + r.pipeline_created, 0),
      closed_won_arr: list.reduce((s, r) => s + r.closed_won_arr, 0),
    },
  };
}

/** {"channel|type": amount} for comparing with the answer key. */
export const asTable = ({ rows }, field) => Object.fromEntries(rows.filter((r) => r[field]).map((r) => [`${r.channel}|${r.type}`, r[field]]).sort(([a], [b]) => a.localeCompare(b)));
