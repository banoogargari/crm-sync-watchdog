// The tools Claude can call. Every number Claude sees comes from here, and
// every number it sees is remembered, so the verifier can check that the
// report only uses numbers that really came from the data.
import { normalizeEmail } from '../lib/email.js';
import { addDays } from '../lib/dates.js';
import { channelFor, lastActivity, primaryContactId } from '../attribution.js';
import { classifyFormFill } from '../checks/utm-dropped.js';
import { influenceByProgram, abaSummary } from '../influence.js';
import { WINDOWS } from '../config.js';
import { PROBLEMS } from '../problems.js';

const CHECK_IDS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'];

export const TOOL_DEFINITIONS = [
  {
    name: 'run_checks',
    description:
      'Runs the six checks for the report quarter and returns a summary of each: C1 campaign in the marketing tool not synced to the CRM, ' +
      'C2 success status not synced, C3 UTM dropped on the form fill, C4 duplicate contacts, C5 opportunity with no contact, ' +
      'C6 opportunity amount vs. billed subscription. Also returns which channel rows each problem affects. Start here.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_revenue_by_channel',
    description:
      'Pipeline created and closed-won ARR in the quarter by channel, split into new logo and expansion. Attribution: the last ' +
      'successful marketing activity of the primary contact on or before the day the opportunity was created. ' +
      'view="reported" is what the CRM shows today. view="if_fixes_approved" is a preview after the proposed fixes ' +
      '(synced campaigns and statuses, merged duplicates, paid clicks credited by click ID). Unresolved cases (C3 with no click ID, C5) stay where they are.',
    input_schema: { type: 'object', properties: { view: { type: 'string', enum: ['reported', 'if_fixes_approved'] } }, required: ['view'] },
  },
  {
    name: 'get_what_moved',
    description:
      'Explains the difference between the two views: for every channel, the reported amount, how much each check adds or removes, ' +
      'and the amount if fixes are approved; plus every opportunity that changes channel, with the check that moves it. ' +
      'Use it to explain why each channel changes.',
    input_schema: { type: 'object', properties: { measure: { type: 'string', enum: ['pipeline_created', 'closed_won_arr'] } }, required: ['measure'] },
  },
  {
    name: 'get_check_details',
    description: 'The individual records behind one check (campaigns, members, opportunities, duplicate pairs, billing mismatches).',
    input_schema: {
      type: 'object',
      properties: { check: { type: 'string', enum: CHECK_IDS }, limit: { type: 'integer', description: 'Max items per list (default 25).' } },
      required: ['check'],
    },
  },
  {
    name: 'get_activity_history',
    description:
      'For one opportunity: its primary contact and the marketing activities of that person in the CRM and in the marketing tool, side by side, ' +
      'with the last activity before the opportunity was created in each view. Use it to see why an opportunity is credited to a channel.',
    input_schema: { type: 'object', properties: { opportunity_id: { type: 'string' } }, required: ['opportunity_id'] },
  },
  {
    name: 'get_records',
    description: 'Look up opportunities, contacts, accounts or campaigns by id.',
    input_schema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['opportunity', 'contact', 'account', 'campaign'] }, ids: { type: 'array', items: { type: 'string' }, maxItems: 20 } },
      required: ['kind', 'ids'],
    },
  },
  {
    name: 'form_fills_by_week',
    description:
      'For each week: web form fills, how many had no UTM, and how those were sorted (paid click with a click ID, organic search, likely ABM, unknown). ' +
      'Use it to see when a UTM problem started.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_influence',
    description:
      'Influenced opportunities by program for the quarter (person-based and account-based ABA): created after engagement in the 90 days before, ' +
      'or moved a stage within 30 days after engagement while open; pipeline, spend and cost per influenced opportunity; ABA target accounts, ' +
      'engagement, 6sense stage movement and opportunity rate engaged vs. not engaged. Influence is never added to sourced numbers.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'submit_findings',
    description:
      'Submit the final findings. They are checked automatically before the report is published: every check that found a problem is covered, ' +
      'every channel row has a trust status and affected rows are not trusted, every channel that changes between the views is explained ' +
      'with the checks that move it, no text uses the codes C1…C6, and every number appears in a tool result. If the check fails you get the reasons and can fix and resubmit.',
    input_schema: {
      type: 'object',
      properties: {
        headline: { type: 'string', description: 'Two or three sentences for the CMO: can pipeline and ARR by channel be trusted this quarter, and what matters most.' },
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              check: { type: 'string', enum: CHECK_IDS },
              title: { type: 'string', description: 'Short plain title, e.g. "Customer Summit never reached the CRM".' },
              what_happened: { type: 'string', description: 'What is broken, since when and the likely cause, if you found it.' },
              impact: { type: 'string', description: 'What it does to pipeline and ARR by channel, in plain words.' },
              recommended_action: { type: 'string', description: 'What a person should do. Fixes are never applied automatically.' },
              needs_human_review: { type: 'boolean' },
            },
            required: ['check', 'title', 'what_happened', 'impact', 'recommended_action', 'needs_human_review'],
          },
        },
        channel_explanations: {
          type: 'array',
          description: 'One entry for every channel whose pipeline or won ARR changes between the two views.',
          items: {
            type: 'object',
            properties: {
              channel: { type: 'string' },
              problems: { type: 'array', items: { type: 'string', enum: CHECK_IDS }, description: 'Every check that moves this channel (from get_what_moved).' },
              explanation: { type: 'string', description: 'Why it changes, in plain words for a CMO, using the problems\' plain names (never the codes C1…C6).' },
            },
            required: ['channel', 'problems', 'explanation'],
          },
        },
        channel_trust: {
          type: 'array',
          description: 'One entry for every channel row of the report (both views).',
          items: {
            type: 'object',
            properties: { channel: { type: 'string' }, trusted: { type: 'boolean' }, reason: { type: 'string', description: 'Short plain reason, e.g. "Summit missing in CRM moves deals here" or "no open issues".' } },
            required: ['channel', 'trusted', 'reason'],
          },
        },
      },
      required: ['headline', 'issues', 'channel_explanations', 'channel_trust'],
    },
  },
];

const cap = (list, n) => ({ total: list.length, items: list.slice(0, n) });

export function makeToolHandlers({ data, results }) {
  const { checks, revenue, idx, affected, totals, bridges, quarter, marketing_sourced: ms } = results;
  const seenNumbers = new Set(Object.values(WINDOWS));
  const remember = (value) => {
    JSON.stringify(value, (k, v) => {
      if (typeof v === 'number') seenNumbers.add(v);
      if (typeof v === 'string' && !/^[A-Z]{1,3}\d+$/.test(v)) for (const m of v.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) seenNumbers.add(Number(m[0].replace(/,/g, '')));
      return v;
    });
    return value;
  };
  const oppById = new Map(data.opportunities.map((o) => [o.id, o]));
  const impact = (c) => ({ opportunities: c.opportunity_ids.length, pipeline_created: c.pipeline_created, closed_won_arr: c.closed_won_arr });

  const summary = {
    C1: (c) => ({ ...impact(c), campaigns: c.items.map((i) => ({ campaign_name: i.campaign_name, type: i.type, date: i.date, members: i.members, successful_members: i.successful_members, opportunities: i.opportunities.length })) }),
    C2: (c) => ({ ...impact(c), mismatched_members: c.mismatched_members }),
    C3: (c) => ({
      ...impact(c),
      sudden_change: c.break ? { start_date: c.break.start_date, unexplained_share_before: `${c.break.share_before_pct}%`, unexplained_share_after: `${c.break.share_after_pct}%`, form_fills_without_utm_since: c.form_fills_without_utm_since_break, by_group_since: c.form_fills_by_group_since_break } : null,
      opportunities_by_group: c.by_group,
    }),
    C4: (c) => ({ ...impact(c), duplicate_pairs: c.duplicate_pairs }),
    C5: (c) => impact(c),
    C6: (c) => ({ won_deals_checked: c.won_deals_checked, deals_with_issue: c.opportunity_ids.length, amount_above_billed: c.mismatches.length, overstated_arr: c.overstated_arr, won_without_subscription: c.won_without_subscription.length }),
  };

  const handlers = {
    run_checks: () => ({
      quarter: quarter.label,
      checks: Object.values(checks).map((c) => ({ check: c.check, plain_name: PROBLEMS[c.check].name, status: c.status, ...(c.status === 'issue' ? summary[c.check](c) : {}) })),
      affected_channels: affected,
      totals: revenue.reported.totals,
      marketing_sourced: {
        reported: { pipeline_created: ms.reported.pipeline_created, closed_won_arr: ms.reported.closed_won_arr },
        if_fixes_approved: { pipeline_created: ms.if_fixes_approved.pipeline_created, closed_won_arr: ms.if_fixes_approved.closed_won_arr },
        difference: ms.difference,
        note: 'Marketing-sourced = credited to a real channel, i.e. everything except "No source" and "No marketing activity". Totals do not change with fixes; this share does.',
      },
      note: 'pipeline_created and closed_won_arr per check are the amounts on the opportunities the check affects. C6 overstated_arr is how much opportunity amounts exceed billed ARR.',
    }),
    get_revenue_by_channel: ({ view }) => ({
      view, quarter: quarter.label,
      channels: Object.values(totals[view]),
      totals: revenue[view].totals,
      marketing_sourced: ms[view],
    }),
    get_what_moved: ({ measure }) => {
      const b = bridges[measure];
      return {
        measure,
        channels: b.rows.filter((r) => Object.keys(r.changes).length).map((r) => ({
          channel: r.channel, reported: r.reported, change_by_check: r.changes, if_fixes_approved: r.if_fixes_approved,
          moves_in: b.moves.filter((m) => m.to === r.channel).map((m) => ({ opportunity_id: m.opportunity_id, amount: m.amount, from: m.from, because_of: m.because_of })),
          moves_out: b.moves.filter((m) => m.from === r.channel).map((m) => ({ opportunity_id: m.opportunity_id, amount: m.amount, to: m.to, because_of: m.because_of })),
        })),
        note: 'change_by_check is the net change per check. One check can move opportunities both in and out of a channel; see moves_in and moves_out.',
        unchanged_channels: b.rows.filter((r) => !Object.keys(r.changes).length).map((r) => r.channel),
        opportunities_that_move: b.moves,
        unresolved: {
          C3: checks.C3.opportunities.filter((o) => !o.proposed_channel).map((o) => ({ opportunity_id: o.opportunity_id, amount: o.amount, group: o.group, abm_hint: o.abm_hint, stays_in: o.channel_if_fixed })),
          C5: checks.C5.items.map((i) => ({ opportunity_id: i.opportunity_id, amount: i.amount, suggested_contact_id: i.suggested_contact_id, stays_in: 'No marketing activity' })),
        },
      };
    },
    get_check_details: ({ check, limit = 25 }) => {
      const c = checks[check];
      if (!c) throw new Error(`unknown check ${check}`);
      const n = Math.min(limit, 50);
      switch (check) {
        case 'C1': return { check, items: c.items, proposed_fix: c.proposed_fix };
        case 'C2': return { check, opportunities: c.opportunities, members: cap(c.items, n), proposed_fix: c.proposed_fix };
        case 'C3': return { check, sudden_change: c.break, opportunities: c.opportunities, proposed_fix: c.proposed_fix };
        case 'C4': return { check, opportunities: c.opportunities, duplicate_pairs: cap(c.items, n), proposed_fix: c.proposed_fix };
        case 'C5': return { check, opportunities: c.items, proposed_fix: c.proposed_fix };
        default: return { check, mismatches: c.mismatches, won_without_subscription: c.won_without_subscription, proposed_fix: c.proposed_fix };
      }
    },
    get_activity_history: ({ opportunity_id }) => {
      const o = oppById.get(opportunity_id);
      if (!o) throw new Error(`unknown opportunity ${opportunity_id}`);
      const cid = primaryContactId(o);
      const contact = idx.contactById.get(cid) ?? null;
      const fmt = (m) => ({ date: m.activity_date, campaign: m.campaign?.name, type: m.campaign?.type, status: m.status, success: m.is_success, utm_source: m.utm_source ?? undefined, click_id: m.gclid ? 'gclid' : m.li_fat_id ? 'li_fat_id' : undefined, referrer: m.referrer ?? undefined });
      const crm = (idx.crmByContact.get(cid) ?? []).filter((m) => m.activity_date <= o.createdate);
      const map = contact ? (idx.mapByEmail.get(normalizeEmail(contact.email)) ?? []).filter((m) => m.activity_date <= o.createdate) : [];
      const last = (view) => { const m = lastActivity(o, idx, view); return m ? fmt(m) : null; };
      return {
        opportunity: { id: o.id, name: o.name, type: o.type, amount: o.amount, stage: o.stage, createdate: o.createdate },
        primary_contact: contact ? { id: contact.id, email: contact.email } : null,
        crm_activities_before_creation: crm.slice(-10).map(fmt),
        marketing_tool_activities_before_creation: map.slice(-10).map(fmt),
        reported: { last_activity: last('reported'), channel: channelFor(o, idx, 'reported') },
        if_fixes_approved: { last_activity: last('if_fixes_approved'), channel: channelFor(o, idx, 'if_fixes_approved') },
      };
    },
    get_records: ({ kind, ids }) => {
      const want = new Set(ids.slice(0, 20));
      const source = { opportunity: data.opportunities, contact: data.contacts, account: data.accounts, campaign: [...data.mapCampaigns, ...data.crmCampaigns] }[kind];
      return { kind, records: source.filter((r) => want.has(r.id)) };
    },
    form_fills_by_week: () => {
      const webForms = new Set(data.mapCampaigns.filter((c) => c.type === 'web_form').map((c) => c.id));
      const weeks = new Map();
      for (const m of data.mapMembers) {
        if (!webForms.has(m.campaign_id) || !m.is_success) continue;
        const d = new Date(`${m.activity_date}T00:00:00Z`);
        const monday = addDays(m.activity_date, -((d.getUTCDay() + 6) % 7));
        const w = weeks.get(monday) ?? { week_start: monday, form_fills: 0, no_utm: 0, dropped_paid_click: 0, organic: 0, likely_abm: 0, unknown: 0 };
        w.form_fills += 1;
        if (!m.utm_source) {
          w.no_utm += 1;
          const acct = idx.contactsByEmail.get(normalizeEmail(m.email))?.[0]?.account_id;
          w[classifyFormFill(m, acct, data.aba).group] += 1;
        }
        weeks.set(monday, w);
      }
      return { weeks: [...weeks.values()].filter((w) => w.week_start >= addDays(quarter.start, -91)).sort((a, b) => a.week_start.localeCompare(b.week_start)) };
    },
    get_influence: () => {
      const inf = influenceByProgram(data, idx, quarter);
      const aba = Object.fromEntries(Object.entries(abaSummary(data, quarter)).map(([k, v]) => [k, { ...v, engaged_without_opportunity: v.engaged_without_opportunity.length, examples_engaged_without_opportunity: v.engaged_without_opportunity.slice(0, 5).map((a) => a.name) }]));
      return { ...inf, programs: inf.programs.map(({ opportunity_ids, ...p }) => p), aba };
    },
  };

  return {
    seenNumbers,
    call(name, input) {
      const h = handlers[name];
      if (!h) throw new Error(`unknown tool ${name}`);
      return remember(h(input ?? {}));
    },
  };
}
