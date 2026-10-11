// Influenced opportunities by program (SPEC section 6).
//
// Creation:    the program engaged the opportunity's contacts (person-based)
//              or its account (account-based) within 90 days before it was created.
// Progression: the engagement happened while the opportunity was open, and it
//              moved up a stage within 30 days after.
// An opportunity counts once per program. Influence is never added to
// marketing-sourced numbers, and shows interest, not cause.
//
// Uses what is reported today: CRM campaign members for person-based programs,
// ad-platform account data for ABA (which never reaches the CRM).

import { addDays } from './lib/dates.js';
import { inRange } from './attribution.js';
import { PROGRAMS, WINDOWS, LOST } from './config.js';

const PROGRAM_OF_TYPE = { event: 'Events', webinar: 'Webinars', content_syndication: 'Content Syndication', email: 'Email' };
const ABA_PLATFORM_OF = { 'LinkedIn ABA': 'linkedin_aba', '6sense ABA': '6sense' };
export const isAccountBased = (program) => program in ABA_PLATFORM_OF;

export function influenceByProgram(data, idx, quarter) {
  const history = new Map();
  for (const h of data.stageHistory) {
    if (!history.has(h.opportunity_id)) history.set(h.opportunity_id, []);
    history.get(h.opportunity_id).push(h);
  }
  const abaByAccount = new Map();
  for (const r of data.aba) {
    if (r.clicks + r.asset_views <= 0) continue; // impressions alone are reach, not engagement
    const k = `${r.account_id}|${r.platform}`;
    if (!abaByAccount.has(k)) abaByAccount.set(k, []);
    abaByAccount.get(k).push(r.week_start);
  }
  const engagementDates = (o, program) => {
    if (isAccountBased(program)) return abaByAccount.get(`${o.account_id}|${ABA_PLATFORM_OF[program]}`) ?? [];
    const dates = [];
    for (const r of o.contact_roles) {
      for (const m of idx.crmByContact.get(r.contact_id) ?? []) if (PROGRAM_OF_TYPE[m.campaign.type] === program) dates.push(m.activity_date);
    }
    return dates;
  };
  const months = new Set();
  for (let d = quarter.start; d <= quarter.end; d = addDays(d, 28)) months.add(d.slice(0, 7));
  months.add(quarter.end.slice(0, 7));

  const programs = PROGRAMS.map((program) => {
    const creation = [];
    const progression = [];
    for (const o of data.opportunities) {
      const dates = engagementDates(o, program);
      if (!dates.length) continue;
      if (inRange(o.createdate, quarter) && dates.some((x) => x >= addDays(o.createdate, -WINDOWS.influenceCreationDays) && x <= o.createdate)) creation.push(o.id);
      const moves = (history.get(o.id) ?? []).slice(1).filter((h) => h.stage !== LOST && inRange(h.date, quarter));
      if (moves.some((m) => dates.some((x) => x > o.createdate && x < m.date && x >= addDays(m.date, -WINDOWS.influenceProgressionDays)))) progression.push(o.id);
    }
    const total = [...new Set([...creation, ...progression])].sort();
    const totalSet = new Set(total);
    const pipeline = data.opportunities.filter((o) => totalSet.has(o.id)).reduce((s, o) => s + o.amount, 0);
    const spend = data.spend.filter((s) => s.program === program && months.has(s.month)).reduce((s, r) => s + r.spend, 0);
    return {
      program, type: isAccountBased(program) ? 'account-based' : 'person-based',
      influenced_creation: creation.length, influenced_progression: progression.length, influenced_opportunities: total.length,
      influenced_pipeline: pipeline, spend,
      cost_per_influenced_opportunity: total.length ? Math.round(spend / total.length) : null,
      opportunity_ids: { creation: creation.sort(), progression: progression.sort(), total },
    };
  });
  return { quarter: quarter.id, programs, note: 'One opportunity can be influenced by several programs, so rows do not add up. Influence shows interest, not cause, and is never added to marketing-sourced numbers.' };
}

/** ABA extras: engaged target accounts, 6sense stage movement, engaged accounts with no opportunity yet, engaged vs. not. */
export function abaSummary(data, quarter) {
  const out = {};
  for (const [program, platform] of Object.entries(ABA_PLATFORM_OF)) {
    const targets = data.accounts.filter((a) => a.aba_targets.includes(platform));
    const engaged = new Set(data.aba.filter((r) => r.platform === platform && r.clicks + r.asset_views > 0 && inRange(r.week_start, quarter)).map((r) => r.account_id));
    const withOpp = new Set(data.opportunities.filter((o) => inRange(o.createdate, quarter)).map((o) => o.account_id));
    const engagedTargets = targets.filter((a) => engaged.has(a.id));
    const notEngaged = targets.filter((a) => !engaged.has(a.id));
    const rate = (list) => (list.length ? Math.round((list.filter((a) => withOpp.has(a.id)).length / list.length) * 1000) / 10 : null);
    const entry = {
      target_accounts: targets.length,
      engaged_accounts: engagedTargets.length,
      opportunity_rate_engaged_pct: rate(engagedTargets),
      opportunity_rate_not_engaged_pct: rate(notEngaged),
      engaged_without_opportunity: engagedTargets.filter((a) => !data.opportunities.some((o) => o.account_id === a.id && (o.closedate === null || o.closedate >= quarter.start))).map((a) => ({ account_id: a.id, name: a.name })),
    };
    if (platform === '6sense') {
      const moved = new Set(data.buyingStages.filter((b) => inRange(b.date, quarter) && b.stage !== 'Target').map((b) => b.account_id));
      entry.engaged_accounts_that_moved_stage = engagedTargets.filter((a) => moved.has(a.id)).length;
    }
    out[program] = entry;
  }
  return out;
}
