// Checks every chat answer before it is shown.
//   A1  Every number comes from a tool result.
//   A2  No internal codes (C1…C6).
//   A3  Every channel the answer mentions that a data problem affects, in a
//       period the agent looked at, has a caveat. Marketing-sourced numbers in
//       a period with problems need a caveat too.
import { numbersInText } from '../verify.js';
import { CODE_PATTERN } from '../problems.js';
import { ALL_CHANNELS } from '../metrics.js';

/** Channels named in a text. "LinkedIn ABA" / "6sense ABA" are influence programs, not sourced channels. */
export function channelsIn(text) {
  const t = ` ${text ?? ''} `.replace(/LinkedIn ABA|6sense ABA/g, ' ');
  return ALL_CHANNELS.filter((ch) => new RegExp(`(^|[^\\w])${ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'i').test(t));
}

export function verifyAnswer({ answer, caveats = [] }, { seenNumbers, looked }) {
  const errors = [];
  const known = (n) => seenNumbers.has(n) || (!Number.isInteger(n) && [...seenNumbers].some((s) => Math.abs(s - n) < 0.051));
  const texts = [['answer', answer], ...caveats.map((c, i) => [`caveats[${i}]`, c.note])];
  for (const [where, text] of texts) {
    for (const { raw, value } of numbersInText(text ?? '')) if (!known(value)) errors.push({ rule: 'A1', message: `${where}: "${raw.trim()}" does not appear in any tool result. Use the exact numbers the tools returned; never calculate new ones.` });
    const m = (text ?? '').match(CODE_PATTERN);
    if (m) errors.push({ rule: 'A2', message: `${where}: uses the internal code "${m[0]}". Name the problem in plain words.` });
  }
  const caveated = new Set(caveats.map((c) => c.channel.toLowerCase()));
  const mentioned = channelsIn(answer);
  for (const [period, affected] of looked) {
    for (const ch of mentioned) {
      if (affected[ch] && !caveated.has(ch.toLowerCase())) errors.push({ rule: 'A3', message: `The answer mentions ${ch}, which a data problem affects in ${period}, but has no caveat for it. Add one saying what the problem is and which way it pushes the number.` });
    }
    const anyProblem = Object.keys(affected).length > 0;
    if (anyProblem && /marketing[- ]sourced/i.test(answer ?? '') && !caveats.length) errors.push({ rule: 'A3', message: `The answer gives marketing-sourced numbers for ${period}, where data problems move pipeline between channels, but has no caveat.` });
  }
  return { passed: errors.length === 0, errors: dedupe(errors) };
}

const dedupe = (errors) => [...new Map(errors.map((e) => [e.message, e])).values()];
