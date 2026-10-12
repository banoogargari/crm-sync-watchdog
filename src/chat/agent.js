// The chat: one conversation with Claude over the metric tools. Each answer is
// verified before it is returned; if it fails, Claude gets the reasons and
// tries again (up to 3 times).
import { CHAT_TOOLS, makeChatTools } from './tools.js';
import { verifyAnswer } from './verify.js';
import { TODAY } from '../config.js';

export const CHAT_PROMPT = `You answer questions from a CMO and campaign managers about marketing performance: MQLs, pipeline, won ARR,
win rate, deal size, sales cycle, by quarter and channel, and how programs influenced opportunities.
Today is ${TODAY}. Q3 2026 is the last complete quarter; Q4 2026 is in progress (partial numbers).

Data: the marketing automation platform, the CRM and billing. Sourced channel = the channel of the last successful
marketing activity before the opportunity was created (MQLs: before the MQL date). "No source" and "No marketing
activity" are not channels; marketing-sourced = everything else.

How to answer:
- Always get numbers from the tools. For any comparison ("better", "grew", "vs."), use compare_periods: it computes the
  changes for you. Never do arithmetic yourself, and never write a number that is not in a tool result.
- Default to the reported view (what the CRM shows today). Each tool also tells you which data problems affect the
  period. When a channel you mention is affected, add a caveat: what the problem is and which way it pushes the number,
  and, when it helps, the number if fixes are approved (call the tool again with view="if_fixes_approved").
- A big drop or jump in a channel that a data problem affects is probably the data, not the market. Say so.
- If Q4 2026 is involved, say its numbers are partial.
- A quarter without a year means the most recent one with data (e.g. "Q1" = Q1 2026). Say which one you used in a
  few words ("Q1 2026: …"); don't explain what is missing.
- Caveats are only for real data problems. If no problem affects what you mention, leave caveats empty and don't talk
  about data quality unless asked.
- MQLs are credited to the last activity before the MQL date, which is usually the contact-sales form itself, so
  event and webinar programs rarely get MQL credit (they show up in influence instead). Explain this briefly only if
  someone asks why a program has few or no MQLs.
- Influence shows interest, not cause; never add influenced pipeline to sourced pipeline.
- Answer in plain words, short: lead with the number, then one or two sentences. No internal codes (C1…C6).
  Money as $246,000; percentages as the tools give them.
- If a question cannot be answered from these tools (e.g. revenue forecasts, data you do not have), say so plainly.
- Finish every question by calling answer.`;

const PRICES = { 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20], 'claude-haiku-5-5': [0.1, 0.5], 'claude-fable-5-1': [10, 50] };

export function createChat({ client, model, data, maxTurns = 12, maxAttempts = 3 }) {
  const tools = makeChatTools(data);
  const history = []; // earlier questions and verified answers, as plain text
  const total = { input_tokens: 0, output_tokens: 0, cost_usd: 0 };
  const [inPrice, outPrice] = PRICES[model] ?? [0, 0];

  async function ask(question, { onEvent = () => {} } = {}) {
    tools.resetTurn();
    const usage = { input_tokens: 0, output_tokens: 0 };
    const messages = [...history, { role: 'user', content: question }];
    let final = null;
    let verification = null;
    let attempts = 0;
    for (let turn = 0; turn < maxTurns && !final; turn++) {
      const res = await client.messages.create({
        model, max_tokens: 4000,
        system: [{ type: 'text', text: CHAT_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: CHAT_TOOLS, messages,
      });
      usage.input_tokens += (res.usage?.input_tokens ?? 0) + (res.usage?.cache_read_input_tokens ?? 0) * 0.1 + (res.usage?.cache_creation_input_tokens ?? 0) * 1.25;
      usage.output_tokens += res.usage?.output_tokens ?? 0;
      messages.push({ role: 'assistant', content: res.content });
      const uses = res.content.filter((b) => b.type === 'tool_use');
      if (!uses.length) { messages.push({ role: 'user', content: 'Please finish by calling answer.' }); continue; }
      const results = [];
      for (const b of uses) {
        onEvent({ type: 'tool', name: b.name, input: b.input });
        if (b.name === 'answer') {
          attempts += 1;
          verification = verifyAnswer(b.input, tools);
          onEvent({ type: 'verification', attempt: attempts, ...verification });
          if (verification.passed || attempts >= maxAttempts) { final = b.input; results.push({ type: 'tool_result', tool_use_id: b.id, content: verification.passed ? 'Accepted.' : 'Rejected.' }); }
          else results.push({ type: 'tool_result', tool_use_id: b.id, is_error: true, content: `Not accepted. Fix these and call answer again:\n${verification.errors.map((e) => `- ${e.message}`).join('\n')}` });
          continue;
        }
        try { results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(tools.call(b.name, b.input)) }); }
        catch (err) { results.push({ type: 'tool_result', tool_use_id: b.id, is_error: true, content: String(err.message ?? err) }); }
      }
      if (!final) messages.push({ role: 'user', content: results });
    }
    const cost = Number(((usage.input_tokens * inPrice + usage.output_tokens * outPrice) / 1e6).toFixed(4));
    total.input_tokens += Math.round(usage.input_tokens); total.output_tokens += usage.output_tokens; total.cost_usd = Number((total.cost_usd + cost).toFixed(4));
    const passed = !!verification?.passed;
    if (final && passed) {
      history.push({ role: 'user', content: question });
      history.push({ role: 'assistant', content: `${final.answer}${final.caveats.length ? `\n\nCaveats: ${final.caveats.map((c) => `${c.channel} (${c.period}): ${c.note}`).join(' ')}` : ''}` });
    }
    return {
      answer: passed ? final.answer : "I couldn't produce an answer that passed the checks, so I'm not showing one. Try asking in a different way.",
      caveats: passed ? final.caveats : [],
      verified: passed,
      errors: passed ? [] : verification?.errors ?? [{ rule: 'A0', message: 'No answer was given.' }],
      attempts, usage: { ...usage, input_tokens: Math.round(usage.input_tokens), cost_usd: cost },
    };
  }

  return { ask, total, tools };
}
