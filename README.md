# CRM Sync Watchdog

An AI agent that reconciles the **marketing automation platform**, the **CRM** and **billing**, finds where marketing attribution breaks, and answers questions about pipeline and revenue.

**[See an example report →](https://banoogargari.github.io/crm-sync-watchdog/)** written by the agent for the `everything` test scenario (all six problems at once).

> Phase 1 (the report) is complete. Phase 2 (a chat for the CMO) is next. See [SPEC.md](SPEC.md) for the full plan.

## Why I built this

I'm a Senior Marketing Operations & Developer Specialist. I build the systems behind our marketing reporting: Marketo, Salesforce, and how they connect to billing. Creating the reports isn't my job, but because I built the system, I'm usually the one who can see *why* a number looks wrong.

Two moments made me build this:

- **"What is the real marketing source?"** When we report pipeline, our CMO wants to know what marketing sourced. When a deal shows "no marketing source," she wants to know what the source really was. Usually marketing *did* touch it, and the data just didn't make it: an event that never synced to Salesforce, an attendance status that didn't update, a duplicate contact, a form that lost its UTM.
- **"What about ABM?"** A vendor reviewing our MQL reporting for content syndication and paid ads asked: what about our account-based programs, like LinkedIn ABA and 6sense? Our Salesforce reports are built for contact-based marketing, and account-based engagement never reaches the CRM. I wanted one view that shows both together.

What I want this agent to be:

- **Self-serve.** Campaign managers can pull results for their own campaigns and channels without waiting for an analyst.
- **A tool for the CMO.** At the end of the quarter she can ask, on her own: "With the pipeline we created, how much should marketing get credit for?"
- **Fair and honest.** Each channel gets its own credit. Nothing is mixed or counted twice, and duplicates are found. It never shows a number as trusted when the data behind it is broken.

## Status

- [x] Spec
- [x] Test data: five quarters of a fake B2B company, 9 scenarios with answer keys
- [x] Attribution (as reported / if fixes are approved), the six checks and influence by program, checked against the answer keys
- [x] Agent (Claude investigates through 8 tools), verifier and report (HTML + Markdown + fix files)
- [x] Eval with the real model: 18 of 18 problems found, 0 false alarms, 0 broken channels shown as trusted
- [ ] Phase 2: chat

## Results

The agent was run on all 9 test scenarios and graded against the answer keys (`npm run eval`).

| Scenario | Problems found | False alarms | Impact exact | Report exact (both views) | Affected channels shown as trusted | Passed verification (1st try) | Avg cost |
|---|---|---|---|---|---|---|---|
| amount-mismatch | 1/1 | 0 | 1/1 | 1/1 | 0 | 1/1 (1) | $0.075 |
| clean | 0/0 | 0 | 0/0 | 1/1 | 0 | 1/1 (1) | $0.054 |
| duplicates | 1/1 | 0 | 1/1 | 1/1 | 0 | 1/1 (1) | $0.067 |
| everything | 6/6 | 0 | 6/6 | 1/1 | 0 | 1/1 (1) | $0.125 |
| no-contact-role | 1/1 | 0 | 1/1 | 1/1 | 0 | 1/1 (1) | $0.063 |
| status-not-synced | 1/1 | 0 | 1/1 | 1/1 | 0 | 1/1 (1) | $0.076 |
| subtle | 6/6 | 0 | 6/6 | 1/1 | 0 | 1/1 (0) | $0.175 |
| unsynced-campaign | 1/1 | 0 | 1/1 | 1/1 | 0 | 1/1 (1) | $0.079 |
| utm-dropped | 1/1 | 0 | 1/1 | 1/1 | 0 | 1/1 (1) | $0.086 |
| **All** | **18/18 (100%)** | **0** | **18/18** | **9/9** | **0** | **9/9 (8)** | **$0.80 total** |

No-UTM form fills sorted into the right group: **16/16 (100%)** · ABM hint accuracy: **5/7 (71%)** (hints are never added to the numbers) · Influence by program exact: **9/9**

Model `claude-sonnet-5-5`, 1 run per scenario, 2026-10-11. Every success criterion in the [spec](SPEC.md#success-criteria-phase-1) is met. In the `subtle` scenario (small versions of all six problems) the verifier rejected the first submission and the agent corrected it, which is the verifier doing its job. The data is synthetic: a real Marketo + Salesforce + billing export will have problems these scenarios don't cover.

## Run it

```bash
npm install                                        # once
npm test                                           # 75 tests: every number against the answer keys (no API key needed)
npm run checks -- everything                       # what the checks find in one scenario (no AI)
npm run watchdog -- --scenario everything --sim    # the full pipeline with a scripted stand-in for Claude (free)
npm run watchdog -- --scenario everything          # the real agent (needs ANTHROPIC_API_KEY in .env, about $0.10-0.30)
npm run eval                                       # the agent on all 9 scenarios, graded against the answer keys
npm run seed                                       # regenerate the test scenarios in evals/scenarios/
```

The report is written to `reports/<scenario>-<date>/report.html`, with proposed fixes as CSV files in `fixes/`.

## How it works

1. **Code computes every number.** It loads the exports (marketing tool, CRM, billing, ad platforms), runs the six checks, and builds pipeline and ARR by channel twice: as reported today, and if the proposed fixes are approved. It also records which problem moves which opportunity to which channel.
2. **Claude investigates and explains.** Through 8 read-only tools it looks at each problem (which campaign, since when, example opportunities, the activity history behind a channel), then writes the headline, one explanation per problem, why each channel changes, and which channels can be trusted.
3. **A verifier checks Claude before anything is published:** every problem covered (V1); no affected channel shown as trusted (V2); every channel that changes is explained by exactly the problems that move it (V3); every number in the text came from a tool (V4); no text uses the internal codes C1…C6, so a CMO can read it (V5); the headline is at most 3 sentences and 60 words (V6). If a rule fails, Claude gets the reasons and tries again.
4. **Nothing is changed in any system.** Fixes are proposals in CSV files for a person to approve.

Scenarios: `clean`, `unsynced-campaign`, `status-not-synced`, `utm-dropped`, `duplicates`, `no-contact-role`, `amount-mismatch`, `everything`, `subtle`.

## What's next

- **A chat** for the CMO and campaign managers to ask questions in plain words
- **A live connection to Marketo and Salesforce** instead of exported files
- **Forecasting:** use this quarter's data to suggest a realistic pipeline target for next quarter

## Known limitations

- **Dating a small UTM break:** when only a few form fills lose their UTM, normal direct traffic (people typing the URL) makes the exact start date fuzzy. In the `subtle` scenario the detected date is about 10 days early; the tests allow 14 days.
