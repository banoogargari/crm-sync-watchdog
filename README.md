# CRM Sync Watchdog

An AI agent that reconciles the **marketing automation platform**, the **CRM** and **billing**, finds where marketing attribution breaks, and answers questions about pipeline and revenue.

> 🚧 Work in progress. See [SPEC.md](SPEC.md) for the full plan.

## Status

- [x] Spec
- [x] Test data: five quarters of a fake B2B company, 9 scenarios with answer keys
- [x] Attribution (as reported / if fixes are approved), the six checks and influence by program, checked against the answer keys
- [x] Agent (Claude investigates through 8 tools), verifier and report (HTML + Markdown + fix files)
- [ ] Eval with the real model (results table here)
- [ ] Phase 2: chat

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
3. **A verifier checks Claude before anything is published:** every problem covered (V1); no affected channel shown as trusted (V2); every channel that changes is explained by exactly the problems that move it (V3); every number in the text came from a tool (V4); no text uses the internal codes C1…C6, so a CMO can read it (V5). If a rule fails, Claude gets the reasons and tries again.
4. **Nothing is changed in any system.** Fixes are proposals in CSV files for a person to approve.

Scenarios: `clean`, `unsynced-campaign`, `status-not-synced`, `utm-dropped`, `duplicates`, `no-contact-role`, `amount-mismatch`, `everything`, `subtle`.

## Known limitations

- **Dating a small UTM break:** when only a few form fills lose their UTM, normal direct traffic (people typing the URL) makes the exact start date fuzzy. In the `subtle` scenario the detected date is about 10 days early; the tests allow 14 days.
