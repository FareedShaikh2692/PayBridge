# PayBridge — 6-Week Implementation Plan

> **Educational Sandbox — No Real Money Movement.**

Assumes one engineer. Each week ends with the phase exit routine from the brief: run tests · typecheck · lint · security checklist · database integrity check · update docs. Work follows the documentation-first rule: contract and acceptance criteria are updated before each module's code.

## Schedule

| Week | Phases | Deliverable | Exit criteria |
|---|---|---|---|
| **0** (done) | Phase 0 — Product definition | BRD, PRD, architecture, database, API, ledger, compliance, security, reconciliation, testing, deployment docs; schema proposal; backlog | Decisions A1 and A2 confirmed |
| **1** | Phase 1 — Foundation · Phase 2 — Auth and multi-tenancy | Monorepo, Compose, config, logging, health, CI. Users, companies, roles, permissions, JWT + refresh, tenant context, audit module | `docker compose up` yields healthy web + api. Register/login works. Permission matrix test and first tenant-isolation tests green |
| **2** | Phase 3 — KYB · Phase 4 — Beneficiaries · Phase 5 — FX quotes | KYB state machine and mock provider, admin review. Beneficiary CRUD with encryption and masking. Quote engine with expiry and immutability | Canonical quote vector passes. KYB gate blocks quoting. Beneficiary isolation tests green |
| **3** | Phase 7 — Ledger · Phase 6 — Payments | Chart of accounts, posting service, triggers, balances. Payment creation with idempotency, hold, state machine, maker-checker, cancel | Invariants I1–I4 and I7 green, including concurrency tests. Ledger is built **before** payments because payment creation posts a hold |
| **4** | Phase 8 — Compliance · Phase 9 — Provider simulation | Rules engine, sanctions/PEP mocks, review queue. Outbox, BullMQ jobs, mock provider, signed webhooks, capture/settle/reverse | Invariants I5 and I6 green. API-level demo scenario passes end to end via Supertest |
| **5** | Phase 10 — Reconciliation · Phase 11 — Frontend (part 1) | Recon engine, report API, seeded mismatches. Web: auth, layout, dashboard, company/KYB, beneficiaries, payment wizard, payment detail | One fixture test per reconciliation reason code. Maker can complete the wizard in the browser |
| **6** | Phase 11 — Frontend (part 2) · Phase 12 — Testing and hardening | Web: approvals, ledger, admin compliance, reconciliation, audit. Playwright suite, security sweep, failure scenarios, docs pass, README | Playwright demo scenario green in CI. All eight invariants green. Docs match the build |

## Sequencing notes

- **Ledger before payments.** The brief numbers payments as Phase 6 and ledger as Phase 7, but a payment cannot be created correctly without posting a hold, and stubbing the ledger would mean writing payment code that is known to be wrong. Building the ledger first costs nothing and removes rework.
- **Audit and idempotency modules land in week 1–3** as cross-cutting infrastructure, because every later phase's definition of done depends on them.
- **Frontend is deliberately late.** The API-level demo scenario passing in week 4 is the real milestone; the UI then consumes a stable, typed contract.
- **A thin UI slice per phase is optional.** If visible progress matters more than throughput, each backend phase can ship its one or two pages immediately; this moves roughly three days of frontend work earlier and makes week 6 lighter.

## Critical path

```
Foundation → Auth/Tenancy → KYB → Quotes → Ledger → Payments → Provider/Webhooks → Reconciliation → Demo E2E
                                 ↘ Beneficiaries ↗            ↘ Compliance ↗
```

## Risk buffer

Week 6 carries the buffer. If time runs short, cut in this order (all P1/P2): compliance rule editing UI → KYB documents → dashboard charts → webhook replay UI → RLS → KYB expiry job. Nothing P0 is cuttable: P0 is exactly the demo scenario plus the eight invariants.

## Prerequisite before week 1

Docker is not currently installed on the development machine. Install Docker Desktop before Phase 1, or Phase 1's one-command start cannot be built and verified. Node 24 and pnpm 10 are already present.
