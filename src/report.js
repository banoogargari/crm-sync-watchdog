// Turns a verified agent run into the report (HTML + Markdown) and the
// proposed-fix CSV files. Every number in a table comes from code; the agent
// supplies the explanations and the trust decisions.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NO_SOURCE, NO_ACTIVITY } from './config.js';
import { influenceByProgram, abaSummary } from './influence.js';
import { PROBLEMS, problemName } from './problems.js';

const usd = (n) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const signed = (n) => (n > 0 ? `+${usd(n)}` : usd(n));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MEASURES = { pipeline_created: 'Pipeline created', closed_won_arr: 'Closed-won ARR' };
const SEGMENTS = { all: 'All', new_logo: 'New logo', expansion: 'Expansion' };
const NON_CHANNELS = [NO_SOURCE, NO_ACTIVITY];

/** Rows of the channel table for one measure and segment. */
export function channelRows({ results, findings }, measure, segment = 'all') {
  const { totals, affected, changed } = results;
  const trust = new Map((findings?.channel_trust ?? []).map((t) => [t.channel, t]));
  const val = (t) => (!t ? 0 : segment === 'all' ? t[measure] : t[segment][measure]);
  const channels = [...new Set([...Object.keys(totals.reported), ...Object.keys(totals.if_fixes_approved)])];
  return channels.map((channel) => {
    const reported = val(totals.reported[channel]);
    const fixed = val(totals.if_fixes_approved[channel]);
    return {
      channel, reported, fixed, change: fixed - reported,
      trusted: trust.get(channel)?.trusted ?? !affected[channel],
      reason: trust.get(channel)?.reason ?? '',
      checks: affected[channel] ?? [],
      by_check: changed[channel]?.[measure]?.by_check ?? {},
    };
  }).sort((a, b) => NON_CHANNELS.includes(a.channel) - NON_CHANNELS.includes(b.channel) || b.fixed - a.fixed || b.reported - a.reported || a.channel.localeCompare(b.channel));
}

const sumOf = (rows, k) => rows.reduce((s, r) => s + r[k], 0);
const msOf = (rows, k) => sumOf(rows.filter((r) => !NON_CHANNELS.includes(r.channel)), k);
const share = (a, b) => (b ? `(${Math.round((a / b) * 100)}%)` : '');

/** Issue cards: the agent's words plus the code's numbers. */
export function issueList({ results, findings }) {
  return (findings?.issues ?? []).map((i, n) => {
    const c = results.checks[i.check];
    const facts = i.check === 'C6'
      ? [['Won deals affected', c.opportunity_ids.length], ['ARR above billing', usd(c.overstated_arr)]]
      : [['Opportunities', c.opportunity_ids.length], ['Pipeline', usd(c.pipeline_created)], ['Won ARR', usd(c.closed_won_arr)]];
    return { n: n + 1, ...i, check_name: problemName(i.check), facts };
  });
}

function reviewItems(results) {
  const { checks } = results;
  return {
    c3: checks.C3.opportunities.filter((o) => !o.proposed_channel),
    c5: checks.C5.items,
  };
}

// ---------------------------------------------------------------------------
export function renderMarkdown(run, meta) {
  const { results, findings } = run;
  const out = [];
  out.push(`# Pipeline and ARR by channel: ${run.quarter.label}`, '', `> ${findings.headline}`, '');
  for (const [m, title] of Object.entries(MEASURES)) {
    const rows = channelRows(run, m);
    out.push(`## ${title}`, '', '| Channel | Reported today | If fixes are approved | Change | New logo / Expansion (if fixed) | Trust |', '|---|---:|---:|---:|---:|---|');
    const nl = channelRows(run, m, 'new_logo'); const ex = channelRows(run, m, 'expansion');
    for (const r of rows) {
      const a = nl.find((x) => x.channel === r.channel).fixed; const b = ex.find((x) => x.channel === r.channel).fixed;
      out.push(`| ${r.channel} | ${usd(r.reported)} | ${usd(r.fixed)} | ${r.change ? signed(r.change) : '—'} | ${usd(a)} / ${usd(b)} | ${r.trusted ? '✅' : `⚠️ ${r.checks.map(problemName).join('; ')}`} |`);
    }
    const d = msOf(rows, 'fixed') - msOf(rows, 'reported');
    out.push(`| **Marketing-sourced** | **${usd(msOf(rows, 'reported'))} ${share(msOf(rows, 'reported'), sumOf(rows, 'reported'))}** | **${usd(msOf(rows, 'fixed'))} ${share(msOf(rows, 'fixed'), sumOf(rows, 'fixed'))}** | ${d ? signed(d) : '—'} | | |`);
    out.push(`| **Total** | **${usd(sumOf(rows, 'reported'))}** | **${usd(sumOf(rows, 'fixed'))}** | — | | |`, '');
  }
  if (findings.channel_explanations?.length) {
    out.push('## What moves and why', '');
    for (const e of findings.channel_explanations) out.push(`- **${e.channel}** (${(e.problems ?? []).map(problemName).join('; ')}): ${e.explanation}`);
    out.push('');
  }
  out.push('## Issues', '');
  const issues = issueList(run);
  if (!issues.length) out.push('No issues found. Every channel can be trusted.', '');
  for (const i of issues) {
    out.push(`### ${i.n}. ${i.title}`, '', `_${problemName(i.check)}: ${PROBLEMS[i.check].what}_`, '', `${i.facts.map(([k, v]) => `**${k}:** ${v}`).join(' · ')}${i.needs_human_review ? ' · **Needs review**' : ''}`, '');
    out.push(`- **What happened:** ${i.what_happened}`, `- **Impact:** ${i.impact}`, `- **Recommended action:** ${i.recommended_action}`, '');
  }
  const rv = reviewItems(results);
  if (rv.c3.length || rv.c5.length) {
    out.push('## Needs a person to decide', '', 'These stay where they are in both views. ABM hints are suggestions, never added to the numbers.', '');
    for (const o of rv.c3) out.push(`- \`${o.opportunity_id}\` ${usd(o.amount)}: ${problemName('C3').toLowerCase()} (form fill on ${o.form_fill_date}) (${o.group === 'likely_abm' ? `ABM hint: ${o.abm_hint}` : 'no clues'}). ${o.evidence}.`);
    for (const i of rv.c5) out.push(`- \`${i.opportunity_id}\` ${usd(i.amount)}: ${problemName('C5').toLowerCase()}. Suggested contact: ${i.suggested_contact_email ?? 'none'}.`);
    out.push('');
  }
  const inf = influenceByProgram(meta.data, results.idx, run.quarter);
  out.push('## Influenced opportunities by program', '', '| Program | Type | Creation | Progression | Total | Influenced pipeline | Spend | Cost per influenced opp |', '|---|---|---:|---:|---:|---:|---:|---:|');
  for (const p of inf.programs) out.push(`| ${p.program} | ${p.type} | ${p.influenced_creation} | ${p.influenced_progression} | ${p.influenced_opportunities} | ${usd(p.influenced_pipeline)} | ${usd(p.spend)} | ${p.cost_per_influenced_opportunity === null ? '—' : usd(p.cost_per_influenced_opportunity)} |`);
  out.push('', `_${inf.note}_`, '');
  out.push('---', `Generated ${meta.generatedAt} · ${meta.source} · model ${run.model} · verification ${run.verification.passed ? 'passed' : 'FAILED'} · ${run.turns} turns · $${run.usage.cost_usd}`);
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
function channelTable(run, measure, segment) {
  const rows = channelRows(run, measure, segment);
  const max = Math.max(...rows.map((r) => Math.max(r.reported, r.fixed)), 1);
  const bar = (v, cls) => `<span class="bar ${cls}" style="width:${((v / max) * 100).toFixed(1)}%"></span>`;
  const body = rows.map((r) => `
        <tr class="${r.trusted ? '' : 'warn'}${NON_CHANNELS.includes(r.channel) ? ' nonchan' : ''}">
          <th scope="row">${esc(r.channel)}</th>
          <td class="num">${usd(r.reported)}<div class="track">${bar(r.reported, 'b-rep')}</div></td>
          <td class="num">${usd(r.fixed)}<div class="track">${bar(r.fixed, 'b-fix')}</div></td>
          <td class="num delta ${r.change > 0 ? 'up' : r.change < 0 ? 'down' : ''}">${r.change ? signed(r.change) : '<span class="muted">—</span>'}</td>
          <td>${r.trusted ? '<span class="pill ok">Trusted</span>' : `<span class="pill bad">Not trusted</span><div class="why">${r.checks.map((c) => `<a href="#${c}">${esc(problemName(c))}</a>`).join('<br>')}</div>`}</td>
        </tr>`).join('');
  return `
      <table class="t-${measure} s-${segment}">
        <thead><tr><th>Channel</th><th>Reported today</th><th>If fixes are approved</th><th>Change</th><th>Trust</th></tr></thead>
        <tbody>${body}
        </tbody>
        <tfoot>
          <tr class="ms"><th>Marketing-sourced<div class="sub">all channels except No source and No marketing activity</div></th><td class="num">${usd(msOf(rows, 'reported'))} <span class="muted">${share(msOf(rows, 'reported'), sumOf(rows, 'reported'))}</span></td><td class="num">${usd(msOf(rows, 'fixed'))} <span class="muted">${share(msOf(rows, 'fixed'), sumOf(rows, 'fixed'))}</span></td><td class="num delta ${msOf(rows, 'fixed') > msOf(rows, 'reported') ? 'up' : msOf(rows, 'fixed') < msOf(rows, 'reported') ? 'down' : ''}">${msOf(rows, 'fixed') - msOf(rows, 'reported') ? signed(msOf(rows, 'fixed') - msOf(rows, 'reported')) : '<span class="muted">—</span>'}</td><td></td></tr>
          <tr><th>Total</th><td class="num">${usd(sumOf(rows, 'reported'))}</td><td class="num">${usd(sumOf(rows, 'fixed'))}</td><td class="num muted">—</td><td></td></tr>
        </tfoot>
      </table>`;
}

function movedSection(run) {
  const { results, findings } = run;
  const expl = findings.channel_explanations ?? [];
  if (!expl.length) return '<p class="clean">Nothing moves: the two views are the same.</p>';
  const { pipeline_created: pc, closed_won_arr: cw } = results.bridges;
  const chips = (byCheck) => Object.entries(byCheck).filter(([, v]) => v).map(([c, v]) => `<span class="chip ${v > 0 ? 'up' : 'down'}"><a href="#${c}">${esc(problemName(c))}</a> ${signed(v)}</span>`).join(' ');
  const cards = expl.map((e) => {
    const ch = results.changed[e.channel];
    const lines = Object.entries(MEASURES).filter(([m]) => ch?.[m]).map(([m, title]) => `
          <div class="mline"><span class="mlabel">${title}</span> <b>${usd(ch[m].reported)}</b> → <b>${usd(ch[m].if_fixes_approved)}</b> ${chips(ch[m].by_check)}</div>`).join('');
    return `
      <article class="move">
        <h3>${esc(e.channel)}</h3>${lines}
        <p>${esc(e.explanation)}</p>
      </article>`;
  }).join('');
  const moves = [...pc.moves, ...cw.moves.filter((m) => !pc.moves.some((x) => x.opportunity_id === m.opportunity_id))];
  const list = moves.map((m) => `<tr><td><code>${esc(m.opportunity_id)}</code></td><td>${esc(m.name)}</td><td class="num">${usd(m.amount)}</td><td>${esc(m.from)} → <b>${esc(m.to)}</b></td><td><a href="#${m.because_of}">${esc(problemName(m.because_of))}</a></td></tr>`).join('');
  return `<div class="moves">${cards}</div>
    <details class="opps"><summary>Every opportunity that changes channel (${moves.length})</summary>
      <div class="table-wrap"><table><thead><tr><th>Opportunity</th><th>Account</th><th>Amount</th><th>Channel today → if fixed</th><th>Because of</th></tr></thead><tbody>${list}</tbody></table></div>
    </details>`;
}

function reviewSection(run) {
  const rv = reviewItems(run.results);
  if (!rv.c3.length && !rv.c5.length) return '';
  const rows = [
    ...rv.c3.map((o) => `<tr><td><code>${esc(o.opportunity_id)}</code></td><td class="num">${usd(o.amount)}</td><td><a href="#C3">${esc(problemName('C3'))}</a><br><span class="muted">form fill ${esc(o.form_fill_date)}</span></td><td>${o.group === 'likely_abm' ? `<span class="pill review">Hint: ${esc(o.abm_hint)}</span> <span class="muted">${esc(o.evidence)}</span>` : '<span class="muted">No clues</span>'}</td><td>${esc(o.channel_if_fixed)}</td></tr>`),
    ...rv.c5.map((i) => `<tr><td><code>${esc(i.opportunity_id)}</code></td><td class="num">${usd(i.amount)}</td><td><a href="#C5">${esc(problemName('C5'))}</a></td><td>${i.suggested_contact_email ? `Suggested contact: ${esc(i.suggested_contact_email)} <span class="muted">(${i.suggested_contact_activities} activities)</span>` : '<span class="muted">No contact at this account</span>'}</td><td>${esc(NO_ACTIVITY)}</td></tr>`),
  ].join('');
  return `
  <section>
    <h2>Needs a person to decide</h2>
    <p class="note">These opportunities stay where they are in both views, because only a person can resolve them. ABM hints come from ad clicks by the account before the form fill: a suggestion to check, never added to the numbers.</p>
    <div class="table-wrap"><table><thead><tr><th>Opportunity</th><th>Amount</th><th>Problem</th><th>Clue</th><th>Stays in</th></tr></thead><tbody>${rows}</tbody></table></div>
  </section>`;
}

function influenceSection(run, data) {
  const inf = influenceByProgram(data, run.results.idx, run.quarter);
  const aba = abaSummary(data, run.quarter);
  const rows = inf.programs.map((p) => `<tr><th scope="row">${esc(p.program)}</th><td><span class="muted">${p.type}</span></td><td class="num">${p.influenced_creation}</td><td class="num">${p.influenced_progression}</td><td class="num"><b>${p.influenced_opportunities}</b></td><td class="num">${usd(p.influenced_pipeline)}</td><td class="num">${usd(p.spend)}</td><td class="num">${p.cost_per_influenced_opportunity === null ? '—' : usd(p.cost_per_influenced_opportunity)}</td></tr>`).join('');
  const abaCards = Object.entries(aba).map(([program, a]) => `
      <div class="stat"><span>${esc(program)}</span>
        <b>${a.engaged_accounts} of ${a.target_accounts}</b><span>target accounts engaged</span>
        <p class="small">Opportunity rate: <b>${a.opportunity_rate_engaged_pct ?? '—'}%</b> engaged vs. <b>${a.opportunity_rate_not_engaged_pct ?? '—'}%</b> not engaged.${a.engaged_accounts_that_moved_stage !== undefined ? ` ${a.engaged_accounts_that_moved_stage} engaged accounts moved buying stage.` : ''} ${a.engaged_without_opportunity.length} engaged accounts have no open opportunity yet.</p>
      </div>`).join('');
  return `
  <section>
    <h2>Influenced opportunities by program</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Program</th><th>Type</th><th>Creation</th><th>Progression</th><th>Total</th><th>Influenced pipeline</th><th>Spend</th><th>Cost / influenced opp</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="note"><b>Creation:</b> engaged in the 90 days before the opportunity was created. <b>Progression:</b> engaged while it was open, and it moved up a stage within 30 days. ${esc(inf.note)} Account-based programs are measured at the account level from the ad platforms, because those clicks never reach the CRM.</p>
    <div class="stats two">${abaCards}</div>
  </section>`;
}

export function renderHtml(run, meta) {
  const { results, findings } = run;
  const issues = issueList(run);
  const pipe = channelRows(run, 'pipeline_created');
  const untrusted = pipe.filter((r) => !r.trusted).length;
  const toggles = Object.entries(MEASURES).flatMap(([m]) => Object.keys(SEGMENTS).map((s) => `#m-${m}:checked ~ #s-${s}:checked ~ .table-wrap .t-${m}.s-${s}`)).join(',\n  ');
  const issueCards = issues.length ? issues.map((i) => `
    <article class="issue" id="${i.check}">
      <p class="kind">${esc(i.check_name)}</p>
      <header><h3>${esc(i.title)}</h3>${i.needs_human_review ? '<span class="pill review">Needs review</span>' : ''}</header>
      <dl class="facts">${i.facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <p><strong>What happened.</strong> ${esc(i.what_happened)}</p>
      <p><strong>Impact.</strong> ${esc(i.impact)}</p>
      <p class="action"><strong>Recommended action.</strong> ${esc(i.recommended_action)}</p>
    </article>`).join('') : '<p class="clean">No issues found. Every channel can be trusted.</p>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CRM Sync Watchdog — ${esc(run.quarter.label)}</title>
<style>
  :root {
    --bg: #f7f6f2; --card: #ffffff; --ink: #1d1d1b; --muted: #6b6a66; --line: #e4e2db;
    --ok: #1f7a4d; --ok-bg: #e3f3ea; --bad: #a3460b; --bad-bg: #fcebdc; --rev: #5b4bb7; --rev-bg: #ece9fb;
    --rep: #b8b5ab; --fix: #2f5fd0; --up: #1f7a4d; --down: #a3460b;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { --bg: #151514; --card: #1e1e1c; --ink: #ecebe6; --muted: #a09f99; --line: #34332f;
      --ok: #6fd3a0; --ok-bg: #173526; --bad: #f2a56b; --bad-bg: #3a2414; --rev: #b3a8f5; --rev-bg: #2a2547;
      --rep: #5d5b55; --fix: #7aa2ff; --up: #6fd3a0; --down: #f2a56b; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 980px; margin: 0 auto; padding: 40px 16px 64px; }
  .eyebrow { color: var(--muted); font-size: 13px; letter-spacing: .06em; text-transform: uppercase; margin: 0 0 6px; }
  h1 { font-size: clamp(26px, 4vw, 36px); line-height: 1.15; margin: 0 0 16px; letter-spacing: -.01em; }
  .headline { font-size: 18px; margin: 0 0 28px; max-width: 72ch; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 8px; }
  .stats.two { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); margin-top: 14px; }
  .stat { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
  .stat b { display: block; font-size: 24px; font-variant-numeric: tabular-nums; }
  .stat span { color: var(--muted); font-size: 13px; }
  .stat.wide { grid-column: 1 / -1; border-color: var(--fix); }
  .stat.wide b { font-size: 28px; margin: 2px 0; }
  tr.ms th, tr.ms td { border-top: 2px solid var(--line); }
  .sub { font-size: 12px; font-weight: 400; color: var(--muted); }
  .stat .small { font-size: 14px; margin: 8px 0 0; } .stat .small b { display: inline; font-size: inherit; }
  section { margin-top: 40px; }
  h2 { font-size: 21px; margin: 0 0 12px; }
  .table-wrap { background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; min-width: 600px; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
  thead th { font-size: 12px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
  tbody th { font-weight: 600; }
  tr.warn th { color: var(--bad); }
  tr.nonchan th { font-style: italic; }
  tfoot th, tfoot td { border-bottom: 0; font-weight: 700; }
  .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.num:has(.track) { width: 22%; }
  .delta.up { color: var(--up); } .delta.down { color: var(--down); }
  .track { height: 4px; margin-top: 6px; background: var(--line); border-radius: 2px; overflow: hidden; }
  .bar { display: block; height: 100%; border-radius: 2px; }
  .b-rep { background: var(--rep); } .b-fix { background: var(--fix); }
  .pill { display: inline-block; font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 999px; white-space: nowrap; }
  .pill.ok { color: var(--ok); background: var(--ok-bg); }
  .pill.bad { color: var(--bad); background: var(--bad-bg); }
  .pill.bad a { color: inherit; }
  .pill.review { color: var(--rev); background: var(--rev-bg); }
  .muted, .note { color: var(--muted); }
  .note { font-size: 14px; margin-top: 10px; max-width: 80ch; }
  .toggles { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-bottom: 12px; align-items: center; }
  .switch > input { position: absolute; opacity: 0; pointer-events: none; }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; background: var(--card); }
  .seg label { padding: 5px 13px; font-size: 14px; cursor: pointer; color: var(--muted); }
  #m-pipeline_created:checked ~ .toggles label[for="m-pipeline_created"], #m-closed_won_arr:checked ~ .toggles label[for="m-closed_won_arr"],
  #s-all:checked ~ .toggles label[for="s-all"], #s-new_logo:checked ~ .toggles label[for="s-new_logo"], #s-expansion:checked ~ .toggles label[for="s-expansion"] { background: var(--ink); color: var(--card); }
  input:focus-visible ~ .toggles .seg { outline: 2px solid var(--fix); outline-offset: 2px; }
  .switch > .table-wrap table { display: none; }
  ${toggles} { display: table; }
  .moves { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
  .move { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
  .move h3 { margin: 0 0 6px; font-size: 16px; }
  .move p { margin: 8px 0 0; font-size: 15px; }
  .mline { font-size: 14px; font-variant-numeric: tabular-nums; margin-top: 4px; }
  .mlabel { color: var(--muted); }
  .chip { display: inline-block; font-size: 12px; font-weight: 600; border-radius: 6px; padding: 1px 6px; margin: 2px 2px 0 0; background: var(--bg); }
  .chip.up { color: var(--up); } .chip.down { color: var(--down); } .chip a { color: inherit; }
  details.opps { margin-top: 14px; } details.opps summary { cursor: pointer; font-weight: 600; margin-bottom: 10px; }
  .issue { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; margin-bottom: 14px; scroll-margin-top: 16px; }
  .issue header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 10px; }
  .issue h3 { margin: 0; font-size: 17px; flex: 1 1 240px; }
  .kind { margin: 0 0 4px; font-size: 12px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--bad); }
  .why { font-size: 12px; margin-top: 4px; line-height: 1.5; } .why a { color: var(--bad); }
  .howto { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 18px; margin: 0 0 28px; font-size: 15px; }
  .howto summary { cursor: pointer; font-weight: 600; }
  .howto dl { margin: 10px 0 0; display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; }
  .howto dt { font-weight: 600; } .howto dd { margin: 0; color: var(--muted); }
  @media (max-width: 560px) { .howto dl { grid-template-columns: 1fr; } .howto dd { margin-bottom: 6px; } }
  .facts { display: flex; flex-wrap: wrap; gap: 28px; margin: 0 0 12px; }
  .facts dt { font-size: 12px; color: var(--muted); }
  .facts dd { margin: 0; font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .issue p { margin: 8px 0; }
  .action { border-left: 3px solid var(--fix); padding-left: 12px; }
  .clean { background: var(--ok-bg); color: var(--ok); padding: 14px 16px; border-radius: 12px; }
  code { font: 13px ui-monospace, Menlo, monospace; }
  footer { margin-top: 44px; color: var(--muted); font-size: 13px; border-top: 1px solid var(--line); padding-top: 14px; }
</style>
</head>
<body>
<main>
  <p class="eyebrow">CRM sync watchdog · ${esc(meta.source)}</p>
  <h1>Pipeline and ARR by channel, ${esc(run.quarter.label)}</h1>
  <p class="headline">${esc(findings.headline)}</p>

  <details class="howto">
    <summary>How to read this report</summary>
    <dl>
      <dt>Reported today</dt><dd>What the CRM shows right now: the number on today's dashboard.</dd>
      <dt>If fixes are approved</dt><dd>What it would be once a person approves the proposed fixes. Nothing has been changed yet.</dd>
      <dt>Trusted / Not trusted</dt><dd>Not trusted means at least one data problem moves money into or out of that channel; the problems are listed under it.</dd>
      <dt>Sourced vs. influenced</dt><dd>Sourced: the channel of the last marketing touch before the deal was created (each deal counted once). Influenced: programs the account engaged with along the way (a deal can count for several).</dd>
${Object.values(PROBLEMS).map((p) => `      <dt>${esc(p.name)}</dt><dd>${esc(p.what)}</dd>`).join('\n')}
    </dl>
  </details>

  <div class="stats">
    <div class="stat wide"><span>Marketing-sourced pipeline</span><b>${usd(results.marketing_sourced.reported.pipeline_created.amount)} → ${usd(results.marketing_sourced.if_fixes_approved.pipeline_created.amount)}</b><span>${Math.round(results.marketing_sourced.reported.pipeline_created.share_pct)}% → ${Math.round(results.marketing_sourced.if_fixes_approved.pipeline_created.share_pct)}% of all pipeline, reported today → if fixes are approved</span></div>
    <div class="stat"><b>${usd(results.revenue.reported.totals.pipeline_created)}</b><span>Pipeline created (all)</span></div>
    <div class="stat"><b>${usd(results.revenue.reported.totals.closed_won_arr)}</b><span>Closed-won ARR (all)</span></div>
    <div class="stat"><b>${issues.length}</b><span>Problems found</span></div>
    <div class="stat"><b>${pipe.length - untrusted} of ${pipe.length}</b><span>Channel rows trusted</span></div>
    <div class="stat"><b>${run.verification.passed ? 'Passed' : 'Failed'}</b><span>Automatic verification</span></div>
  </div>

  <section class="switch">
    <h2>By channel: reported today vs. if fixes are approved</h2>
    <input type="radio" name="m" id="m-pipeline_created" checked><input type="radio" name="m" id="m-closed_won_arr">
    <input type="radio" name="s" id="s-all" checked><input type="radio" name="s" id="s-new_logo"><input type="radio" name="s" id="s-expansion">
    <div class="toggles">
      <span class="seg">${Object.entries(MEASURES).map(([m, t]) => `<label for="m-${m}">${t}</label>`).join('')}</span>
      <span class="seg">${Object.entries(SEGMENTS).map(([s, t]) => `<label for="s-${s}">${t}</label>`).join('')}</span>
    </div>
    <div class="table-wrap">${Object.keys(MEASURES).flatMap((m) => Object.keys(SEGMENTS).map((s) => channelTable(run, m, s))).join('')}
    </div>
    <p class="note"><strong>Nothing has been changed in any system.</strong> "If fixes are approved" is a preview of the numbers once a person approves the proposed fixes (sync the missing campaigns and statuses, merge duplicates, credit paid clicks by their click ID). The total stays the same, because fixes only move deals between channels; what changes is how much of it is credited to marketing (the Marketing-sourced row). Attribution: last successful marketing activity before the opportunity was created.${results.checks.C6.status === 'issue' ? ` Won ARR uses the opportunity amount; ${usd(results.checks.C6.overstated_arr)} of it is above what billing shows (see <a href="#C6">${esc(problemName('C6'))}</a>).` : ''}</p>
  </section>

  <section>
    <h2>What moves, and why</h2>
    ${movedSection(run)}
  </section>

  <section>
    <h2>Problems found</h2>
    ${issueCards}
  </section>
${reviewSection(run)}
${influenceSection(run, meta.data)}

  <footer>
    Generated ${esc(meta.generatedAt)} by an AI agent (${esc(run.model)}) from ${esc(meta.source)}.
    Every dollar amount and count is computed by code. The agent investigates, explains and decides trust, and its findings passed
    ${run.verification.passed ? 'every' : '<strong>not all</strong>'} automatic check${run.verification.passed ? '' : 's'} (${run.submitAttempts} submission${run.submitAttempts === 1 ? '' : 's'}).
    Proposed fixes are in <code>fixes/</code>.
  </footer>
</main>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
const csv = (rows) => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
};

export function fixFiles({ checks }) {
  const files = {
    'campaigns-to-sync.csv': checks.C1.items.map((i) => ({ campaign_id: i.campaign_id, campaign_name: i.campaign_name, type: i.type, date: i.date, members_to_sync: i.members, successful_members: i.successful_members, opportunities_affected: i.opportunities.map((o) => o.opportunity_id).join(' ') })),
    'attendance-statuses-to-update.csv': checks.C2.items.map((m) => ({ crm_member_id: m.crm_member_id, campaign_name: m.campaign_name, email: m.email, date: m.date, crm_status_now: m.crm_status, set_to: m.map_status })),
    'form-fills-without-tracking.csv': checks.C3.opportunities.map((o) => ({ opportunity_id: o.opportunity_id, amount: o.amount, form_fill_date: o.form_fill_date, landing_page: o.landing_page ?? '', group: o.group, evidence: o.evidence, proposed_channel: o.proposed_channel ?? '', abm_hint: o.abm_hint ?? '', needs_review: 'yes' })),
    'duplicate-contacts-to-merge.csv': checks.C4.items.map((p) => ({ keep_contact_id: p.keep_id, merge_contact_id: p.duplicate_id, email: p.email, duplicate_email: p.duplicate_email, keep_activities: p.keep_activities, duplicate_activities: p.duplicate_activities })),
    'deals-missing-a-contact.csv': checks.C5.items.map((i) => ({ opportunity_id: i.opportunity_id, name: i.name, amount: i.amount, stage: i.stage, suggested_contact_id: i.suggested_contact_id ?? '', suggested_contact_email: i.suggested_contact_email ?? '', needs_review: 'yes' })),
    'deal-amounts-vs-billing.csv': [
      ...checks.C6.mismatches.map((m) => ({ type: 'amount differs from billing', opportunity_id: m.opportunity_id, name: m.name, subscription_id: m.subscription_id, opportunity_amount: m.opportunity_amount, billed_arr: m.billed_arr, difference: m.difference })),
      ...checks.C6.won_without_subscription.map((u) => ({ type: 'won with no subscription', opportunity_id: u.opportunity_id, name: u.name, subscription_id: '', opportunity_amount: u.amount, billed_arr: '', difference: '' })),
    ],
  };
  return Object.fromEntries(Object.entries(files).filter(([, rows]) => rows.length).map(([name, rows]) => [name, csv(rows)]));
}

export function writeReport(run, { dir, source, data, generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' }) {
  const meta = { source, data, generatedAt };
  mkdirSync(join(dir, 'fixes'), { recursive: true });
  writeFileSync(join(dir, 'report.html'), renderHtml(run, meta));
  writeFileSync(join(dir, 'report.md'), renderMarkdown(run, meta));
  const { results, ...rest } = run;
  writeFileSync(join(dir, 'findings.json'), JSON.stringify({ ...rest, revenue: results.revenue, affected_channels: results.affected, changed_channels: results.changed }, null, 2) + '\n');
  for (const [name, content] of Object.entries(fixFiles(results))) writeFileSync(join(dir, 'fixes', name), content);
  return dir;
}
