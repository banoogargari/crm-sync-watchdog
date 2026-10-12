#!/usr/bin/env node
// Chat with your marketing data in the terminal.
//   npm run chat                 real Claude (needs ANTHROPIC_API_KEY in .env)
//   npm run chat -- --sim        scripted stand-in (free)
//   npm run chat -- --budget 0.50   stop when this session has cost $0.50 (default $1.00)
import 'dotenv/config';
import { parseArgs } from 'node:util';
import readline from 'node:readline';
import { stdin, stdout } from 'node:process';
import Anthropic from '@anthropic-ai/sdk';
import { loadScenario } from '../src/sources/files.js';
import { createChat } from '../src/chat/agent.js';
import { makeChatSimClient } from '../src/chat/sim-client.js';

const { values: args } = parseArgs({ options: { scenario: { type: 'string', default: 'everything' }, sim: { type: 'boolean', default: false }, model: { type: 'string' }, budget: { type: 'string', default: '1.00' }, verbose: { type: 'boolean', default: false } } });
const model = args.sim ? 'simulated' : args.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5';
if (!args.sim && !process.env.ANTHROPIC_API_KEY) { console.error('No ANTHROPIC_API_KEY found in .env. Use --sim to try it for free.'); process.exit(1); }
const budget = Number(args.budget);

const { truth, ...data } = loadScenario(args.scenario);
const chat = createChat({ client: args.sim ? makeChatSimClient() : new Anthropic(), model, data });
const rl = readline.createInterface({ input: stdin, output: stdout });

console.log(`\nAsk about MQLs, pipeline, won ARR, win rate, channels and programs (data: test scenario "${args.scenario}", ${model}).`);
console.log('Examples: "Was Q3 better than Q2?"  "How much pipeline did events create in Q3?"  "Which accounts engaged with 6sense ads but have no opportunity?"');
console.log('Type "exit" to stop.\n');

rl.setPrompt('You: ');
rl.prompt();
for await (const line of rl) {
  const q = line.trim();
  if (!q) { rl.prompt(); continue; }
  if (/^(exit|quit|bye)$/i.test(q)) break;
  if (chat.total.cost_usd >= budget) { console.log(`\nThis session reached its $${budget.toFixed(2)} budget. Start a new one with a higher --budget if you need more.\n`); break; }
  const res = await chat.ask(q, { onEvent: (e) => {
    if (!args.verbose) return;
    if (e.type === 'tool') console.log(`   → ${e.name} ${e.name === 'answer' ? '' : JSON.stringify(e.input)}`);
    if (e.type === 'verification' && !e.passed) console.log(`   ✗ checker: ${e.errors.map((x) => x.message).join(' | ')}`);
  } });
  console.log(`\nClaude: ${res.answer}`);
  for (const c of res.caveats) console.log(`  ⚠️  ${c.channel === 'all' ? '' : `${c.channel}, `}${c.period}: ${c.note}`);
  console.log(`  (${res.verified ? '✓ checked' : '✗ not shown: failed the checks'}${res.attempts > 1 ? ` after ${res.attempts} tries` : ''} · $${res.usage.cost_usd} · session $${chat.total.cost_usd})\n`);
  rl.prompt();
}
rl.close();
