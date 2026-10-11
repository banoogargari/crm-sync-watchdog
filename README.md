# CRM Sync Watchdog

An AI agent that reconciles the **marketing automation platform**, the **CRM** and **billing**, finds where marketing attribution breaks, and answers questions about pipeline and revenue.

> 🚧 Work in progress. See [SPEC.md](SPEC.md) for the full plan.

## Status

- [x] Spec
- [x] Test data: five quarters of a fake B2B company, 9 scenarios with answer keys
- [x] Attribution (as reported / if fixes are approved), the six checks and influence by program: 53 tests against the answer keys
- [ ] Agent, verifier and report
- [ ] Eval
- [ ] Phase 2: chat

## Run it

```bash
npm test                        # check every number against the answer keys (no API key needed)
npm run checks -- everything    # see what the checks find in one scenario (no AI)
npm run seed                    # regenerate the test scenarios in evals/scenarios/
```

Scenarios: `clean`, `unsynced-campaign`, `status-not-synced`, `utm-dropped`, `duplicates`, `no-contact-role`, `amount-mismatch`, `everything`, `subtle`.

## Known limitations

- **Dating a small UTM break:** when only a few form fills lose their UTM, normal direct traffic (people typing the URL) makes the exact start date fuzzy. In the `subtle` scenario the detected date is about 10 days early; the tests allow 14 days.
