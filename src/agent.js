// The agent: Claude investigates what the checks found through tools,
// explains it, decides which channels can be trusted, and submits findings
// that the verifier must accept before a report is published.
import { analyze } from './analyze.js';
import { TOOL_DEFINITIONS, makeToolHandlers } from './tools/index.js';
import { verifyFindings } from './verify.js';

export const SYSTEM_PROMPT = `You are the CRM sync watchdog for a B2B company's marketing operations team.

Your job: answer "How much pipeline and ARR did each marketing channel source this quarter, and can we trust those numbers?"
The data comes from three systems: the marketing automation platform (programs and their members), the CRM
(campaigns, contacts, opportunities) and billing (subscriptions, the truth for ARR).
Attribution is LAST TOUCH: an opportunity's channel is the channel of the last successful marketing activity of its
primary contact on or before the day the opportunity was created. If the CRM shows no activity, it is "No marketing
activity"; if the last activity has no channel (a form fill with no UTM), it is "No source".
Your job is to find where the chain marketing tool -> CRM -> opportunity -> billing breaks, and what that does to the numbers.

How to work:
1. Call run_checks, get_revenue_by_channel for both views, and get_what_moved for pipeline_created and closed_won_arr.
2. For every check that found a problem, investigate before you explain it: use get_check_details, get_activity_history
   (on one or two example opportunities) and form_fills_by_week to find what is broken, since when, which campaigns or
   forms, how many opportunities, how much pipeline and ARR, and the likely cause.
3. Call get_influence so you know how programs influenced opportunities (you may mention it in the headline if it matters).
4. Submit with submit_findings:
   - one issue per check that found a problem;
   - a channel explanation for EVERY channel listed in get_what_moved (either measure), listing the checks that move it in problems;
   - a trust status for EVERY channel row of both views.

Rules you must follow:
- Never do arithmetic. Every number you write must be copied exactly from a tool result. If you want a total or a
  difference the tools don't give you, describe it in words instead.
- A channel is trusted only if no problem affects it. run_checks lists affected_channels; respect it. An agent
  reporting confidently on bad data is worse than no agent.
- Fixes are proposals for a person to approve. Never say a fix was applied; nothing has been changed in any system.
- Don't guess channels. An ABM hint (ABA clicks before a form fill with no UTM) is a suggestion for a person to check,
  never a credited channel. Suggested contacts for opportunities with no contact need review.
- Influence shows interest, not cause. Never add influenced pipeline to sourced pipeline.
- The report is read by a CMO who has never seen the codes C1…C6. Use the codes only in the structured fields
  (issues[].check, channel_explanations[].problems). In every text you write, name the problem in plain words: use
  run_checks' plain_name or something more specific ("the Customer Summit never reached the CRM").
- When you explain a channel, use moves_in and moves_out: if one problem moves opportunities both in and out, say so
  (e.g. "attendance not updated adds O5216 and removes O5252") rather than attributing the net change to one opportunity.
- Fixes never change total pipeline or total won ARR; they move money between channels. What changes is the
  marketing-sourced amount and share (run_checks.marketing_sourced). Lead the headline with it when it changes.
- The headline is what the CMO reads first, and often the only thing: at most 3 sentences and 60 words. Lead with
  marketing-sourced pipeline (today vs. if fixes are approved), say whether the channel numbers can be trusted, and
  name the one or two biggest problems. Leave influence and caveats to the rest of the report.
- Write dates the way people say them: "Aug 14", not "2026-08-14".
- Write for a CMO and a marketing operations lead: short, concrete, no jargon. Name the channel, the number and the action.
- Write money with a dollar sign and thousands separators, e.g. $246,000 (tools return 246000). Write percentages
  exactly as the tools give them.`;

const PRICES = { // USD per million tokens: [input, output]
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-fable-5-1': [10, 50],
};

export async function runAgent({ client, model, data, quarter, maxTurns = 30, maxSubmitAttempts = 3, onEvent = () => {} }) {
  const results = analyze(data, quarter);
  const tools = makeToolHandlers({ data, results });
  const usage = { input_tokens: 0, output_tokens: 0 };
  const messages = [{
    role: 'user',
    content: `Run the CRM sync check for ${quarter.label} (${quarter.start} to ${quarter.end}) and submit your findings.`,
  }];

  let findings = null;
  let verification = null;
  let submitAttempts = 0;
  let turns = 0;

  while (turns < maxTurns) {
    turns += 1;
    const response = await client.messages.create({ model, max_tokens: 12000, system: SYSTEM_PROMPT, tools: TOOL_DEFINITIONS, messages });
    usage.input_tokens += response.usage?.input_tokens ?? 0;
    usage.output_tokens += response.usage?.output_tokens ?? 0;
    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    if (!toolUses.length) {
      messages.push({ role: 'user', content: 'Please finish by calling submit_findings.' });
      continue;
    }

    const toolResults = [];
    let done = false;
    for (const block of toolUses) {
      onEvent({ type: 'tool', name: block.name, input: block.input });
      if (block.name === 'submit_findings') {
        submitAttempts += 1;
        findings = block.input;
        verification = verifyFindings({ findings, ...results, seenNumbers: tools.seenNumbers });
        onEvent({ type: 'verification', attempt: submitAttempts, ...verification });
        if (verification.passed || submitAttempts >= maxSubmitAttempts) {
          done = true;
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: verification.passed ? 'Accepted.' : 'Rejected; no more attempts.' });
        } else {
          toolResults.push({
            type: 'tool_result', tool_use_id: block.id, is_error: true,
            content: `Not accepted. Fix these and call submit_findings again:\n${verification.errors.map((e) => `- [${e.rule}] ${e.message}`).join('\n')}`,
          });
        }
        continue;
      }
      try {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(tools.call(block.name, block.input)) });
      } catch (err) {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: String(err.message ?? err) });
      }
    }
    if (done) break;
    messages.push({ role: 'user', content: toolResults });
  }

  const [inPrice, outPrice] = PRICES[model] ?? [0, 0];
  return {
    model, quarter, findings,
    verification: verification ?? { passed: false, errors: [{ rule: 'V0', message: 'The agent never submitted findings.' }] },
    submitAttempts, turns,
    usage: { ...usage, cost_usd: Number(((usage.input_tokens * inPrice + usage.output_tokens * outPrice) / 1e6).toFixed(4)) },
    results,
  };
}
