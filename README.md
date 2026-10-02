# PayBridge

> **Educational Sandbox — No Real Money Movement.**
> PayBridge is a simulation built for learning and portfolio purposes. It does not move money, connects to no bank or payment rail, is not a licensed financial product and claims no regulatory compliance. All providers are mocks and all data is fictional.

A simulated UAE → India SME cross-border payments platform: company onboarding and KYB, beneficiaries, AED → INR quotes, payment orders with maker-checker and compliance gating, a double-entry ledger, a mock payout provider with signed webhooks, three-way reconciliation and an immutable audit trail.

## Status

**Phase 0 (product definition) complete. No application code exists yet.** The repository currently contains the design documents and a validated Prisma schema proposal. Setup instructions will be added here in Phase 1, when there is something to run.

## Documents

| Document | Contents |
|---|---|
| [00-REQUIREMENTS-ANALYSIS](docs/00-REQUIREMENTS-ANALYSIS.md) | Ambiguities, gaps, risks and the defaults chosen |
| [BRD](docs/BRD.md) | Business problem, objectives, scope, rules, risks |
| [PRD](docs/PRD.md) | Functional and non-functional requirements, user stories, acceptance criteria, permission matrix, invariants |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | System and component design, domain model, state machines, event and webhook flow, project structure |
| [DATABASE](docs/DATABASE.md) | ERD, tables, constraints, indexes, money precision, transaction strategy |
| [API](docs/API.md) | Endpoints, schemas, errors, idempotency, webhook contract |
| [LEDGER](docs/LEDGER.md) | Chart of accounts, FX formulas, posting rules, invariants |
| [COMPLIANCE](docs/COMPLIANCE.md) | Rules engine, mock KYB/sanctions/PEP, review workflow |
| [SECURITY](docs/SECURITY.md) | Authentication, authorisation, tenant isolation, threat model |
| [RECONCILIATION](docs/RECONCILIATION.md) | Three-way matching, reason codes, report |
| [TESTING](docs/TESTING.md) | Test levels, mandatory invariant tests, failure scenarios |
| [DEPLOYMENT](docs/DEPLOYMENT.md) | Docker Compose, configuration, CI, migrations |
| [IMPLEMENTATION-PLAN](docs/IMPLEMENTATION-PLAN.md) | Six-week schedule |
| [BACKLOG](docs/BACKLOG.md) | Epics → stories → tasks → acceptance criteria, prioritised |

Schema proposal: [packages/database/prisma/schema.prisma](packages/database/prisma/schema.prisma).

## Planned stack

Next.js · TypeScript · Tailwind · TanStack Query · React Hook Form · Zod — NestJS · Prisma · PostgreSQL · Redis · BullMQ · Swagger — Jest · Supertest · Playwright — Docker Compose · GitHub Actions.
