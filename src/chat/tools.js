// The chat's tools. Every number the chat can say comes from here; every
// number returned is remembered so the verifier can trace the answer.
import { buildIndex, inRange, channelFor } from '../attribution.js';
import { analyze } from '../analyze.js';
import { influenceByProgram, abaSummary } from '../influence.js';
import { metricsFor, compareMetric, resolvePeriod, METRICS, ALL_CHANNELS } from '../metrics.js';
import { QUARTERS, TODAY, WON } from '../config.js';
import { PROBLEMS } from '../problems.js';

const PERIOD = { type: 'string', description: `A quarter id (${QUARTERS.map((q) => q.id).join(', ')}) or a year ("2025", "2026").` };
const VIEW = { type: 'string', enum: ['reported', 'if_fixes_approved'], description: 'reported = what the CRM shows today (default). if_fixes_approved = after the proposed data fixes.' };
const SEGMENT = { type: 'string', enum: ['all', 'new_logo', 'expansion'] };

export const CHAT_TOOLS = [
  {
    name: 'list_periods',
    description: 'The quarters with data, which one is in progress, and today\'s date. Use it to resolve "this quarter", "last quarter", "this year".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_metrics',
    description: 'All metrics for one period: MQLs, opportunities and pipeline created, deals won and won ARR, deals lost, win rate, average deal size, sales cycle; ' +
      'in total, marketing-sourced, and by channel. Also returns the data problems that affect this period and which channels they touch.',
    input_schema: { type: 'object', properties: { period: PERIOD, view: VIEW, segment: SEGMENT }, required: ['period'] },
  },
  {
    name: 'compare_periods',
    description: 'One metric across several periods (in order), with the change and % change between consecutive periods already computed. Use it for any "better / worse / grew / dropped" question. ' +
      'Optionally for one channel. Also returns the data problems that affect each period.',
    input_schema: {
      type: 'object',
      properties: {
        periods: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
        metric: { type: 'string', enum: [...METRICS, 'marketing_sourced_pipeline'] },
        channel: { type: 'string', enum: ALL_CHANNELS },
        view: VIEW, segment: SEGMENT,
      },
      required: ['periods', 'metric'],
    },
  },
  {
    name: 'get_data_problems',
    description: 'The data sync problems found for a period, in plain words: what is broken, how much pipeline and ARR it affects, which channels it moves, and marketing-sourced pipeline as reported vs. if fixes are approved.',
    input_schema: { type: 'object', properties: { period: PERIOD }, required: ['period'] },
  },
  {
    name: 'get_influence',
    description: 'Influenced opportunities by program (Events, Webinars, Content Syndication, Email, LinkedIn ABA, 6sense ABA) for one quarter: creation, progression, total, influenced pipeline, spend, cost per influenced opportunity; plus ABA account engagement. Influence shows interest, not cause; never add it to sourced numbers.',
    input_schema: { type: 'object', properties: { period: PERIOD }, required: ['period'] },
  },
  {
    name: 'list_accounts_engaged_without_opportunity',
    description: 'Target accounts that engaged with account-based ads (LinkedIn ABA or 6sense) in a quarter but have no open opportunity: a list for sales.',
    input_schema: { type: 'object', properties: { period: PERIOD, program: { type: 'string', enum: ['LinkedIn ABA', '6sense ABA'] } }, required: ['period'] },
  },
  {
    name: 'list_opportunities',
    description: 'Opportunities created or won in a period, optionally for one channel, with amount, stage and channel. Use it when someone asks "which deals".',
    input_schema: {
      type: 'object',
      properties: { period: PERIOD, channel: { type: 'string', enum: ALL_CHANNELS }, which: { type: 'string', enum: ['created', 'won'] }, view: VIEW, limit: { type: 'integer' } },
      required: ['period'],
    },
  },
  {
    name: 'answer',
    description: 'Give your final answer. It is checked before it is shown: every number must come from a tool result, no internal codes, and every channel you mention that a data problem affects in the periods you looked at must have a caveat.',
    input_schema: {
      type: 'object',
      properties: {
        answer: { type: 'string', description: 'The answer in plain words, short: lead with the number, then one or two sentences of context.' },
        caveats: {
          type: 'array',
          description: 'One per affected channel you mention (or per period, if you mention totals or marketing-sourced numbers that a problem affects).',
          items: {
            type: 'object',
            properties: {
              period: { type: 'string' },
              channel: { type: 'string', description: 'The channel, or "all" for totals / marketing-sourced.' },
              note: { type: 'string', description: 'What the problem is and which way it pushes the number, e.g. "likely understated: the Customer Summit never reached the CRM; $246,000 if fixed".' },
            },
            required: ['period', 'channel', 'note'],
          },
        },
      },
      required: ['answer', 'caveats'],
    },
  },
];

export function makeChatTools(data) {
  const idx = buildIndex(data);
  const analyses = new Map();
  const analysisFor = (qid) => {
    if (!analyses.has(qid)) analyses.set(qid, analyze(data, QUARTERS.find((q) => q.id === qid)));
    return analyses.get(qid);
  };
  /** Problems for a period (a year = all its quarters), with affected channels. */
  const problemsFor = (period) => {
    const affected = {};
    const problems = [];
    for (const qid of period.quarters) {
      const a = analysisFor(qid);
      for (const [ch, codes] of Object.entries(a.affected)) for (const c of codes) (affected[ch] ??= new Set()).add(c);
      for (const c of Object.values(a.checks)) {
        if (c.status !== 'issue') continue;
        problems.push({
          quarter: qid, code: c.check, problem: PROBLEMS[c.check].name, what_it_means: PROBLEMS[c.check].what,
          ...(c.check === 'C6' ? { won_deals_affected: c.opportunity_ids.length, won_arr_above_billing: c.overstated_arr }
            : { opportunities: c.opportunity_ids.length, pipeline_affected: c.pipeline_created, won_arr_affected: c.closed_won_arr }),
          ...(c.check === 'C1' ? { campaigns: c.items.map((i) => i.campaign_name) } : {}),
          ...(c.check === 'C3' && c.break ? { since: c.break.start_date } : {}),
        });
      }
    }
    return { problems, affected_channels: Object.fromEntries(Object.entries(affected).map(([ch, s]) => [ch, [...s].sort().map((c) => PROBLEMS[c].name)])), affectedCodes: affected };
  };

  // What the verifier needs: every number seen, and the affected channels of every period looked at.
  const seenNumbers = new Set();
  const looked = new Map(); // period id -> { channel -> Set(codes) }
  const remember = (value) => {
    JSON.stringify(value, (k, v) => {
      if (typeof v === 'number') { seenNumbers.add(v); seenNumbers.add(Math.abs(v)); }
      if (typeof v === 'string' && !/^[A-Z]{1,3}\d+$/.test(v)) for (const m of v.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) seenNumbers.add(Number(m[0].replace(/,/g, '')));
      return v;
    });
    return value;
  };
  const see = (period) => { const p = problemsFor(period); looked.set(period.id, p.affectedCodes); return p; };
  const publicProblems = ({ affectedCodes, problems, ...rest }) => ({ ...rest, problems: problems.map(({ code, ...x }) => x) });

  const handlers = {
    list_periods: () => ({ today: TODAY, quarters: QUARTERS.map((q) => ({ id: q.id, label: q.label, start: q.start, end: q.end, in_progress: !!q.inProgress })), last_complete_quarter: 'Q3-2026', note: 'Q4 2026 is in progress: its numbers are partial and not comparable to full quarters.' }),
    get_metrics: ({ period, view = 'reported', segment = 'all' }) => {
      const p = resolvePeriod(period);
      return { period: p, view, segment, ...metricsFor(data, idx, p, { view, segment }), data_problems: publicProblems(see(p)) };
    },
    compare_periods: ({ periods, metric, channel = null, view = 'reported', segment = 'all' }) => {
      const out = compareMetric(data, idx, periods, metric, { view, segment, channel });
      const problems = Object.fromEntries(periods.map((id) => { const p = see(resolvePeriod(id)); return [id, p.affected_channels]; }));
      return { ...out, affected_channels_by_period: problems, note: channel ? undefined : 'Totals do not change with fixes; channel splits and marketing-sourced numbers do.' };
    },
    get_data_problems: ({ period }) => {
      const p = resolvePeriod(period);
      const res = publicProblems(see(p));
      const ms = (view) => metricsFor(data, idx, p, { view }).marketing_sourced;
      return { period: p, ...res, marketing_sourced: { reported: ms('reported'), if_fixes_approved: ms('if_fixes_approved') } };
    },
    get_influence: ({ period }) => {
      const p = resolvePeriod(period);
      if (p.quarters.length !== 1) throw new Error('Influence is reported per quarter; ask for one quarter at a time.');
      const inf = influenceByProgram(data, idx, p);
      const aba = abaSummary(data, p);
      return {
        period: p, ...inf, programs: inf.programs.map(({ opportunity_ids, ...x }) => x),
        aba: Object.fromEntries(Object.entries(aba).map(([k, v]) => [k, { ...v, engaged_without_opportunity: v.engaged_without_opportunity.length }])),
      };
    },
    list_accounts_engaged_without_opportunity: ({ period, program }) => {
      const p = resolvePeriod(period);
      if (p.quarters.length !== 1) throw new Error('Ask for one quarter at a time.');
      const aba = abaSummary(data, p);
      return { period: p, programs: Object.fromEntries(Object.entries(aba).filter(([k]) => !program || k === program).map(([k, v]) => [k, { count: v.engaged_without_opportunity.length, accounts: v.engaged_without_opportunity.slice(0, 40).map((a) => a.name) }])) };
    },
    list_opportunities: ({ period, channel, which = 'created', view = 'reported', limit = 25 }) => {
      const p = resolvePeriod(period);
      see(p);
      const rows = data.opportunities
        .filter((o) => (which === 'won' ? o.stage === WON && inRange(o.closedate, p) : inRange(o.createdate, p)))
        .map((o) => ({ id: o.id, name: o.name, type: o.type, amount: o.amount, stage: o.stage, created: o.createdate, closed: o.closedate, channel: channelFor(o, idx, view) }))
        .filter((o) => !channel || o.channel === channel)
        .sort((a, b) => b.amount - a.amount);
      return { period: p, which, view, channel: channel ?? 'all', count: rows.length, total_amount: rows.reduce((s, o) => s + o.amount, 0), opportunities: rows.slice(0, Math.min(limit, 50)) };
    },
  };

  return {
    seenNumbers, looked,
    resetTurn() { looked.clear(); },
    call(name, input) {
      const h = handlers[name];
      if (!h) throw new Error(`unknown tool ${name}`);
      return remember(h(input ?? {}));
    },
  };
}
