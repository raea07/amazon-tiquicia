# Yuntera documentation

This is the plan for Yuntera, and the description of what has been built: a
marketplace for Costa Rican sellers with its own warehouse and delivery
drivers, launching in the Gran Área Metropolitana (GAM). It is written for a
solo founder working with AI tooling and little capital, so every phase is
gated by evidence rather than by dates.

**Where things stand.** The domain logic, the database and the shopper
storefront are built and tested on a local machine. The seller centre is
built; the operations console and the mobile web app for drivers and the
warehouse are in progress. **Nothing is deployed, and nothing has been run
against the real hosting platforms.** No domain, company, payment gateway or
cloud project exists yet. The repository's `STATUS.md`, when present, has the
latest state; these documents say for each thing whether it is built,
specified only, or planned.

## Read these first

1. [`00-strategy/market-and-wedge.md`](00-strategy/market-and-wedge.md) — why
   this can win, and where it cannot.
2. [`01-product/roadmap.md`](01-product/roadmap.md) — what gets built and
   operated in which order, and what must be true before moving on.
3. [`08-open-questions.md`](08-open-questions.md) — the decisions only the
   owner, a lawyer or an accountant can make, with the defaults the plan
   assumes until they do.
4. [`02-architecture/overview.md`](02-architecture/overview.md) — how the
   system fits together, and what is and is not built.
5. [`07-deployment/go-live-checklist.md`](07-deployment/go-live-checklist.md)
   — everything between this repository and a real order.

## Index

### Strategy and product

| Document                                                                     | What it covers                                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`00-strategy/market-and-wedge.md`](00-strategy/market-and-wedge.md)         | The Costa Rican e-commerce landscape, shopper complaints, Yuntera's wedge and its limits               |
| [`00-strategy/business-model.md`](00-strategy/business-model.md)             | Revenue lines, unit economics per order, break-even logic, the three numbers that decide the model     |
| [`00-strategy/go-to-market.md`](00-strategy/go-to-market.md)                 | First sellers and shoppers, channels, the numbers that say it works, launch sequence, budget, risks    |
| [`00-strategy/rollout-plan.md`](00-strategy/rollout-plan.md)                 | Phases from today to the open launch, each with entry, exit test and what is switched on; zone rule    |
| [`00-strategy/team-structure.md`](00-strategy/team-structure.md)             | Roles, product access, cost at the legal minimum, headcount by level, hiring order and triggers        |
| [`00-strategy/pricing-strategy.md`](00-strategy/pricing-strategy.md)         | Proposed seller fees and shopper offers, benchmarks, unit economics, the month at four volumes         |
| [`00-strategy/owner-decisions.md`](00-strategy/owner-decisions.md)           | Every question for the owner, each asked once, grouped by when the answer is needed                    |
| [`../marketing/README.md`](../marketing/README.md)                           | Marketing and sales pieces in Spanish and English: message house, seller pitch, briefs, flyers, posts  |
| [`01-product/personas-and-journeys.md`](01-product/personas-and-journeys.md) | The five people the platform serves, the order journey across the apps, failure cases                  |
| [`01-product/scope-by-app.md`](01-product/scope-by-app.md)                   | Feature scope for each audience, split into Pilot, Launch and Later; what the mobile web app cannot do |
| [`01-product/pricing-and-fees.md`](01-product/pricing-and-fees.md)           | Proposed seller fees and shopper shipping policy; how ranking rules are disclosed                      |
| [`01-product/roadmap.md`](01-product/roadmap.md)                             | Phases 0–5 with exit criteria, and a "do not build yet" list                                           |

### Architecture

| Document                                                         | What it covers                                                                                                                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [`02-architecture/overview.md`](02-architecture/overview.md)     | System context, the apps, why a modular monolith on Postgres, request flow, caching, where logic lives, parity tests, scaling path, known gaps |
| [`02-architecture/decisions.md`](02-architecture/decisions.md)   | Sixteen decision records: context, decision, consequences — including what each one costs                                                      |
| [`02-architecture/repository.md`](02-architecture/repository.md) | Layout, package boundaries, commands, running locally from zero, what each test layer proves                                                   |

### Data

| Document                                                 | What it covers                                                                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [`03-data/data-model.md`](03-data/data-model.md)         | The schema by domain, with diagrams, lifecycles, and the rules the database enforces                                  |
| [`03-data/access-control.md`](03-data/access-control.md) | Roles, grants, row-level security, what each kind of user can do, the checklist for adding a function, and a real bug |
| [`03-data/api-reference.md`](03-data/api-reference.md)   | Every callable function: who may call it and what it returns                                                          |

### Algorithms

Each says what is built, what is specified but not wired in, the exact
formula, a worked example, what it deliberately does not use, and what to
measure before changing it.

| Document                                                                             | What it covers                                                                         |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| [`04-algorithms/search-ranking.md`](04-algorithms/search-ranking.md)                 | Query understanding, typo tolerance, text relevance, quality signals, the final score  |
| [`04-algorithms/featured-offer.md`](04-algorithms/featured-offer.md)                 | Which seller's offer a product page features, and how that is explained                |
| [`04-algorithms/delivery-promise.md`](04-algorithms/delivery-promise.md)             | The date shown next to "Llega…": cutoffs, handling, transit, holidays                  |
| [`04-algorithms/sourcing-and-inventory.md`](04-algorithms/sourcing-and-inventory.md) | Availability, reservation, which location ships, and the planner for several locations |
| [`04-algorithms/routing.md`](04-algorithms/routing.md)                               | Assigning stops to drivers and ordering them                                           |
| [`04-algorithms/fees-and-settlement.md`](04-algorithms/fees-and-settlement.md)       | The fee schedule, a seller's statement, the ledger, cash, returns and refunds          |
| [`04-algorithms/risk-and-trust.md`](04-algorithms/risk-and-trust.md)                 | Order risk rules, seller performance score, and the trust controls enforced today      |
| [`04-algorithms/recommendations.md`](04-algorithms/recommendations.md)               | "Bought together" and trending, from anonymous baskets                                 |

### Security and compliance

| Document                                                                                             | What it covers                                                                                           |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`05-security-compliance/compliance-costa-rica.md`](05-security-compliance/compliance-costa-rica.md) | Legal obligations mapped to the product; questions for a lawyer and an accountant                        |
| [`05-security-compliance/security-program.md`](05-security-compliance/security-program.md)           | Threat model, controls, what is in the repository today, and the security routine a solo founder can run |
| [`05-security-compliance/privacy.md`](05-security-compliance/privacy.md)                             | Who sees which personal data and why, retention, data-subject rights, consent drafts                     |

### Operations and deployment

| Document                                                                         | What it covers                                                                            |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`06-operations/logistics-playbook.md`](06-operations/logistics-playbook.md)     | Warehouse, dispatch, delivery, cash handling and the operating rhythm at pilot scale      |
| [`06-operations/customer-service.md`](06-operations/customer-service.md)         | Support channels, refund and return mechanics, disputes, the complaint mechanism          |
| [`07-deployment/environments.md`](07-deployment/environments.md)                 | The cost decision that comes first, the environments, settings, region, secrets           |
| [`07-deployment/runbook-first-deploy.md`](07-deployment/runbook-first-deploy.md) | Step by step from nothing to a working preview, and what changes for production           |
| [`07-deployment/go-live-checklist.md`](07-deployment/go-live-checklist.md)       | Payments, legal entity, invoicing, privacy, security, backups, monitoring, operations     |
| [`07-deployment/operations.md`](07-deployment/operations.md)                     | Backups and the restore drill, incident response, rotating keys, migrations policy, costs |

### Reference

| Document                                                                                     | What it covers                                                                                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [`08-open-questions.md`](08-open-questions.md)                                               | Owner decisions, unverified facts, and the assumptions written into the software, each with the default currently assumed |
| [`brand/naming.md`](brand/naming.md)                                                         | How the name Yuntera was chosen and what was verified                                                                     |
| [`research/costa-rica-fact-sheet.md`](research/costa-rica-fact-sheet.md)                     | Cited facts on tax, invoicing, consumer law, data protection, payments, logistics and the market                          |
| [`research/market-and-costs-2026-11.md`](research/market-and-costs-2026-11.md)               | Demand, competitors, seller costs, pricing benchmarks, wages, couriers and marketing rules, read 24 November 2026         |
| [`research/support-and-system-health-tools.md`](research/support-and-system-health-tools.md) | Support desk, system health and testing: what exists, the standard, build or buy, and a build specification               |
| [`research/english-translation-plan.md`](research/english-translation-plan.md)               | What adding English to every screen and message takes, and the recommended plan                                           |

## Conventions used in these documents

- **Numbers.** A figure is taken from the
  [fact sheet](research/costa-rica-fact-sheet.md) and linked to it, or computed
  by the code and reproducible from it, or labelled as an _assumption_. Prices
  of hosting platforms are published list prices as read in November 2026 and
  say so. There are no other kinds of numbers here.
- **Built, specified, planned.** _Built_ means the code exists and its tests
  pass locally. _Specified_ means the logic exists and is tested in
  `packages/core` but nothing calls it in a running flow. _Planned_ means
  neither. Where a document does not say, treat it as planned.
- **Code references.** Where logic exists, the document points at the file.
- **Language.** Prose is in English. Product terms, legal terms and interface
  copy are in Costa Rican Spanish, in the _usted_ register the brand uses.
- **Not legal or tax advice.** The compliance documents translate the research
  into product requirements. A Costa Rican lawyer and accountant must confirm
  them before launch; the questions to ask are listed at the end of
  [`compliance-costa-rica.md`](05-security-compliance/compliance-costa-rica.md)
  and in [open questions](08-open-questions.md).
