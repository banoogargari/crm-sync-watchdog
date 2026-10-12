// A scripted stand-in for Claude in the chat, for tests and free --sim runs.
// It answers every question with Q3 2026 pipeline by channel (Events), and can
// be told to forget the caveat first, to show the verifier catching it.
const usd = (n) => `$${n.toLocaleString('en-US')}`;

export function makeChatSimClient({ forgetCaveatFirst = false } = {}) {
  let id = 0;
  let answered = 0;
  const call = (name, input = {}) => ({ type: 'tool_use', id: `tu_${++id}`, name, input });
  const reply = (content) => ({ content, usage: { input_tokens: 0, output_tokens: 0 } });
  return {
    messages: {
      async create({ messages }) {
        const last = messages[messages.length - 1];
        if (typeof last.content === 'string') return reply([call('get_metrics', { period: 'Q3-2026' }), call('get_metrics', { period: 'Q3-2026', view: 'if_fixes_approved' })]);
        const results = Object.fromEntries(last.content.filter((r) => r.type === 'tool_result' && !r.is_error).map((r) => [r.tool_use_id, JSON.parse(r.content)]));
        const prev = messages[messages.length - 2].content.filter((b) => b.type === 'tool_use');
        const rep = prev.find((b) => b.name === 'get_metrics' && !b.input.view);
        const fix = prev.find((b) => b.name === 'get_metrics' && b.input.view);
        if (!rep) return reply([call('answer', { answer: 'Retrying.', caveats: [] })]);
        const r = results[rep.id], f = results[fix.id];
        answered += 1;
        const caveats = forgetCaveatFirst && answered === 1 ? [] : [{ period: 'Q3-2026', channel: 'Events', note: `Likely understated by a data problem: ${usd(f.channels.Events.pipeline_created)} if fixes are approved.` }];
        return reply([call('answer', { answer: `Events created ${usd(r.channels.Events.pipeline_created)} of pipeline in Q3 2026, as reported today.`, caveats })]);
      },
    },
  };
}
