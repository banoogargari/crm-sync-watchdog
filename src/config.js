// Conventions everything else relies on, written down in one place.

export const TODAY = '2026-10-11';

export const QUARTERS = [
  { id: 'Q4-2025', label: 'Q4 2025', start: '2025-10-01', end: '2025-12-31' },
  { id: 'Q1-2026', label: 'Q1 2026', start: '2026-01-01', end: '2026-03-31' },
  { id: 'Q2-2026', label: 'Q2 2026', start: '2026-04-01', end: '2026-06-30' },
  { id: 'Q3-2026', label: 'Q3 2026', start: '2026-07-01', end: '2026-09-30' },
  { id: 'Q4-2026', label: 'Q4 2026 (in progress)', start: '2026-10-01', end: '2026-12-31', inProgress: true },
];
// The quarter the watchdog report is about: the latest complete one.
export const REPORT_QUARTER = QUARTERS.find((q) => q.id === 'Q3-2026');
export const quarterOf = (date) => QUARTERS.find((q) => date >= q.start && date <= q.end) ?? null;

// Channels an opportunity can be attributed to (display names).
export const CHANNELS = ['Events', 'Webinars', 'Content Syndication', 'Email', 'LinkedIn', 'Paid Search', '6sense', 'Organic'];
export const NO_SOURCE = 'No source'; // there is a last activity, but it has no channel (e.g. form fill with no UTM)
export const NO_ACTIVITY = 'No marketing activity'; // the CRM shows no marketing activity before the opportunity

// Campaign types in the marketing tool, their channel and which statuses count as a success.
export const CAMPAIGN_TYPES = {
  event: { channel: 'Events', success: ['Attended'], other: ['Registered', 'No Show'] },
  webinar: { channel: 'Webinars', success: ['Attended', 'Attended On-demand'], other: ['Registered', 'No Show'] },
  content_syndication: { channel: 'Content Syndication', success: ['Downloaded'], other: [] },
  email: { channel: 'Email', success: ['Clicked'], other: ['Sent', 'Opened'] },
  web_form: { channel: null, success: ['Submitted'], other: [] }, // channel comes from the form fill's UTM
};

// Web form fills: UTM source -> channel.
export const UTM_CHANNEL = { linkedin: 'LinkedIn', google: 'Paid Search', '6sense': '6sense', email: 'Email' };
// Click IDs that prove a paid ad click even when the UTM was lost.
export const CLICK_ID_CHANNEL = { gclid: 'Paid Search', li_fat_id: 'LinkedIn' };
export const SEARCH_REFERRERS = ['https://www.google.com/', 'https://www.bing.com/', 'https://duckduckgo.com/'];

// Account-based advertising programs (no campaign members; engagement is per account).
export const ABA_PLATFORMS = { linkedin_aba: 'LinkedIn ABA', '6sense': '6sense ABA' };
export const BUYING_STAGES = ['Target', 'Awareness', 'Consideration', 'Decision', 'Purchase'];

// Programs in the influence report.
export const PROGRAMS = ['Events', 'Webinars', 'Content Syndication', 'Email', 'LinkedIn ABA', '6sense ABA'];

export const OPP_STAGES = ['Discovery', 'Demo', 'Proposal', 'Negotiation'];
export const WON = 'Closed Won';
export const LOST = 'Closed Lost';

export const WINDOWS = {
  influenceCreationDays: 90, // engagement this many days before the opportunity was created
  influenceProgressionDays: 30, // engagement this many days before a stage move, while open
  abmHintDays: 14, // ABA clicks this many days before a no-UTM form fill
  abmHintMinClicks: 3,
};
