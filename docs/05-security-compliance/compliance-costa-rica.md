# Compliance in Costa Rica

This document turns Costa Rican law into product requirements. It covers
consumer protection, the new digital-services law, IVA and electronic
invoicing, reporting to Hacienda, personal data, and the employment status of
couriers, and it ends with the questions a lawyer and an accountant must
answer. It is a translation of the research into design decisions, **not legal
or tax advice**; every legal statement traces to the
[fact sheet](../research/costa-rica-fact-sheet.md), which records its source
and confidence.

Status vocabulary used below: **designed** means the plan and, where noted, the
code already account for it; **needs lawyer** and **needs accountant** mean the
requirement depends on an answer nobody on the project is qualified to give.

## 1. Consumer protection (Ley 7472 and its reglamento)

Source: [fact sheet, section 3](../research/costa-rica-fact-sheet.md#3-consumer-protection).

**Right of withdrawal (_derecho de retracto_).** The shopper may withdraw from a
distance sale within 8 business days counted from the sale, through the same
channel used to buy, and must be refunded within 8 calendar days by the same
payment method. Exceptions: used consumables, perishables, made-to-measure
goods, special-order imports, services already rendered.

- _Product decision:_ Yuntera counts the 8 business days **from delivery**, not
  from the sale. That is always at least what the law requires and is the only
  version that makes sense to a shopper. Withdrawal is requested from the order
  page, without a reason. The refund clock starts at the request, not at the
  return of the goods, unless the lawyer advises otherwise.
- _Open point:_ "the same payment method" for an order paid in cash at the door.

**Legal warranty.** At least 30 business days from delivery; the burden of
proof is on the merchant.

- _Product decision:_ every product page states the legal warranty. A claim is
  opened from the order page. Yuntera resolves the claim with the shopper first
  and settles with the seller afterwards, because the shopper bought on Yuntera
  and whether the marketplace is jointly liable is not yet confirmed.

**Total price.** The price shown must include taxes, shipping and every charge,
with a breakdown.

- _Product decision:_ prices are stored and shown IVA-inclusive
  (`packages/core/src/money.ts`); the delivery charge for the shopper's zone is
  shown on the product page; the checkout summary breaks the total into items,
  IVA included, and delivery.

**Before confirming.** An order summary, with no pre-ticked options.

- _Product decision:_ a review step precedes the pay button. Marketing consent,
  add-ons and any optional charge are unticked by default, everywhere.

**Durable receipt.** _Product decision:_ an order confirmation by email that
stands on its own (items, prices, seller identity, delivery date, withdrawal
and warranty terms), also available in the account.

**Mandatory disclosures.** Merchant identity (legal name, cédula jurídica,
address, phone, email), terms in Spanish, payment and delivery procedures,
complaint channel, withdrawal conditions, payment-security information.

- _Product decision:_ a legal footer and terms pages for Yuntera itself, and on
  every product page the seller's legal name and identification, since the
  shopper must be able to identify who they are buying from.

**Reviews.** Positive and negative reviews must be published.

- _Product decision:_ reviews are moderated only for illegal content, personal
  data and off-topic text, never for sentiment. The moderation rule is public.

**Promised delivery date.** Missing it is a breach that entitles the shopper to
a full refund; if no date is given, delivery is due within 24 hours.

- _Product decision:_ a date is always shown and is computed conservatively
  (`packages/core/src/promise.ts`: cutoff, working days, holidays, capacity).
  When an order is going to be late, the shopper is told before the date and
  offered a refund. On-time delivery is the first operating metric.

**Complaints.** A free complaint mechanism is required. See
[customer service](../06-operations/customer-service.md).

## 2. Ley 10946 — digital services and electronic commerce

Published 24 June 2026; in force about **24 June 2027**; regulations still
pending. Source:
[fact sheet, section 3](../research/costa-rica-fact-sheet.md#3-consumer-protection).

| Duty                                                                                   | Product decision                                                                                                                         |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting safe harbour applies only without actual knowledge; no general monitoring duty | Do not promise to pre-screen everything. Do act on what is reported or noticed, and record that action                                   |
| Notice-and-action                                                                      | A "Reportar" control on every listing and review; a queue in Yuntera Central; a reasoned decision sent to the reporter and the seller    |
| Internal complaint system                                                              | A seller or shopper can contest a moderation or suspension decision and get a human answer                                               |
| Removal of illegal products and buyer notification on judicial order                   | Ability to withdraw a listing and message everyone who bought it                                                                         |
| The consumer can always identify and contact the seller                                | Seller legal identity on product page, order and receipt; suspension of sellers whose identity cannot be verified                        |
| Advertising transparency                                                               | Sponsored results labelled _Patrocinado_                                                                                                 |
| Recommender transparency                                                               | The main parameters of search ranking and featured-offer selection are published ([pricing and fees](../01-product/pricing-and-fees.md)) |
| No dark patterns                                                                       | Design rule for every app ([scope by app](../01-product/scope-by-app.md))                                                                |

MEIC-registered SMEs are excluded from one chapter of the law. Whether Yuntera
would qualify, and whether to rely on that, is a lawyer question; the plan is
to comply regardless, because the duties are also good practice and the
exemption disappears with growth.

## 3. IVA and electronic invoicing

Sources:
[fact sheet, section 1](../research/costa-rica-fact-sheet.md#1-tax-and-iva) and
[section 2](../research/costa-rica-fact-sheet.md#2-electronic-invoicing).

**Rates.** 13% general; 4%, 2% and 1% reduced rates for defined goods and
services. The rate is a property of each product, set by the seller and their
accountant, never guessed by the platform (`IVA` in
`packages/core/src/money.ts`).

**Who issues what.** The research found no marketplace-specific rule: the
taxpayer who makes the sale issues the document. The working model is
therefore:

| Transaction                     | Issuer                      | Receiver      | Document                                                                   |
| ------------------------------- | --------------------------- | ------------- | -------------------------------------------------------------------------- |
| Sale of the product             | Seller                      | Shopper       | `01` factura electrónica, or `04` tiquete electrónico for a final consumer |
| Yuntera's commission and fees   | Yuntera                     | Seller        | `01` factura electrónica, with 13% IVA                                     |
| Delivery charged to the shopper | Yuntera                     | Shopper       | `04` tiquete or `01` factura, with 13% IVA                                 |
| Refund or cancellation          | Whoever issued the original | Same receiver | `03` nota de crédito                                                       |

Version 4.4 of the electronic documents has been mandatory since 1 September
2025. Payment-method codes that matter here: `01` cash, `02` card, `04`
transfer, `05` collected by third parties, `06` SINPE Móvil, `07` Plataforma
Digital. Which code a seller should use when Yuntera collects the money on
their behalf is an accountant question.

Operating rules that shape the product: the document is delivered to the buyer
at the time of sale; a rejected document is void and must be reissued; records
are kept five years.

- _Pilot:_ each seller issues from the invoicing system they already use and
  records the document key against the order. Yuntera issues its own fee
  invoices from a commercial invoicing provider.
- _Launch:_ issuance on the seller's behalf through an integrated provider, if
  the accountant confirms it is permitted and sellers want it.
- _Sellers under the Régimen Simplificado_ do not charge IVA and issue invoices
  only on request. Their listings must say so, because a business shopper who
  needs a deductible invoice has to know before buying.

**Card withholdings.** Acquirers withhold up to 6% of the net sale on account
of IVA and 2% on account of income tax. Who bears these depends on who is the
merchant of record when Yuntera collects for sellers. Accountant question; it
also bears on the choice of gateway.

## 4. Reporting sellers to Hacienda

Resolution MH-DGT-RES-0025-2024 requires platform operators domiciled in Costa
Rica to perform due diligence on their sellers and report their identities and
the amounts they earned, annually. The first report, for 2025, was due on
30 April 2026.

- _Product decision:_ seller onboarding collects and validates identification
  type and number, legal name and address from the first seller onward
  (`packages/core/src/cr/identity.ts` validates the shape; existence is to be
  checked against Hacienda's taxpayer lookup during onboarding). Per-seller annual totals of sales, fees
  and number of transactions must be producible on demand. Sellers are told at
  onboarding that this reporting happens.

## 5. SINPE Móvil number registration

Decreto 45953-H (16 October 2026) requires taxpayers to register with Hacienda
the SINPE Móvil numbers they use to collect payments; existing taxpayers have
12 months.

- _Product decision:_ Yuntera registers its own collection numbers. If a
  gateway collects on Yuntera's behalf, confirm with the accountant whose
  number is the registered one.

## 6. Personal data (Ley 8968)

Source: [fact sheet, section 4](../research/costa-rica-fact-sheet.md#4-personal-data).
Detailed handling is in [privacy](privacy.md).

- **Consent** must be prior, informed, express and written, which electronic
  acceptance satisfies. The notice names the purposes, the recipients, the
  rights and the controller. _Product decision:_ a privacy notice accepted at
  account creation, with separate unticked consent for marketing.
- **Breach notification** to the people affected within 5 business days.
  _Product decision:_ an incident runbook with that clock in it
  ([security program](security-program.md)).
- **Registration with PRODHAB** applies to databases administered for
  distribution or commercialisation. Yuntera does not sell personal data, so
  the working assumption is that registration is not required. Lawyer to
  confirm.
- **Transfers abroad** require the person's express authorisation, and there is
  no adequacy list. The platform runs on cloud providers outside Costa Rica.
  _Product decision:_ the privacy notice names the categories of provider and
  the countries, and asks for express consent to processing there; the database
  region nearest to Costa Rica is preferred. Whether hosting with a processor
  counts as a transfer in the legal sense is a lawyer question, and the plan
  does not depend on the answer being favourable.

## 7. Couriers and employment status

Source:
[fact sheet, section 7](../research/costa-rica-fact-sheet.md#7-last-mile-and-labour).

There is no statute for platform couriers. Two first-instance rulings have
found an employment relationship with a platform, and a bill creating a
presumption of employment awaits a floor vote. The direction of travel is
toward employment.

How the plan hedges:

1. **The cost model is meant to budget drivers as employees**, including
   employer social charges of 26.83%, so that reclassification would not break
   the unit economics. _Assumption to validate:_ the model's figure is a single
   assumed ₡45,000 per fully loaded driver-day
   ([business model](../00-strategy/business-model.md)); it has not been built
   up from an actual wage, charges, vehicle and fuel, and must be before it is
   relied on.
2. **The Pilot uses very few drivers**, engaged on whatever basis the lawyer
   approves in writing. The founder can drive.
3. **Carriers are the overflow and the fallback.** If own delivery becomes
   legally or economically unworkable, parcels move to carriers without
   changing the rest of the platform.
4. **The driver app does not manage people like employees by accident.** No
   penalties for declining, no exclusivity, no opaque deactivation; these are
   product choices that matter in a classification dispute, to be reviewed by
   the lawyer.

Work-risk insurance (INS) is mandatory for employers and available to
independents; no driver rides a Yuntera route without it either way.

## 8. Obligations mapped to the product

| Obligation                                                                      | Where it is met                                                            | Status                                                  |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------- |
| Withdrawal within 8 business days; refund in 8 calendar days by the same method | Order page request; refund policy; support process                         | Designed; cash refunds need lawyer                      |
| Legal warranty of 30 business days                                              | Product page notice; claim from the order page                             | Designed; marketplace liability needs lawyer            |
| Total price with breakdown                                                      | Product page, cart, checkout summary                                       | Designed                                                |
| Order summary, no pre-ticked options                                            | Checkout review step; design rule                                          | Designed                                                |
| Durable receipt                                                                 | Order confirmation email and account                                       | Designed                                                |
| Merchant and seller identity disclosed                                          | Footer and legal pages; product page; receipt                              | Designed; exact wording needs lawyer                    |
| Terms and conditions in Spanish                                                 | Legal pages                                                                | Needs lawyer                                            |
| Positive and negative reviews published                                         | Review moderation rule                                                     | Designed                                                |
| Promised date, refund if missed                                                 | Delivery promise; late-order handling                                      | Designed                                                |
| Free complaint mechanism                                                        | Complaint form and register                                                | Designed                                                |
| Ley 10946 duties (from mid-2027)                                                | Reporting control, moderation queue, published ranking rules, labelled ads | Designed; regulations pending, needs lawyer when issued |
| IVA rate per product                                                            | Product data set by the seller                                             | Designed; needs accountant for edge categories          |
| Seller invoices the shopper                                                     | Seller's own system in the Pilot; key recorded per order                   | Needs accountant                                        |
| Yuntera invoices sellers for fees                                               | Invoicing provider                                                         | Needs accountant                                        |
| Yuntera invoices delivery to the shopper                                        | Invoicing provider                                                         | Needs accountant                                        |
| Payment-method code when Yuntera collects                                       | Seller guidance                                                            | Needs accountant                                        |
| Card withholdings, merchant of record                                           | Gateway contract and payout model                                          | Needs accountant                                        |
| Seller due diligence and annual report                                          | Seller onboarding; annual totals                                           | Designed; report format needs accountant                |
| SINPE Móvil number registration                                                 | Company administration                                                     | Needs accountant                                        |
| Consent and privacy notice                                                      | Account creation; consent records                                          | Designed; texts need lawyer                             |
| Breach notice within 5 business days                                            | Incident runbook                                                           | Designed                                                |
| Cross-border processing consent                                                 | Privacy notice                                                             | Needs lawyer                                            |
| PRODHAB registration                                                            | Company administration                                                     | Needs lawyer                                            |
| Courier status                                                                  | Engagement contracts; cost model                                           | Needs lawyer                                            |
| Work-risk insurance for drivers                                                 | Driver onboarding checklist                                                | Needs lawyer                                            |

## 9. Questions for the lawyer

1. Is a marketplace jointly liable with the seller for warranty and withdrawal
   under Ley 7472, and does it change if Yuntera stores and delivers the goods?
2. For an order paid in cash on delivery, does a refund by SINPE Móvil or bank
   transfer satisfy "the same payment method", with the shopper's agreement?
3. May the shipping charge be withheld from the refund after two failed
   delivery attempts caused by the shopper? After a withdrawal?
4. Who pays return shipping on a withdrawal: may it be charged to the shopper?
5. Does hosting personal data with cloud providers abroad count as a transfer
   requiring express consent under Ley 8968, and is consent in the privacy
   notice sufficient?
6. Does Yuntera's database require registration with PRODHAB?
7. On what basis can the first drivers be engaged, given the rulings and the
   pending bill, and what must the contract and the app avoid?
8. Would Yuntera qualify for the SME exclusion in Ley 10946, and should it rely
   on it?
9. What must the terms and conditions, seller agreement and privacy notice
   contain, and can the drafts in [privacy](privacy.md) be used as a base?
10. Which trademark classes should be filed now?

## 10. Questions for the accountant

1. Which legal entity and tax regime for Yuntera itself?
2. When Yuntera collects payment on behalf of a seller, who is the taxpayer for
   the sale, and which payment-method code goes on the seller's document:
   `05`, `07`, or the shopper's actual method?
3. May Yuntera issue electronic documents on a seller's behalf, and under what
   authorisation?
4. How do the 6% IVA and 2% income-tax card withholdings apply when the
   gateway settles to Yuntera and Yuntera pays the seller? Does a
   connected-account gateway model change that?
5. Is the delivery charge to the shopper a separate service invoiced by Yuntera
   at 13%?
6. How should sellers under the Régimen Simplificado be handled, and can an
   online-only seller be in that regime at all?
7. What exactly must the annual platform report to Hacienda contain, in what
   format, and by when?
8. How are refunds, credit notes and commission reversals documented?
9. How should cash on delivery collected by drivers be recorded daily?
10. Whose SINPE Móvil number must be registered when a gateway collects?
