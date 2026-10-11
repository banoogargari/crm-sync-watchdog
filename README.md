# CRM Sync Watchdog

An AI agent that reconciles the **marketing automation platform**, the **CRM** and **billing**, finds where marketing attribution breaks, and answers questions about pipeline and revenue.

> 🚧 Work in progress. See [SPEC.md](SPEC.md) for the full plan.

## Status

- [x] Spec
- [x] Test data: five quarters of a fake B2B company, 9 scenarios with answer keys
- [ ] Attribution, the six checks and the influence report, tested against the answer keys
- [ ] Agent, verifier and report
- [ ] Eval
- [ ] Phase 2: chat

## Run it

```bash
npm run seed     # (re)generate the test scenarios in evals/scenarios/
```
