# Yuntera documentation

This is the plan for Yuntera: a marketplace for Costa Rican sellers with its own
warehouse and delivery drivers, launching in the Gran Área Metropolitana (GAM).
It is written for a solo founder working with AI tooling and little capital, so
every phase is gated by evidence rather than by dates.

## Read these three first

1. [`00-strategy/market-and-wedge.md`](00-strategy/market-and-wedge.md) — why
   this can win, and where it cannot.
2. [`01-product/roadmap.md`](01-product/roadmap.md) — what gets built and
   operated in which order, and what must be true before moving on.
3. [`08-open-questions.md`](08-open-questions.md) — the decisions only the
   owner, a lawyer or an accountant can make, with the defaults the plan assumes
   until they do.

## Index

| Path                                                                                                 | What it covers                                                                                                     |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [`00-strategy/market-and-wedge.md`](00-strategy/market-and-wedge.md)                                 | The Costa Rican e-commerce landscape, shopper complaints, Yuntera's wedge and its limits                           |
| [`00-strategy/business-model.md`](00-strategy/business-model.md)                                     | Revenue lines, unit economics per order, break-even logic, the three numbers that decide the model                 |
| [`01-product/personas-and-journeys.md`](01-product/personas-and-journeys.md)                         | The five people the platform serves, the order journey across all apps, failure cases                              |
| [`01-product/scope-by-app.md`](01-product/scope-by-app.md)                                           | Feature scope for each app, split into Pilot, Launch and Later                                                     |
| [`01-product/pricing-and-fees.md`](01-product/pricing-and-fees.md)                                   | Proposed seller fees and shopper shipping policy; how ranking rules are disclosed                                  |
| [`01-product/roadmap.md`](01-product/roadmap.md)                                                     | Phases 0–5 with exit criteria, and a "do not build yet" list                                                       |
| `02-architecture/`                                                                                   | System design, bounded contexts, technology decisions and scale path _(written by the engineering workstream)_     |
| `03-data/`                                                                                           | Data model, row-level security, events and analytics _(engineering workstream)_                                    |
| `04-algorithms/`                                                                                     | Search ranking, featured offer, sourcing, delivery promise, routing, risk, seller score _(engineering workstream)_ |
| [`05-security-compliance/compliance-costa-rica.md`](05-security-compliance/compliance-costa-rica.md) | Legal obligations mapped to the product; questions for a lawyer and an accountant                                  |
| [`05-security-compliance/security-program.md`](05-security-compliance/security-program.md)           | Threat model, controls and the security routine a solo founder can run                                             |
| [`05-security-compliance/privacy.md`](05-security-compliance/privacy.md)                             | Who sees which personal data and why, retention, data-subject rights, consent drafts                               |
| [`06-operations/logistics-playbook.md`](06-operations/logistics-playbook.md)                         | Warehouse, dispatch, delivery, cash handling and the operating rhythm at pilot scale                               |
| [`06-operations/customer-service.md`](06-operations/customer-service.md)                             | Support channels, refund and return mechanics, disputes, the complaint mechanism                                   |
| `07-deployment/`                                                                                     | Environments, CI/CD, runbooks and cost of running the platform _(engineering workstream)_                          |
| [`08-open-questions.md`](08-open-questions.md)                                                       | Owner decisions and unverified facts, each with the default currently assumed                                      |
| [`brand/naming.md`](brand/naming.md)                                                                 | How the name Yuntera was chosen and what was verified                                                              |
| [`research/costa-rica-fact-sheet.md`](research/costa-rica-fact-sheet.md)                             | Cited facts on tax, invoicing, consumer law, data protection, payments, logistics and the market                   |

## Conventions used in these documents

- **Numbers.** A figure is either taken from the
  [fact sheet](research/costa-rica-fact-sheet.md) and linked to it, or it is
  labelled _assumption to validate_. There are no other kinds of numbers here.
- **Code references.** Where logic already exists, the document points at the
  file (for example `packages/core/src/fees.ts`). Anything not pointed at is a
  plan, not something built.
- **Language.** Prose is in English. Product terms, legal terms and example
  interface copy are in Costa Rican Spanish, in the _usted_ register the brand
  uses.
- **Not legal or tax advice.** The compliance documents translate the research
  into product requirements. A Costa Rican lawyer and accountant must confirm
  them before launch; the questions to ask are listed at the end of
  [`compliance-costa-rica.md`](05-security-compliance/compliance-costa-rica.md).
