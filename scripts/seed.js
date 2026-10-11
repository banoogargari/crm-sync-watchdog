// Generates the test scenarios for the CRM Sync Watchdog.
//
// A fake B2B company over five quarters (Q4 2025 – Q4 2026 in progress):
// accounts and contacts, campaigns and members in the MARKETING TOOL and in
// the CRM, website form fills with UTMs and click IDs, account-based ad
// engagement (LinkedIn ABA, 6sense), 6sense buying stages, program spend,
// opportunities with contact roles and stage history, and subscriptions.
//
// Each scenario plants some of the six problems from SPEC.md and writes an
// answer key (ground-truth.json) used by the tests and the eval.
//
//   npm run seed
//
// Everything is seeded, so the output is identical on every run.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeRng } from '../src/lib/rng.js';
import { addDays, daysBetween } from '../src/lib/dates.js';
import {
  TODAY, QUARTERS, REPORT_QUARTER, CAMPAIGN_TYPES, UTM_CHANNEL, CLICK_ID_CHANNEL, SEARCH_REFERRERS,
  NO_SOURCE, NO_ACTIVITY, BUYING_STAGES, OPP_STAGES, WON, LOST, WINDOWS, PROGRAMS,
} from '../src/config.js';

const OUT_DIR = new URL('../evals/scenarios/', import.meta.url).pathname;
const BASE_SEED = 20261011;
const HISTORY_START = '2025-07-01'; // a quarter of history so lookbacks work for Q4 2025

// Quarters opportunities are created in (Q3 2025 is history only, so Q4 2025 can have expansions).
const OPP_QUARTERS = [
  { start: '2025-07-01', end: '2025-09-30', n: 40 },
  { start: '2025-10-01', end: '2025-12-31', n: 48 },
  { start: '2026-01-01', end: '2026-03-31', n: 52 },
  { start: '2026-04-01', end: '2026-06-30', n: 56 },
  { start: '2026-07-01', end: '2026-09-30', n: 72 },
  { start: '2026-10-01', end: TODAY, n: 8 },
];
// Channel mix for marketing-sourced opportunities, per quarter index (LinkedIn grows, webinars fade).
const channelWeights = (qi) => [
  ['Events', 12], ['Webinars', 15 - 2 * qi], ['Content Syndication', 10], ['Email', 8],
  ['LinkedIn', 12 + 3 * qi], ['Paid Search', 18], ['6sense', 8 + qi], ['Organic', 12],
];
const FORM_CHANNELS = ['LinkedIn', 'Paid Search', '6sense', 'Email', 'Organic'];
const NEW_LOGO_AMOUNTS = [12000, 18000, 24000, 30000, 36000, 48000, 60000];
const EXPANSION_AMOUNTS = [6000, 9600, 12000, 18000];

const FIRST = ['Ava', 'Ben', 'Chloe', 'Daniel', 'Elena', 'Farid', 'Grace', 'Hiro', 'Isla', 'Jonah', 'Kira', 'Leo',
  'Maya', 'Nikhil', 'Olivia', 'Pedro', 'Quinn', 'Rosa', 'Sam', 'Tara', 'Umar', 'Vera', 'Wes', 'Ximena', 'Yusuf',
  'Zoe', 'Arash', 'Bianca', 'Chen', 'Dara', 'Emre', 'Fatima', 'Gabriel', 'Hana', 'Ivan', 'Jade'];
const LAST = ['Adams', 'Brooks', 'Chen', 'Diaz', 'Evans', 'Fischer', 'Garcia', 'Hassan', 'Ito', 'Johnson', 'Khan',
  'Lopez', 'Moreau', 'Nguyen', 'Okafor', 'Patel', 'Quint', 'Rossi', 'Silva', 'Tanaka', 'Usman', 'Varga', 'Weber',
  'Xu', 'Young', 'Zimmer', 'Rahimi', 'Kowalski', 'Novak', 'Berg', 'Larsen', 'Mehta'];
const CO_A = ['Blue', 'North', 'Bright', 'Iron', 'Cedar', 'Silver', 'Quantum', 'Harbor', 'Summit', 'Pixel', 'Atlas',
  'Nimbus', 'Coral', 'Granite', 'Echo', 'Lumen', 'Orbit', 'Prairie', 'Vector', 'Willow'];
const CO_B = ['Labs', 'Systems', 'Analytics', 'Health', 'Logistics', 'Robotics', 'Learning', 'Finance', 'Cloud',
  'Media', 'Foods', 'Energy', 'Works', 'Bio', 'Retail'];

const PROGRAM_OF_TYPE = { event: 'Events', webinar: 'Webinars', content_syndication: 'Content Syndication', email: 'Email' };
const ABA_CHANNEL = { linkedin_aba: 'LinkedIn', '6sense': '6sense' }; // ABA platform -> sourced channel it hints at
const ABA_PROGRAM = { linkedin_aba: 'LinkedIn ABA', '6sense': '6sense ABA' };

// ---------------------------------------------------------------------------
// Base data: a realistic company with no planted problems.
// ---------------------------------------------------------------------------
function buildBase() {
  const rng = makeRng(BASE_SEED);
  const randomDate = (a, b) => addDays(a, rng.int(0, Math.max(0, daysBetween(a, b))));
  const minDate = (a, b) => (a < b ? a : b);
  const maxDate = (a, b) => (a > b ? a : b);
  const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[rng.int(0, 15)]).join('');

  // --- accounts -------------------------------------------------------------
  const accounts = [];
  let aId = 1000;
  for (const a of rng.shuffle(CO_A)) for (const b of rng.shuffle(CO_B)) {
    const r = rng.next();
    accounts.push({
      id: `A${++aId}`, name: `${a} ${b}`, domain: `${a}${b}.com`.toLowerCase(),
      aba_targets: [...(r < 0.45 ? ['linkedin_aba'] : []), ...(r > 0.25 && r < 0.65 ? ['6sense'] : [])],
    });
  }
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  // --- campaigns (marketing tool) and their CRM twins -------------------------
  const mapCampaigns = [];
  const crmCampaigns = [];
  let mcId = 100;
  const addCampaign = (name, type, start, end) => {
    const id = ++mcId;
    const c = { id: `MC${id}`, name, type, channel: CAMPAIGN_TYPES[type].channel, start_date: start, end_date: end, crm_campaign_id: `CC${id}` };
    mapCampaigns.push(c);
    crmCampaigns.push({ id: `CC${id}`, name, type, channel: c.channel });
    return c;
  };
  const allQuarters = [{ label: 'Q3 2025', start: '2025-07-01', end: '2025-09-30' }, ...QUARTERS];
  for (const q of allQuarters) {
    const end = minDate(q.end, TODAY);
    const name = q.label.replace(' (in progress)', '');
    const d1 = randomDate(addDays(q.start, 20), addDays(q.start, 70));
    if (d1 <= TODAY) addCampaign(`${name} Regional Roadshow`, 'event', d1, d1);
    for (const [k, off] of [[1, 10], [2, 50]]) {
      const d = randomDate(addDays(q.start, off), addDays(q.start, off + 25));
      if (d <= TODAY) addCampaign(`${name} Webinar ${k}`, 'webinar', d, d);
    }
    addCampaign(`${name} Content Syndication`, 'content_syndication', q.start, end);
    addCampaign(`${name} Email Nurture`, 'email', q.start, end);
  }
  const webForm = addCampaign('Website – Contact Sales', 'web_form', HISTORY_START, TODAY);

  // --- people and activities -----------------------------------------------
  const contacts = [];
  const activities = []; // one record per campaign member; exported to both systems
  const usedEmails = new Set();
  let cId = 1000, actId = 0;
  const newContact = (account, createdate) => {
    let first, last, email;
    do {
      first = rng.pick(FIRST); last = rng.pick(LAST);
      email = `${first}.${last}@${account.domain}`.toLowerCase();
    } while (usedEmails.has(email));
    usedEmails.add(email);
    const c = { id: `C${++cId}`, account_id: account.id, email, firstname: first, lastname: last, createdate, mql_date: null };
    contacts.push(c);
    return c;
  };
  const formFields = (channel) => {
    switch (channel) {
      case 'LinkedIn': return { utm_source: 'linkedin', utm_medium: 'paid_social', utm_campaign: 'li_demand', referrer: 'https://www.linkedin.com/', landing_page: '/lp/demo', gclid: null, li_fat_id: hex(12) };
      case 'Paid Search': return { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'search_brand', referrer: 'https://www.google.com/', landing_page: '/lp/demo', gclid: `Cj0${hex(14)}`, li_fat_id: null };
      case '6sense': return { utm_source: '6sense', utm_medium: 'display', utm_campaign: '6s_target', referrer: null, landing_page: '/lp/abm', gclid: null, li_fat_id: null };
      case 'Email': return { utm_source: 'email', utm_medium: 'email', utm_campaign: 'nurture', referrer: null, landing_page: '/pricing', gclid: null, li_fat_id: null };
      case 'Organic': return { utm_source: null, utm_medium: null, utm_campaign: null, referrer: rng.pick(SEARCH_REFERRERS), landing_page: rng.pick(['/', '/blog/attribution-guide', '/product']), gclid: null, li_fat_id: null };
      default: return { utm_source: null, utm_medium: null, utm_campaign: null, referrer: null, landing_page: '/', gclid: null, li_fat_id: null }; // direct
    }
  };
  const addActivity = (contact, campaign, date, { success = true, channel } = {}) => {
    const t = CAMPAIGN_TYPES[campaign.type];
    const status = success ? rng.pick(t.success) : rng.pick(t.other.length ? t.other : t.success);
    const a = { id: ++actId, map_campaign_id: campaign.id, contact_id: contact.id, email: contact.email, date, status, is_success: success, crm_status: status, crm_is_success: success };
    if (campaign.type === 'web_form') Object.assign(a, formFields(channel));
    activities.push(a);
    if (campaign.type === 'web_form' && success && (!contact.mql_date || date < contact.mql_date)) contact.mql_date = date;
    return a;
  };
  // Find a campaign of a type that ran between two dates; returns { campaign, date } or null.
  const pointTypes = new Set(['event', 'webinar']);
  const campaignBetween = (type, from, to) => {
    if (type === 'web_form') return { campaign: webForm, date: randomDate(from, to) };
    const options = mapCampaigns.filter((c) => c.type === type && c.end_date >= from && c.start_date <= to && c.crm_campaign_id);
    if (!options.length) return null;
    const c = pointTypes.has(type) ? options.sort((x, y) => y.start_date.localeCompare(x.start_date))[0] : rng.pick(options);
    return { campaign: c, date: pointTypes.has(type) ? c.start_date : randomDate(maxDate(from, c.start_date), minDate(to, c.end_date)) };
  };
  const TYPE_OF_CHANNEL = { Events: 'event', Webinars: 'webinar', 'Content Syndication': 'content_syndication', Email: 'email' };
  // Add a successful activity of a channel between two dates (falls back to a form fill).
  const addChannelActivity = (contact, channel, from, to) => {
    const type = TYPE_OF_CHANNEL[channel] ?? 'web_form';
    const found = campaignBetween(type, from, to);
    if (!found) return addActivity(contact, webForm, randomDate(from, to), { channel: rng.pick(FORM_CHANNELS) });
    return addActivity(contact, found.campaign, found.date, { channel });
  };

  // --- opportunities ----------------------------------------------------------
  const opportunities = [];
  const stageHistory = [];
  const subscriptions = [];
  const trueChannel = {}; // opp id -> channel
  const customers = new Set();
  const busy = new Set(); // accounts with an open opportunity
  let oId = 5000, sId = 9000;

  OPP_QUARTERS.forEach((q, qi) => {
    for (let k = 0; k < q.n; k++) {
      const createdate = randomDate(q.start, q.end);
      const expansionPool = [...customers].filter((id) => !busy.has(id));
      const expansion = expansionPool.length > 3 && rng.next() < 0.25;
      const account = expansion
        ? accountById.get(rng.pick(expansionPool))
        : rng.pick(accounts.filter((a) => !customers.has(a.id) && !busy.has(a.id)));
      const existing = contacts.filter((c) => c.account_id === account.id);
      const contact = expansion && existing.length ? rng.pick(existing) : newContact(account, addDays(createdate, -rng.int(20, 120)));
      if (contact.createdate > createdate) contact.createdate = addDays(createdate, -rng.int(20, 120));

      // Marketing-sourced: the last activity before creation sets the channel.
      const opp = {
        id: `O${++oId}`, account_id: account.id, name: `${account.name} — ${expansion ? 'Expansion' : 'New business'}`,
        type: expansion ? 'expansion' : 'new_logo', amount: rng.pick(expansion ? EXPANSION_AMOUNTS : NEW_LOGO_AMOUNTS),
        stage: null, createdate, closedate: null, contact_roles: [{ contact_id: contact.id, role: 'Decision Maker', is_primary: true }],
      };
      let last = null;
      if (rng.next() < 0.75) {
        const ch = rng.weighted(channelWeights(Math.min(qi, 4)));
        const window = FORM_CHANNELS.includes(ch) ? [addDays(createdate, -20), addDays(createdate, -1)] : [addDays(createdate, -60), addDays(createdate, -1)];
        last = addChannelActivity(contact, ch, maxDate(window[0], contact.createdate), window[1]);
        // 0–2 earlier activities, strictly before the last one
        for (let e = rng.int(0, 2); e > 0; e--) {
          const to = addDays(last.date, -3);
          if (to <= contact.createdate) break;
          addChannelActivity(contact, rng.weighted(channelWeights(Math.min(qi, 4))), maxDate(contact.createdate, addDays(to, -90)), to);
        }
        // Make sure the chosen activity is the last one (an earlier "before" pick can't be later).
        const lastOfContact = activities.filter((a) => a.contact_id === contact.id && a.is_success && a.date <= createdate)
          .sort((x, y) => x.date.localeCompare(y.date) || x.id - y.id).at(-1);
        last = lastOfContact;
      } else {
        // Sales-sourced: make sure this contact has no marketing activity before the opportunity.
        const prior = activities.filter((a) => a.contact_id === contact.id && a.date <= createdate);
        if (prior.length) { last = prior.sort((x, y) => x.date.localeCompare(y.date) || x.id - y.id).at(-1); }
      }
      for (const a of activities) if (a.contact_id === contact.id && a.date < contact.createdate) contact.createdate = a.date;

      // Stage path and outcome.
      const cycle = rng.int(25, 110);
      const close = addDays(createdate, cycle);
      const path = [['Discovery', createdate]];
      OPP_STAGES.slice(1).forEach((st, i) => path.push([st, addDays(createdate, Math.round(cycle * (i + 1) / 4))]));
      let entries;
      if (close > TODAY) {
        entries = path.filter(([, d]) => d <= TODAY);
        opp.stage = entries.at(-1)[0];
        busy.add(account.id);
      } else if (rng.next() < 0.56) {
        entries = [...path, [WON, close]];
        opp.stage = WON; opp.closedate = close;
        customers.add(account.id);
      } else {
        entries = [...path.slice(0, rng.int(1, 4)), [LOST, close]];
        opp.stage = LOST; opp.closedate = close;
      }
      entries.forEach(([stage, date]) => stageHistory.push({ opportunity_id: opp.id, stage, date }));

      // Marketing keeps engaging while the deal is open (influenced progression).
      const moves = entries.slice(1).filter(([st]) => st !== LOST);
      if (moves.length && rng.next() < 0.4) {
        const [, moveDate] = rng.pick(moves);
        const from = maxDate(addDays(createdate, 1), addDays(moveDate, -25));
        const to = addDays(moveDate, -3);
        if (from <= to) addChannelActivity(contact, rng.pick(['Webinars', 'Events', 'Email', 'Content Syndication']), from, to);
      }

      opportunities.push(opp);
      if (opp.stage === WON) {
        const monthly = rng.next() < 0.5;
        subscriptions.push({
          id: `SUB-${++sId}`, account_id: account.id,
          customer_email: rng.next() < 0.8 ? contact.email : `billing@${account.domain}`,
          amount: monthly ? opp.amount / 12 : opp.amount, interval: monthly ? 'month' : 'year',
          status: 'active', start_date: addDays(close, rng.int(0, 5)), opportunity_type: opp.type,
        });
      }
    }
    // Free accounts whose deals closed by the end of this quarter.
    for (const o of opportunities) if (o.closedate && o.closedate <= q.end) busy.delete(o.account_id);
  });


  // --- leads: people who engage but don't become opportunities ----------------
  for (const account of accounts) {
    for (let k = rng.int(0, 3); k > 0; k--) {
      const created = randomDate(HISTORY_START, TODAY);
      const c = newContact(account, created);
      for (let n = rng.int(1, 3); n > 0; n--) {
        const from = c.createdate;
        const to = minDate(addDays(from, 90), TODAY);
        const r = rng.next();
        if (r < 0.45) {
          // a form fill; ~3% of them are direct visits with no clues at all
          addActivity(c, webForm, randomDate(from, to), { channel: rng.next() < 0.03 ? 'Direct' : rng.pick(FORM_CHANNELS) });
        } else {
          const ch = rng.pick(['Events', 'Webinars', 'Content Syndication', 'Email']);
          const found = campaignBetween(TYPE_OF_CHANNEL[ch], from, to);
          if (found) addActivity(c, found.campaign, found.date, { success: rng.next() < 0.7 });
        }
      }
    }
  }

  // --- account-based advertising ---------------------------------------------
  // Weekly rows, only for weeks with clicks or asset views (impressions-only
  // weeks are reach, not engagement, and are left out to keep files small).
  const aba = [];
  const oppDates = new Map(); // account -> [ [createdate, closedate or TODAY] ]
  for (const o of opportunities) {
    if (!oppDates.has(o.account_id)) oppDates.set(o.account_id, []);
    oppDates.get(o.account_id).push([o.createdate, o.closedate ?? TODAY]);
  }
  const weeks = [];
  for (let d = '2025-06-30'; d <= TODAY; d = addDays(d, 7)) weeks.push(d);
  for (const account of accounts) {
    for (const platform of account.aba_targets) {
      for (const week of weeks) {
        const hot = (oppDates.get(account.id) ?? []).some(([c, e]) => (week >= addDays(c, -90) && week <= c) || (week > c && week <= e));
        const p = hot ? 0.1 : 0.025;
        if (rng.next() >= p) continue;
        aba.push({
          account_id: account.id, platform, campaign: ABA_PROGRAM[platform], week_start: week,
          impressions: rng.int(80, 600), clicks: rng.int(1, 5),
          asset_views: platform === 'linkedin_aba' && rng.next() < 0.4 ? rng.int(1, 3) : 0,
        });
      }
    }
  }

  // --- 6sense buying stages ---------------------------------------------------
  const buyingStages = [];
  for (const account of accounts.filter((a) => a.aba_targets.includes('6sense'))) {
    let s = 0;
    buyingStages.push({ account_id: account.id, date: HISTORY_START, stage: BUYING_STAGES[0] });
    for (let m = '2025-08-01'; m <= TODAY; m = addDays(m, 30)) {
      const engaged = aba.some((r) => r.account_id === account.id && r.platform === '6sense' && r.week_start >= addDays(m, -30) && r.week_start <= m);
      if (s < BUYING_STAGES.length - 2 && rng.next() < (engaged ? 0.3 : 0.05)) {
        s += 1;
        buyingStages.push({ account_id: account.id, date: m, stage: BUYING_STAGES[s] });
      }
    }
    const won = opportunities.find((o) => o.account_id === account.id && o.stage === WON && o.type === 'new_logo');
    if (won) buyingStages.push({ account_id: account.id, date: won.closedate, stage: 'Purchase' });
  }

  // --- program spend ----------------------------------------------------------
  const spend = [];
  const monthly = { Events: 0, Webinars: 3000, 'Content Syndication': 6000, Email: 1000, 'LinkedIn ABA': 9000, '6sense ABA': 10000 };
  const months = [];
  for (let y = 2025, mo = 7; `${y}-${String(mo).padStart(2, '0')}` <= TODAY.slice(0, 7); mo === 12 ? (y += 1, mo = 1) : (mo += 1)) months.push(`${y}-${String(mo).padStart(2, '0')}`);
  for (const m of months) {
    for (const program of PROGRAMS) {
      let amount = monthly[program];
      if (program === 'Events') amount = mapCampaigns.filter((c) => c.type === 'event' && c.start_date.slice(0, 7) === m).length * 18000;
      if (amount) spend.push({ program, month: m, spend: Math.round(amount * (0.85 + rng.next() * 0.3) / 100) * 100 });
    }
  }

  // True channel of each opportunity: the last successful activity of its
  // primary contact before creation, in the complete marketing-tool view.
  const campById = new Map(mapCampaigns.map((c) => [c.id, c]));
  for (const o of opportunities) {
    const c = o.contact_roles[0].contact_id;
    const last = activities.filter((a) => a.contact_id === c && a.is_success && a.date <= o.createdate)
      .sort((x, y) => x.date.localeCompare(y.date) || x.id - y.id).at(-1);
    trueChannel[o.id] = channelOfActivity(last, campById);
  }

  return { accounts, contacts, mapCampaigns, crmCampaigns, activities, aba, buyingStages, spend, opportunities, stageHistory, subscriptions, trueChannel, webForm };
}

// Channel of one activity (shared rule, documented in SPEC section 4 and 5).
export function channelOfActivity(a, campById) {
  if (!a) return NO_ACTIVITY;
  const c = campById.get(a.map_campaign_id);
  if (c.type !== 'web_form') return c.channel;
  if (a.utm_source) return UTM_CHANNEL[a.utm_source] ?? NO_SOURCE;
  if (!a.gclid && !a.li_fat_id && SEARCH_REFERRERS.includes(a.referrer)) return 'Organic';
  return NO_SOURCE;
}

// ---------------------------------------------------------------------------
// Planting problems
// ---------------------------------------------------------------------------
function plant(base, cfg, seed) {
  const rng = makeRng(seed);
  const d = structuredClone(base);
  const { contacts, activities, opportunities, mapCampaigns, subscriptions, aba, trueChannel } = d;
  const truth = {};
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const accountById = new Map(d.accounts.map((a) => [a.id, a]));
  const usedOpps = new Set();
  const overrides = {}; // opp id -> channel in the "if fixes are approved" view when not the true channel
  let actId = Math.max(...activities.map((a) => a.id));
  let cId = 9000;
  const Q = REPORT_QUARTER;
  const inQ = (date) => date && date >= Q.start && date <= Q.end;
  const sum = (os) => os.reduce((s, o) => s + o.amount, 0);
  const primary = (o) => o.contact_roles.find((r) => r.is_primary)?.contact_id ?? null;
  const lastActivityOf = (contactId, before) => activities
    .filter((a) => a.contact_id === contactId && a.is_success && a.date <= before)
    .sort((x, y) => x.date.localeCompare(y.date) || x.id - y.id).at(-1);
  // Each problem takes its own opportunities (created in the report quarter
  // unless a scope says otherwise), so problems don't overlap.
  // People on more than one opportunity (e.g. a first deal and a later
  // expansion) are left alone, so a planted problem affects only its own deal.
  const roleCount = new Map();
  for (const o of opportunities) for (const r of o.contact_roles) roleCount.set(r.contact_id, (roleCount.get(r.contact_id) ?? 0) + 1);
  const oppContacts = new Set(roleCount.keys());
  const take = (n, pred, scope = (o) => inQ(o.createdate)) => {
    const pool = rng.shuffle(opportunities.filter((o) => scope(o) && !usedOpps.has(o.id) && o.contact_roles.length
      && roleCount.get(primary(o)) === 1 && pred(o)));
    if (pool.length < n) throw new Error(`not enough opportunities (${pool.length} < ${n})`);
    const picked = pool.slice(0, n);
    picked.forEach((o) => usedOpps.add(o.id));
    return picked;
  };
  const addAct = (fields) => { const a = { id: ++actId, crm_status: fields.status, crm_is_success: fields.is_success, ...fields }; activities.push(a); return a; };
  const impact = (os) => ({
    opportunity_ids: os.map((o) => o.id),
    pipeline_created: sum(os.filter((o) => inQ(o.createdate))),
    closed_won_arr: sum(os.filter((o) => o.stage === WON && inQ(o.closedate))),
  });

  // C1 — a campaign built in the marketing tool never synced to the CRM.
  if (cfg.unsynced) {
    const date = cfg.unsynced.date;
    const camp = { id: 'MC900', name: `Q3 2026 Customer Summit`, type: 'event', channel: 'Events', start_date: date, end_date: date, crm_campaign_id: null };
    mapCampaigns.push(camp);
    const os = take(cfg.unsynced.opps, (o) => o.createdate > addDays(date, 2) && o.createdate <= addDays(date, 45)
      && (lastActivityOf(primary(o), o.createdate)?.date ?? '') < date);
    for (const o of os) {
      const c = contactById.get(primary(o));
      if (c.createdate > date) c.createdate = date;
      addAct({ map_campaign_id: camp.id, contact_id: c.id, email: c.email, date, status: 'Attended', is_success: true });
      trueChannel[o.id] = 'Events';
    }
    // Plus attendees who didn't become opportunities.
    for (const c of rng.shuffle(contacts.filter((x) => x.createdate <= date && !oppContacts.has(x.id))).slice(0, cfg.unsynced.attendees)) {
      addAct({ map_campaign_id: camp.id, contact_id: c.id, email: c.email, date, status: rng.next() < 0.7 ? 'Attended' : 'Registered', is_success: true });
    }
    activities.filter((a) => a.map_campaign_id === camp.id && a.status === 'Registered').forEach((a) => { a.is_success = false; a.crm_is_success = false; });
    truth.C1 = { campaign_id: camp.id, campaign_name: camp.name, members: activities.filter((a) => a.map_campaign_id === camp.id).length, ...impact(os) };
  }

  // C2 — "Attended" in the marketing tool, still "Registered" in the CRM.
  if (cfg.status) {
    const os = take(cfg.status.opps, (o) => {
      const a = lastActivityOf(primary(o), o.createdate);
      return a && ['event', 'webinar'].includes(mapCampaigns.find((c) => c.id === a.map_campaign_id).type);
    });
    const members = [];
    for (const o of os) {
      const a = lastActivityOf(primary(o), o.createdate);
      a.crm_status = 'Registered'; a.crm_is_success = false;
      members.push({ activity_id: a.id, opportunity_id: o.id, map_status: a.status, crm_status: a.crm_status });
    }
    truth.C2 = { members, ...impact(os) };
  }

  // C3 — from a date, the contact-sales form drops UTMs.
  if (cfg.utm) {
    const start = cfg.utm.startDate;
    const items = [];
    const os = take(cfg.utm.cases.length, (o) => o.createdate >= addDays(start, 6) && (lastActivityOf(primary(o), o.createdate)?.date ?? '') < addDays(o.createdate, -2));
    os.forEach((o, i) => {
      const kase = cfg.utm.cases[i];
      const c = contactById.get(primary(o));
      const prev = lastActivityOf(c.id, o.createdate)?.date ?? start;
      const from = prev >= start ? addDays(prev, 1) : start;
      const date = addDays(from, rng.int(0, Math.max(0, daysBetween(from, addDays(o.createdate, -1)))));
      const ch = kase.channel;
      const clues = {
        'Paid Search': { referrer: 'https://www.google.com/', landing_page: '/lp/demo', gclid: `Cj0${rng.int(1e8, 9e8)}`, li_fat_id: null },
        LinkedIn: { referrer: 'https://www.linkedin.com/', landing_page: '/lp/demo', gclid: null, li_fat_id: `${rng.int(1e8, 9e8)}` },
        '6sense': { referrer: null, landing_page: '/lp/abm', gclid: null, li_fat_id: null },
      }[ch];
      addAct({ map_campaign_id: d.webForm.id, contact_id: c.id, email: c.email, date, status: 'Submitted', is_success: true, utm_source: null, utm_medium: null, utm_campaign: null, ...clues });
      if (!c.mql_date || date < c.mql_date) c.mql_date = date;
      trueChannel[o.id] = ch;
      // Account-based ad clicks before the form fill, for the ABM hint.
      const account = accountById.get(o.account_id);
      if (kase.abaClicks) {
        const platform = kase.abaClicks;
        if (!account.aba_targets.includes(platform)) account.aba_targets.push(platform);
        const week = addDays(date, -rng.int(2, 9));
        aba.push({ account_id: account.id, platform, campaign: ABA_PROGRAM[platform], week_start: week, impressions: rng.int(200, 600), clicks: rng.int(3, 6), asset_views: 0 });
      } else {
        // make sure no ABA engagement in the hint window
        for (let i2 = aba.length - 1; i2 >= 0; i2--) {
          const r = aba[i2];
          if (r.account_id === account.id && r.week_start >= addDays(date, -WINDOWS.abmHintDays - 7) && r.week_start <= date) aba.splice(i2, 1);
        }
      }
      const group = ch === '6sense' ? (kase.abaClicks ? 'likely_abm' : 'unknown') : 'dropped_paid_click';
      const hint = kase.abaClicks ? ABA_CHANNEL[kase.abaClicks] : null;
      if (group === 'dropped_paid_click') overrides[o.id] = CLICK_ID_CHANNEL[clues.gclid ? 'gclid' : 'li_fat_id'];
      else overrides[o.id] = NO_SOURCE;
      items.push({ opportunity_id: o.id, form_fill_date: date, group, true_channel: ch, abm_hint: hint, hint_correct: hint ? hint === ch : null });
    });
    // Other form fills after the break lose their UTM too (leads), keeping click IDs.
    const dropped = items.map((x) => x.form_fill_date);
    for (const a of activities) {
      if (a.map_campaign_id !== d.webForm.id || a.date < start || !a.utm_source || oppContacts.has(a.contact_id)) continue;
      if (rng.next() < cfg.utm.rate) { a.utm_source = null; a.utm_medium = null; a.utm_campaign = null; dropped.push(a.date); }
    }
    truth.C3 = { start_date: dropped.sort()[0], form_fills_that_lost_utm: dropped.length, cases: items, ...impact(os) };
  }

  // C4 — duplicate contacts: the opportunity sits on a copy with no activities.
  if (cfg.duplicates) {
    const pairs = [];
    const os = take(cfg.duplicates.opps, (o) => !!lastActivityOf(primary(o), o.createdate));
    os.forEach((o, i) => {
      const orig = contactById.get(primary(o));
      const [local, domain] = orig.email.split('@');
      const email = i % 2 ? `${local}+sales@${domain}` : `${local.replace(/(^|\.)([a-z])/g, (m) => m.toUpperCase())}@${domain}`;
      const dup = { ...orig, id: `C${++cId}`, email, createdate: addDays(o.createdate, -rng.int(1, 4)), mql_date: null };
      contacts.push(dup);
      o.contact_roles = [{ contact_id: dup.id, role: 'Decision Maker', is_primary: true }];
      pairs.push({ keep: orig.id, duplicate: dup.id, opportunity_id: o.id, channel: trueChannel[o.id] });
    });
    truth.C4 = { pairs, ...impact(os) };
  }

  // C5 — opportunities created with no contact role.
  if (cfg.noContact) {
    const os = take(cfg.noContact.opps, () => true);
    const items = os.map((o) => { const c = primary(o); o.contact_roles = []; overrides[o.id] = NO_ACTIVITY; return { opportunity_id: o.id, true_contact_id: c }; });
    truth.C5 = { opportunities: items, ...impact(os) };
  }

  // C6 — opportunity amount differs from the subscription (billing is correct).
  if (cfg.billing) {
    const subOf = (o) => subscriptions.find((s) => s.account_id === o.account_id && s.opportunity_type === o.type && s.start_date >= o.closedate && s.start_date <= addDays(o.closedate, 5));
    const won = (o) => o.stage === WON && inQ(o.closedate) && subOf(o);
    const wonScope = (o) => o.stage === WON && inQ(o.closedate);
    const mism = take(cfg.billing.mismatches, (o) => won(o) && o.amount >= 12000, wonScope);
    const items = mism.map((o) => {
      const s = subOf(o);
      const delta = cfg.billing.delta ?? rng.pick([1200, 2400, 3600, 6000]);
      const billed = o.amount - delta;
      s.amount = s.interval === 'month' ? billed / 12 : billed;
      return { opportunity_id: o.id, opportunity_amount: o.amount, billed_arr: billed, difference: delta };
    });
    const unbilled = take(cfg.billing.unbilled, won, wonScope).map((o) => { subscriptions.splice(subscriptions.indexOf(subOf(o)), 1); return o.id; });
    truth.C6 = {
      mismatches: items, won_without_subscription: unbilled,
      overstated_arr: items.reduce((s, x) => s + x.difference, 0),
      opportunity_ids: [...mism.map((o) => o.id), ...unbilled],
    };
  }

  // ---- answer key for the report ------------------------------------------------
  const campById = new Map(mapCampaigns.map((c) => [c.id, c]));
  const crmSuccess = activities.filter((a) => campById.get(a.map_campaign_id).crm_campaign_id && a.crm_is_success);
  const crmByContact = new Map();
  for (const a of crmSuccess) {
    if (!crmByContact.has(a.contact_id)) crmByContact.set(a.contact_id, []);
    crmByContact.get(a.contact_id).push(a);
  }
  const reported = (o) => {
    const c = primary(o);
    if (!c) return NO_ACTIVITY;
    const last = (crmByContact.get(c) ?? []).filter((a) => a.date <= o.createdate).sort((x, y) => x.date.localeCompare(y.date) || x.id - y.id).at(-1);
    return channelOfActivity(last, campById);
  };
  const ifFixed = (o) => overrides[o.id] ?? trueChannel[o.id];
  const table = (filter, amountOf, chOf) => {
    const out = {};
    for (const o of opportunities.filter(filter)) {
      const k = `${chOf(o)}|${o.type}`;
      out[k] = (out[k] ?? 0) + amountOf(o);
    }
    return Object.fromEntries(Object.entries(out).sort());
  };
  const createdInQ = (o) => inQ(o.createdate);
  const wonInQ = (o) => o.stage === WON && inQ(o.closedate);
  truth.report = {
    quarter: Q.id,
    pipeline_created: { reported: table(createdInQ, (o) => o.amount, reported), if_fixes_approved: table(createdInQ, (o) => o.amount, ifFixed) },
    closed_won_arr: { reported: table(wonInQ, (o) => o.amount, reported), if_fixes_approved: table(wonInQ, (o) => o.amount, ifFixed) },
    totals: { pipeline_created: sum(opportunities.filter(createdInQ)), closed_won_arr: sum(opportunities.filter(wonInQ)) },
  };

  // ---- answer key for influence (as reported: CRM members + ad platform data) ----
  const history = new Map();
  for (const h of d.stageHistory) { if (!history.has(h.opportunity_id)) history.set(h.opportunity_id, []); history.get(h.opportunity_id).push(h); }
  const engagementDates = (o, program) => {
    if (program.endsWith('ABA')) {
      const platform = program === 'LinkedIn ABA' ? 'linkedin_aba' : '6sense';
      return aba.filter((r) => r.account_id === o.account_id && r.platform === platform && (r.clicks + r.asset_views) > 0).map((r) => r.week_start);
    }
    const ids = new Set(o.contact_roles.map((r) => r.contact_id));
    return crmSuccess.filter((a) => ids.has(a.contact_id) && PROGRAM_OF_TYPE[campById.get(a.map_campaign_id).type] === program).map((a) => a.date);
  };
  const influence = {};
  for (const program of PROGRAMS) {
    const creation = [], progression = [];
    for (const o of opportunities) {
      const dates = engagementDates(o, program);
      if (!dates.length) continue;
      if (inQ(o.createdate) && dates.some((x) => x >= addDays(o.createdate, -WINDOWS.influenceCreationDays) && x <= o.createdate)) creation.push(o.id);
      const moves = (history.get(o.id) ?? []).slice(1).filter((h) => h.stage !== LOST && inQ(h.date));
      if (moves.some((m) => dates.some((x) => x > o.createdate && x < m.date && x >= addDays(m.date, -WINDOWS.influenceProgressionDays)))) progression.push(o.id);
    }
    const total = [...new Set([...creation, ...progression])].sort();
    influence[program] = { creation: creation.sort(), progression: progression.sort(), total, pipeline: sum(opportunities.filter((o) => total.includes(o.id))) };
  }
  truth.influence = { quarter: Q.id, programs: influence };

  // ---- output files ---------------------------------------------------------------
  const crmIds = new Set(mapCampaigns.map((c) => c.crm_campaign_id).filter(Boolean));
  const form = (a) => (a.map_campaign_id === d.webForm.id
    ? { utm_source: a.utm_source, utm_medium: a.utm_medium, utm_campaign: a.utm_campaign, referrer: a.referrer, landing_page: a.landing_page, gclid: a.gclid, li_fat_id: a.li_fat_id }
    : {});
  const files = {
    'accounts.json': d.accounts,
    'contacts.json': contacts,
    'map_campaigns.json': mapCampaigns,
    'map_members.json': activities.map((a) => ({ id: `MM${a.id}`, campaign_id: a.map_campaign_id, email: a.email, status: a.status, is_success: a.is_success, activity_date: a.date, ...form(a) })),
    'crm_campaigns.json': d.crmCampaigns.filter((c) => crmIds.has(c.id)),
    'crm_members.json': activities.filter((a) => campById.get(a.map_campaign_id).crm_campaign_id)
      .map((a) => ({ id: `CM${a.id}`, campaign_id: campById.get(a.map_campaign_id).crm_campaign_id, contact_id: a.contact_id, status: a.crm_status, is_success: a.crm_is_success, activity_date: a.date, ...form(a) })),
    'aba_engagement.json': aba.sort((x, y) => x.week_start.localeCompare(y.week_start) || x.account_id.localeCompare(y.account_id)),
    'buying_stages.json': d.buyingStages,
    'program_spend.json': d.spend,
    'opportunities.json': opportunities,
    'opportunity_stage_history.json': d.stageHistory,
    'subscriptions.json': subscriptions.map(({ opportunity_type, ...s }) => s),
  };
  return { files, truth };
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
const C3_CASES = [
  { channel: 'Paid Search' }, { channel: 'LinkedIn' }, { channel: 'Paid Search' },
  { channel: '6sense', abaClicks: '6sense' }, { channel: '6sense', abaClicks: '6sense' },
  { channel: '6sense', abaClicks: 'linkedin_aba' }, // the hint will point to the wrong channel
  { channel: '6sense' }, // no clues at all
];
const ALL = {
  unsynced: { date: '2026-08-06', opps: 5, attendees: 30 },
  status: { opps: 4 },
  utm: { startDate: '2026-08-14', rate: 0.4, cases: C3_CASES },
  duplicates: { opps: 4 },
  noContact: { opps: 3 },
  billing: { mismatches: 3, unbilled: 1 },
};
const SCENARIOS = {
  clean: { description: 'No planted problems. Tests for false alarms.', cfg: {} },
  'unsynced-campaign': { description: 'The Q3 Customer Summit was built in the marketing tool but never synced to the CRM.', cfg: { unsynced: ALL.unsynced } },
  'status-not-synced': { description: '"Attended" in the marketing tool, still "Registered" in the CRM.', cfg: { status: ALL.status } },
  'utm-dropped': { description: 'From Aug 14 the contact-sales form drops UTMs; some fills have click IDs, some only ABA engagement, some nothing.', cfg: { utm: ALL.utm } },
  duplicates: { description: 'Opportunities sit on duplicate contacts that have no activities.', cfg: { duplicates: ALL.duplicates } },
  'no-contact-role': { description: 'Opportunities created without a contact.', cfg: { noContact: ALL.noContact } },
  'amount-mismatch': { description: 'Opportunity amounts differ from the subscription; one won deal was never billed.', cfg: { billing: ALL.billing } },
  everything: { description: 'All six problems at once.', cfg: ALL },
  subtle: {
    description: 'Small versions of every problem.',
    cfg: {
      unsynced: { date: '2026-08-20', opps: 1, attendees: 8 },
      status: { opps: 1 },
      utm: { startDate: '2026-09-01', rate: 0.25, cases: [{ channel: 'Paid Search' }, { channel: '6sense', abaClicks: '6sense' }] },
      duplicates: { opps: 1 },
      noContact: { opps: 1 },
      billing: { mismatches: 1, unbilled: 0, delta: 1200 },
    },
  },
};

const writeJson = (path, value) => {
  // One record per line: readable, and much smaller than fully indented JSON.
  const text = Array.isArray(value) ? `[\n${value.map((r) => `  ${JSON.stringify(r)}`).join(',\n')}\n]\n` : `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, text);
};

function main() {
  const base = buildBase();
  rmSync(OUT_DIR, { recursive: true, force: true });
  Object.entries(SCENARIOS).forEach(([name, { description, cfg }], i) => {
    const { files, truth } = plant(base, cfg, BASE_SEED + 1 + i);
    const dir = join(OUT_DIR, name);
    mkdirSync(dir, { recursive: true });
    for (const [file, rows] of Object.entries(files)) writeJson(join(dir, file), rows);
    const problems = Object.keys(truth).filter((k) => /^C\d$/.test(k));
    writeJson(join(dir, 'ground-truth.json'), { scenario: name, description, report_quarter: REPORT_QUARTER, problems, ...truth });
    console.log(`${name.padEnd(18)} ${files['opportunities.json'].length} opps  ${files['contacts.json'].length} contacts  ${files['map_members.json'].length} members  ${files['aba_engagement.json'].length} ABA rows  problems: ${problems.join(', ') || 'none'}`);
  });
}

main();
