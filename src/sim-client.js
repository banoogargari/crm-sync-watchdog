// A scripted stand-in for Claude, used by the tests and by `--sim` runs.
// It calls the same tools in the same loop as the real model, so the whole
// pipeline (tools -> verifier -> report) can be tested for free, without an API key.
// With { mistakeFirst: true } its first submission is deliberately wrong, to
// show the verifier catching it and the agent correcting itself.

const usd = (n) => `$${n.toLocaleString('en-US')}`;

export function makeSimClient({ mistakeFirst = false } = {}) {
  let submitted = 0;
  let id = 0;
  const call = (name, input = {}) => ({ type: 'tool_use', id: `tu_${++id}`, name, input });
  const reply = (content) => ({ content, stop_reason: 'tool_use', usage: { input_tokens: 0, output_tokens: 0 } });

  const resultsSoFar = (messages) => {
    const out = {};
    const calls = new Map();
    for (const m of messages) {
      if (m.role === 'assistant') for (const b of m.content) if (b.type === 'tool_use') calls.set(b.id, b);
      if (m.role === 'user' && Array.isArray(m.content)) {
        for (const r of m.content) {
          const c = calls.get(r.tool_use_id);
          if (c && !r.is_error) out[`${c.name}:${c.input.view ?? c.input.measure ?? c.input.check ?? ''}`] = JSON.parse(r.content);
        }
      }
    }
    return out;
  };

  return {
    messages: {
      async create({ messages }) {
        const step = messages.filter((m) => m.role === 'assistant').length;
        if (step === 0) {
          return reply([
            call('run_checks'),
            call('get_revenue_by_channel', { view: 'reported' }), call('get_revenue_by_channel', { view: 'if_fixes_approved' }),
            call('get_what_moved', { measure: 'pipeline_created' }), call('get_what_moved', { measure: 'closed_won_arr' }),
          ]);
        }
        const r = resultsSoFar(messages);
        const summary = r['run_checks:'];
        const problems = summary.checks.filter((c) => c.status === 'issue');
        if (step === 1 && problems.length) return reply(problems.map((c) => call('get_check_details', { check: c.check })));

        const channels = [...new Set([...r['get_revenue_by_channel:reported'].channels, ...r['get_revenue_by_channel:if_fixes_approved'].channels].map((x) => x.channel))];
        const affected = summary.affected_channels;
        const issues = problems.map((c) => ({
          check: c.check,
          title: c.plain_name,
          what_happened: c.check === 'C3' && c.sudden_change
            ? `Form fills with no UTM and no clues rose from ${c.sudden_change.unexplained_share_before} to ${c.sudden_change.unexplained_share_after} starting ${c.sudden_change.start_date}.`
            : c.check === 'C6' ? `${c.deals_with_issue} won deals do not match billing.` : `${c.plain_name}: ${c.opportunities} opportunities affected.`,
          impact: c.check === 'C6' ? `Won ARR is overstated by ${usd(c.overstated_arr)}.` : `${usd(c.pipeline_created)} of pipeline is credited to the wrong channel or to no channel.`,
          recommended_action: 'Review the proposed fix file and apply it if correct.',
          needs_human_review: ['C3', 'C5', 'C6'].includes(c.check),
        }));
        const explanations = new Map();
        for (const measure of ['pipeline_created', 'closed_won_arr']) {
          for (const row of r[`get_what_moved:${measure}`].channels) {
            const causes = Object.keys(row.change_by_check);
            const prev = explanations.get(row.channel) ?? new Set();
            causes.forEach((x) => prev.add(x));
            explanations.set(row.channel, prev);
          }
        }
        const plain = Object.fromEntries(summary.checks.map((c) => [c.check, c.plain_name.toLowerCase()]));
        const channel_explanations = [...explanations].map(([channel, causes]) => ({ channel, problems: [...causes].sort(), explanation: `Changes because of: ${[...causes].sort().map((c) => plain[c]).join(', ')}.` }));
        const channel_trust = channels.map((ch) => ({ channel: ch, trusted: !affected[ch], reason: affected[ch] ? `affected by: ${affected[ch].map((c) => plain[c]).join(', ')}` : 'no open issues' }));
        submitted += 1;
        if (mistakeFirst && submitted === 1) {
          const firstAffected = channel_trust.find((t) => !t.trusted);
          if (firstAffected) firstAffected.trusted = true;
          if (issues[0]) issues[0].impact += ' Roughly $1,234,567 in total.';
          channel_explanations.pop();
          if (issues[1]) issues[1].impact += ` See ${issues[1].check}.`;
        }
        const headline = problems.length
          ? `Pipeline and ARR by channel cannot be fully trusted: ${problems.length} checks found problems.`
          : 'No problems found; pipeline and ARR by channel can be trusted.';
        return reply([call('submit_findings', { headline, issues, channel_explanations, channel_trust })]);
      },
    },
  };
}
