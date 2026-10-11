import { CODE_PATTERN } from './problems.js';

// The verifier: plain code that checks Claude's findings before anything is
// published. If any rule fails, Claude gets the reasons and must fix them.
//
//   V1  Every check that found a problem is covered by an issue, and no issue
//       is reported for a check that found nothing.
//   V2  Every channel row has a trust status, and every row affected by a
//       problem is marked NOT trusted.
//   V3  Every channel that changes between "reported" and "if fixes approved"
//       is explained, the explanation names every check that moves it, and it
//       names no check that has nothing to do with that channel.
//   V4  Every number in the text appears in a tool result (no invented or
//       self-calculated numbers).
//   V5  No text uses the codes C1…C6: the report is read by a CMO, so problems
//       are named in plain words.

const MONTHS = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
const DATE_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}\b/g, // 2026-08-14
  new RegExp(`\\b(?:${MONTHS})\\.? \\d{1,2}(?:st|nd|rd|th)?(?:, \\d{4})?\\b`, 'g'), // Aug 14, 2026
  new RegExp(`\\b\\d{1,2} (?:${MONTHS})\\b`, 'g'), // 14 Aug
  /\bQ[1-4] \d{4}\b/g, // Q3 2026
  /\b20\d{2}\b/g, // 2026
];

/** Numbers written in a piece of text, ignoring dates, ids (O5225), check names (C2) and names like 6sense. */
export function numbersInText(text) {
  let t = ` ${text} `;
  for (const p of DATE_PATTERNS) t = t.replace(p, ' ');
  const out = [];
  for (const m of t.matchAll(/(?<![\w.])\$?(\d[\d,]*(?:\.\d+)?)([kKmM]?)(%?)(?![\w])/g)) {
    let n = Number(m[1].replace(/,/g, ''));
    if (Number.isNaN(n)) continue;
    if (m[2]) n *= m[2].toLowerCase() === 'k' ? 1_000 : 1_000_000;
    out.push({ raw: m[0], value: n });
  }
  return out;
}


export function verifyFindings({ findings, checks, totals, affected, changed, seenNumbers }) {
  const errors = [];

  // V1 — coverage
  const withIssue = Object.values(checks).filter((c) => c.status === 'issue').map((c) => c.check);
  const reported = new Set((findings.issues ?? []).map((i) => i.check));
  for (const c of withIssue) if (!reported.has(c)) errors.push({ rule: 'V1', message: `Check ${c} found a problem but no issue covers it.` });
  for (const c of reported) if (!withIssue.includes(c)) errors.push({ rule: 'V1', message: `Issue reported for ${c}, but that check found no problem.` });

  // V2 — trust
  const rows = new Set([...Object.keys(totals.reported), ...Object.keys(totals.if_fixes_approved)]);
  const trust = new Map((findings.channel_trust ?? []).map((t) => [t.channel, t]));
  for (const ch of rows) {
    const t = trust.get(ch);
    if (!t) errors.push({ rule: 'V2', message: `Channel "${ch}" has no trust status.` });
    else if (t.trusted && affected[ch]) errors.push({ rule: 'V2', message: `Channel "${ch}" is marked trusted but is affected by ${affected[ch].join(', ')}.` });
  }
  for (const ch of trust.keys()) if (!rows.has(ch)) errors.push({ rule: 'V2', message: `Channel "${ch}" is not a row of the report.` });

  // V3 — every change between the views is explained by the checks that cause it
  const expl = new Map((findings.channel_explanations ?? []).map((e) => [e.channel, e.problems ?? []]));
  for (const [ch, c] of Object.entries(changed)) {
    if (!expl.has(ch)) { errors.push({ rule: 'V3', message: `Channel "${ch}" changes between the views (caused by ${c.causes.join(', ')}) but has no explanation.` }); continue; }
    const named = [...new Set(expl.get(ch))].sort();
    const missing = c.causes.filter((x) => !named.includes(x));
    // Naming another check that touches this channel (e.g. C6 on won ARR) is fine context; naming one that doesn't is wrong.
    const extra = named.filter((x) => !c.causes.includes(x) && !(affected[ch] ?? []).includes(x));
    if (missing.length) errors.push({ rule: 'V3', message: `Explanation for "${ch}" must list ${missing.join(', ')} in problems, which move${missing.length === 1 ? 's' : ''} it.` });
    if (extra.length) errors.push({ rule: 'V3', message: `Explanation for "${ch}" lists ${extra.join(', ')}, but ${extra.length === 1 ? 'it does' : 'they do'} not affect this channel (see get_what_moved and affected_channels).` });
  }
  for (const ch of expl.keys()) if (!changed[ch]) errors.push({ rule: 'V3', message: `Channel "${ch}" does not change between the views; remove its explanation.` });

  // V4 — every number must come from a tool result
  const known = (n) => seenNumbers.has(n) || (!Number.isInteger(n) && [...seenNumbers].some((s) => Math.abs(s - n) < 0.051));
  const texts = [
    ['headline', findings.headline],
    ...(findings.issues ?? []).flatMap((i, k) => ['title', 'what_happened', 'impact', 'recommended_action'].map((f) => [`issues[${k}].${f}`, i[f]])),
    ...(findings.channel_explanations ?? []).map((e) => [`channel_explanations[${e.channel}]`, e.explanation]),
    ...(findings.channel_trust ?? []).map((t) => [`channel_trust[${t.channel}].reason`, t.reason]),
  ];
  for (const [where, text] of texts) {
    for (const { raw, value } of numbersInText(text ?? '')) {
      if (!known(value)) errors.push({ rule: 'V4', message: `${where}: "${raw.trim()}" does not appear in any tool result. Use the exact numbers the tools returned; do not calculate new ones.` });
    }
  }

  // V5 — plain words only
  for (const [where, text] of texts) {
    const m = (text ?? '').match(CODE_PATTERN);
    if (m) errors.push({ rule: 'V5', message: `${where}: uses the code "${m[0]}". The CMO does not know the codes; use the problem's plain name instead.` });
  }

  return { passed: errors.length === 0, errors };
}
