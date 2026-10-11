#!/usr/bin/env node
// Run the watchdog on one scenario and write the report.
//
//   npm run watchdog -- --scenario everything          (real Claude, needs ANTHROPIC_API_KEY in .env)
//   npm run watchdog -- --scenario everything --sim    (scripted stand-in, free, no key)
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { loadScenario } from './sources/files.js';
import { runAgent } from './agent.js';
import { writeReport } from './report.js';
import { makeSimClient } from './sim-client.js';

const { values: args } = parseArgs({
  options: {
    scenario: { type: 'string', default: 'everything' },
    sim: { type: 'boolean', default: false },
    out: { type: 'string' },
    model: { type: 'string' },
    quiet: { type: 'boolean', default: false },
  },
});

const model = args.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5';
if (!args.sim && !process.env.ANTHROPIC_API_KEY) {
  console.error('No ANTHROPIC_API_KEY found. Add it to .env, or run with --sim to use the scripted stand-in.');
  process.exit(1);
}

const { truth, ...data } = loadScenario(args.scenario);
const client = args.sim ? makeSimClient() : new Anthropic();
const log = args.quiet ? () => {} : (e) => {
  if (e.type === 'tool') console.log(`  → ${e.name}${Object.keys(e.input ?? {}).length && e.name !== 'submit_findings' ? ' ' + JSON.stringify(e.input).slice(0, 80) : ''}`);
  if (e.type === 'verification') console.log(e.passed ? '  ✓ verification passed' : `  ✗ verification failed (attempt ${e.attempt}):\n${e.errors.map((x) => `      [${x.rule}] ${x.message}`).join('\n')}`);
};

console.log(`CRM sync watchdog · scenario "${args.scenario}" · ${truth.report_quarter.label} · ${args.sim ? 'simulated agent' : model}`);
const run = await runAgent({ client, model: args.sim ? 'simulated' : model, data, quarter: truth.report_quarter, onEvent: log });

const dir = args.out ?? join('reports', `${args.scenario}-${new Date().toISOString().slice(0, 10)}`);
if (!run.findings) {
  console.error('The agent did not submit findings. No report written.');
  process.exit(1);
}
writeReport(run, { dir, source: `test scenario "${args.scenario}"`, data });
console.log(`\n${run.verification.passed ? 'Report' : 'Report (VERIFICATION FAILED — do not share)'}: ${join(dir, 'report.html')}`);
console.log(`${run.turns} turns · ${run.usage.input_tokens.toLocaleString()} input + ${run.usage.output_tokens.toLocaleString()} output tokens · $${run.usage.cost_usd}`);
process.exit(run.verification.passed ? 0 : 2);
