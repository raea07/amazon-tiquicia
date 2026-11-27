# Costa Rica fact sheet

Research date: **21 November 2026**. This is the evidence base for the plan:
each fact carries its source and a confidence level. It is **not legal or tax
advice** — the items under "Could not verify" and "Recently changed" need a
Costa Rican lawyer and accountant before launch.

Confidence: **high** = read in the primary text; **medium** = reputable press or
law-firm note; **low** = single secondary source or search snippet.

Primary documents cited repeatedly:

| Key    | Document                                                                                                                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| REG    | Decreto 37899-MEIC, reglamento to Ley 7472 (consumer protection), consolidated print of 7 Jan 2026                                       |
| L10946 | Ley 10946, Gobernanza de los Servicios Digitales y el Comercio Electrónico                                                               |
| ANX    | Hacienda, "Anexos y Estructuras v4.4" (electronic invoicing) — <https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf>           |
| RCE    | Decreto 44739-H, Reglamento de Comprobantes Electrónicos — <https://www.hacienda.go.cr/docs/REGLAMENTO_DE_COMPROBANTES_ELECTRONICOS.pdf> |
| L8968  | Ley 8968, personal data protection                                                                                                       |
| R8968  | Decreto 37554-JP, reglamento to Ley 8968 — <https://www.tse.go.cr/pdf/normativa/reglamentoleyproteccionpersona.pdf>                      |
| IVA    | Ley 9635, Fortalecimiento de las Finanzas Públicas                                                                                       |
| PCMI   | Payments & Commerce Market Intelligence — <https://paymentscmi.com/insights/mercado-comercio-electronico-costa-rica/>                    |

## 1. Tax and IVA

- General IVA rate **13%**. Reduced rates: **4%** (air tickets, private health),
  **2%** (medicines, private education, personal insurance), **1%** (canasta
  básica and its agricultural inputs). (IVA arts. 10–11 · high)
- A later law added a 0.5% rate for organic products. (El Observador · low)
- Card acquirers withhold **up to 6%** of the net sale as a payment on account
  of the merchant's IVA; Régimen Simplificado taxpayers are exempt.
  (IVA art. 29 · high) A separate **2%** income-tax withholding applies to card
  sales on an 88% base. (siemprealdia.co · medium)
- **No rule was found making a local marketplace collect or withhold IVA on
  local sellers' sales.** The marketplace's own commission is an ordinary
  service taxed at 13%. (IVA arts. 29–30 · medium, absence finding)
- **Platforms must report their sellers.** Resolution MH-DGT-RES-0025-2024
  (OECD model rules) requires platform operators domiciled in Costa Rica to run
  seller due diligence from 1 Jan 2025 and report identities, amounts and goods
  or services sold. First report (for 2025) was due 30 Apr 2026.
  (CRHoy; Delfino · medium)
- Imported goods bought online pay 13% IVA plus duties. The US$500 exemption for
  online and casillero purchases ended 1 May 2021. (QCostaRica; ICEX · medium)
- Régimen de Tributación Simplificada was reformed by Decreto 45209-H
  (13 Oct 2025): 22 activities including small retail; annual purchases up to
  186 base salaries (₡85,969,200 in 2026); up to 6 employees; one establishment
  open to the public; no IVA charged to customers; e-invoices only on request.
  (Alegra; KPMG · medium) Whether online-only sellers qualify: **unverified**.

## 2. Electronic invoicing

- **Version 4.4 is mandatory since 1 Sep 2025** (MH-DGT-RES-0027-2024).
  (ANX · high) Adjustments dated 22 Apr 2026 (alphanumeric legal-entity IDs, new
  reference codes) reportedly had to be implemented by 1 Nov 2026.
  (ANX; Edicom · medium on the date)
- Document types: `01` factura electrónica, `02` nota de débito, `03` nota de
  crédito, `04` tiquete electrónico, `05`/`06`/`07` receiver acceptance / partial
  acceptance / rejection, `08` factura electrónica de compra, `09` factura de
  exportación, `10` recibo electrónico de pago (new in 4.4).
  (ANX nota 3; RCE art. 9 · high)
- Payment-method codes: `01` cash, `02` card, `03` cheque, `04` transfer, `05`
  collected by third parties, `06` **SINPE Móvil**, `07` **Plataforma Digital**,
  `99` other; up to four per document. (ANX nota 6 · high)
- API flow: XML signed XAdES-EPES with a BCCR digital signature or Hacienda's
  cryptographic key → OAuth2 token from `idp.comprobanteselectronicos.go.cr`
  (5-minute token) → POST to `/recepcion/v1/recepcion` → poll by the 50-digit
  _clave_ or receive a callback. A sandbox exists at `/recepcion-sandbox/v1/`.
  (ANX anexos 2–3 · high)
- Operating rules: send immediately (or within 2 business days if offline);
  deliver the document to the buyer at the time of sale even before Hacienda
  responds; a rejected document is void and must be reissued; keep records
  5 years. (RCE arts. 18–22 · high)
- New cryptographic keys generated from 27 Jul 2026 need a 14-character PIN.
  (KPMG · medium)
- **TRIBU-CR replaced ATV on 6 Oct 2025.** (Delfino · high)
- **Who invoices:** the taxpayer making the sale issues the document. The decree
  has no marketplace-specific rule; Régimen Simplificado sellers are exempt from
  issuing; code `05` exists for payments collected by a third party.
  (RCE arts. 7, 18 · high on text, medium on the marketplace inference)
- **Decreto 45953-H (16 Oct 2026)** requires taxpayers to register the SINPE
  Móvil numbers they use to collect payments; existing taxpayers have 12 months.
  (KPMG · high)

## 3. Consumer protection

- Framework: Ley 7472 plus Decreto 37899-MEIC. Renumbered in Feb 2024, so the
  e-commerce chapter is now arts. 181 onward. (REG · high)
- **Right of withdrawal: 8 business days from perfection of the sale** (not from
  delivery), expressly applicable to e-commerce, exercised through the same
  channel used to buy. **Refund within 8 calendar days through the same payment
  method.** Exceptions: used consumables or perishables, made-to-measure goods,
  special-order imports, services already rendered. (REG arts. 72–77 · high)
- **Minimum legal warranty: 30 business days from delivery.** Burden of proof is
  on the merchant. (REG arts. 47, 53 · high)
- Mandatory online disclosures: merchant identity, legal name, cédula jurídica,
  address, phone, email (art. 183); terms in Spanish, payment and delivery
  procedures, complaint channel, withdrawal conditions and a warranty reminder
  (art. 186); **an order summary before confirmation with no pre-ticked options**
  (arts. 188–189); a durable receipt (art. 191); payment-security information
  (art. 192); a free complaint mechanism (art. 195); **publication of both
  positive and negative reviews** (art. 196). (REG · high)
- **Price display: the total price must include taxes, shipping and all charges,
  with a breakdown** (arts. 36, 187). Foreign-currency pricing is allowed if the
  BCCR reference rate is disclosed. (REG · high)
- **Delivery: missing the promised date is a breach and triggers a full refund.**
  If no date is stated, delivery is due within 24 hours (art. 194). (REG · high)
- **Ley 10946** was published 24 Jun 2026 and takes effect about **24 Jun 2027**;
  regulations are due within that period. For marketplaces it brings: hosting
  safe harbour absent actual knowledge (art. 32) and no general monitoring duty
  (art. 33); notice-and-action (art. 40); an internal complaint system (art. 43);
  removal of illegal products and buyer notification on judicial order (art. 45);
  the consumer must always be able to identify and contact the seller (art. 46);
  advertising and recommender transparency (arts. 47–48); a ban on dark patterns
  (arts. 17, 39). MEIC-registered SMEs are excluded from Chapter VI (art. 42).
  Enforcement by the Comisión Nacional del Consumidor. (L10946 · high)

## 4. Personal data

- Framework: Ley 8968 (2011) and Decreto 37554-JP; regulator PRODHAB.
  (L8968; R8968 · high)
- Registration is required only for databases administered for distribution,
  dissemination or commercialisation (art. 21); internal-use databases fall
  outside. (L8968; R8968 art. 3 · high)
- Consent must be prior, informed, express and written (physical or electronic);
  the notice must state purposes, recipients, rights and controller identity
  (art. 5). (L8968 · high)
- **Breach: data subjects must be informed within 5 business days.**
  (R8968 arts. 38–39 · high)
- Transfers require the data subject's express authorisation (art. 14);
  transferring to third-country databases without consent is a "gravísima"
  fault (art. 31 f). No adequacy mechanism exists in the text. (L8968 · high)
- Sanctions: up to 5 base salaries (minor), 5–20 (serious), 15–30 plus a
  1–6 month suspension of the database (very serious). Base salary for 2026 is
  ₡462,200. (L8968 art. 28 · high; Alegra · medium)
- The GDPR-style replacement bill (exp. 23.097) is archived; it did not pass. A
  narrower breach-notification reform (exp. 25.826) was filed 5 Oct 2026.
  (Delfino · high)

## 5. Payments

- **SINPE Móvil**: colón accounts only, one account per phone number, real time,
  24/7; free up to ₡100,000 per day outgoing and ₡2,000,000 per month incoming.
  (BCCR · high) SMS and other unauthenticated channels are capped at ₡100,000
  per day from 1 Jun 2026; app limits are bank-set, commonly up to ₡500,000 per
  day. (El Financiero · medium) Scale in 2025: ₡12.6 trillion across 745.5
  million transactions. A QR redesign is targeted for 2028. (La Nación · high)
- Merchant integration goes through banks or payment providers; no public BCCR
  merchant API was found. **Tilopay** describes itself as a direct SINPE
  participant with an API and webhooks. **ONVO Pay** matches an incoming SINPE
  Móvil transfer to a payment intent by payer ID and exact amount and confirms
  by webhook. (vendor docs · medium)
- Published gateway fees (third-party comparison, 20 Oct 2026): **ONVO** cards
  3.9% + US$0.35, SINPE Móvil 1.5%, US$3 per payout; **Tilopay** cards
  4.25% + US$0.35, SINPE Móvil 2% + US$0.35. (nmsoftwarelab · low–medium)
  Tilopay's own page confirmed its prices on 24 Nov 2026 (tilopay.com/tarifas ·
  high). The dollar was at ₡450–₡452 (banks' selling rate, 18 Nov 2026 ·
  press), so US$0.35 is about ₡157.50, not the ₡180 the code assumes at ₡515.
  ([market research](market-and-costs-2026-11.md) §6.4 and §6.5)
- Marketplace support: ONVO "Marketplaces" offers connected seller accounts with
  hosted onboarding, charges on behalf of the seller and a percentage platform
  fee (SINPE Móvil support in that flow not stated). Tilopay has a
  split-settlement endpoint for Tilopay-facilitated merchants. (vendor docs · medium)
- BCCR caps under Ley 9831: acquiring 1.95% local and 2.50% cross-border since
  19 Feb 2024; interchange 1.00% since 20 Feb 2025. (BCCR tables · high)
- BAC Credomatic's e-commerce terms shift fraud chargebacks to merchants that do
  not use 3-D Secure. (BAC contract · medium) A regulatory 3-D Secure mandate:
  **unverified**.
- Stripe does not list Costa Rica for standard accounts. (vendor source · medium–low)
- Online payment mix by volume (2024): international credit card 68%, debit 16%,
  bank transfer 10%, wallets 3%. (PCMI · medium)

## 6. Geography and addressing

- **7 provinces, 84 cantons** (newest: Monteverde 2021, Puerto Jiménez 2022) and
  **492 districts**. (Wikipedia; El Observador citing TSE · medium–high)
- Postal codes have 5 digits: province (1), cantón (2), distrito (2).
  (La Nación · medium)
- Addressing is still landmark-based in daily use. A binding national address
  standard: **unverified**. Local couriers have the buyer drop a map pin.
  (Moovin plugin · medium)
- **GAM: 31 cantons** (San José 13, Alajuela 3, Cartago 6, Heredia 9), about
  3.8% of the territory and roughly half the population (52.7% on 2011 census
  data). (Wikipedia; SciELO · medium)

## 7. Last mile and labour

- Correos de Costa Rica Pymexpress, before IVA: small ₡2,300 / medium ₡3,250 /
  large ₡4,550 / extra large ₡7,250 within the GAM, rising to ₡3,450–₡9,050
  outside it. (correos.go.cr · medium) **Correction, read 24 Nov 2026:** these
  are the self-service locker prices. The Pymexpress volume tariff inside the
  GAM is lower, by monthly volume, for the first kilo before IVA: ₡2,005.53
  (5–24 parcels), ₡1,962.17 (25–200), ₡1,853.76 (201–450), ₡1,756.19 (451 or
  more), for parcels the sender drops off. Every tier needs prior authorisation
  from Correos' Dirección de Pymes. If Correos collects, the client pays a
  collection fee of ₡1,500 (1–3 parcels) to ₡2,000 (11 or more) plus a
  per-parcel rate for collection clients: ₡1,890 small, ₡3,080 medium, ₡4,180
  large inside the GAM, before IVA.
  (correos.go.cr/tarifas · high; [market research](market-and-costs-2026-11.md) §3.4)
- Moovin (2–4 hour express, 24–48 hour routes, fulfilment), Boxful (aggregator
  launched Dec 2025, warehouse in Guachipelín) and Uber Direct operate locally;
  none publishes prices. (press and vendor pages · medium)
- **Platform couriers have no specific statute.** Two first-instance labour
  rulings found an employment relationship with Uber (2023-212, 2024-000826).
  Bill 24.500 (presumption of employment for platform couriers) has a
  favourable committee report and awaits a floor vote; bill 23.736 (independent
  contractor model) is also unvoted. (Redalyc; Delfino · medium–high)
- If drivers are employees, 2026 social charges are 26.83% employer and 10.83%
  worker. INS work-risk insurance is mandatory for employers and sold to
  independents. (La Nación; Delfino · medium) The 26.83% includes INS work-risk
  at a 1% reference rate that varies by activity, and employers with fewer than
  5 permanent non-farm workers do not pay the 1.5% INA charge. (Alegra, updated
  7 Oct 2026, read 24 Nov 2026 · third party)
- 2026 legal minimums: light-vehicle driver ₡13,523.69 a day; warehouse lead,
  office clerk or telephonist ₡405,710.70 a month; warehouse labourer or
  messenger ₡373,092.30; sales agent ₡419,755.80. All rise 1.70% on
  1 Jan 2027. (MTSS list, Decreto 45303-MTSS, and communiqué CP-022-2026, read
  24 Nov 2026 · high; [market research](market-and-costs-2026-11.md) §6.1)

## 8. Market context

- Size: **US$6.4 billion in 2024**, forecast 13% annual growth to US$9.3 billion
  in 2027. Other trackers give far lower figures on narrower definitions.
  (PCMI · medium; ECDB · low)
- Mobile is 74% of volume; domestic merchants take 55%; about 80% of adults buy
  online. (PCMI · medium) **Checked 24 Nov 2026:** two other sources disagree:
  48.5% bought through an electronic medium (UCR survey, La República,
  12 Sep 2022 · press) and 18% bought and paid online (World Bank figure,
  Forbes Centroamérica, 18 Sep 2025 · low). The PCMI page returned empty and
  could not be re-read. Treat 80% as an industry estimate.
  ([market research](market-and-costs-2026-11.md) §2.2)
- Cross-border competition: Amazon ships free on eligible orders of US$35+;
  **Amazon Bazaar** launched 7 Nov 2025 (most items under ₡5,000, delivery in two
  weeks or less, cards only; free shipping from ₡10,000 per El Financiero,
  9 Nov 2025, read 24 Nov 2026, terms may have changed); Temu delivers in about 15 days; Shein opened a
  direct route in Sept 2025 taking about a month. (Delfino; El Financiero · medium–high)
- Courier import declarations reached 12.9 million lines in Jan–Jul 2025, about
  four times all of 2024. (Teletica · medium)
- Reported shopper pain points: late or missing deliveries and slow refunds
  (95 MEIC complaints against a single online store); no local representation
  for Temu and Shein claims; parcels held in customs; weak rural and reverse
  logistics. (CRHoy; Teletica; ICEX · medium)

## 9. Business setup

- Entities: an S.A. needs a three-member board plus a fiscal; an S.R.L. needs
  one manager. Registration takes about 1–3 weeks. (AG Legal · medium)
- No e-commerce or marketplace operator licence was found; Ley 10946 creates
  obligations, not a registry. (L10946 · medium, absence finding)
- Trademarks: US$50 per class, 10-year term, about 4 months including a 2-month
  opposition window. Relevant Nice classes: 35 (online retail and marketplace),
  39 (transport, storage, delivery), 9 and 42 (software), 36 (payments).
  (La Nación; Registro Nacional · medium–high)
- Domains: `.cr` costs US$70 per year plus IVA and `.co.cr` US$25 plus IVA,
  bought at NIC Costa Rica; no eligibility restriction. (nic.cr · medium–high)

## Could not verify

- Any Hacienda ruling on a marketplace issuing invoices on behalf of sellers, or
  a deemed-supplier IVA rule for local goods.
- Whether online-only sellers qualify for the Régimen Simplificado.
- Current joint liability of a marketplace under Ley 7472 art. 35.
- A 3-D Secure mandate, and Costa Rica's cash-on-delivery share.
- Greenpay's API and fees; whether ONVO's marketplace flow supports SINPE Móvil.
- The GAM's population share on 2022 census data.
- Any binding national address standard.
- Price lists for Moovin, Uber Direct and Boxful.
- Statutory equipment rules for motorcycle couriers.

## Recently changed — re-check before launch

- **Ley 10946**: in force about 24 Jun 2027, regulations pending.
- **Decreto 45953-H** (16 Oct 2026): SINPE Móvil number registration.
- **E-invoicing**: annex adjustments of 22 Apr 2026, new key PIN rules, and
  alphanumeric legal-entity IDs from Q4 2026.
- **TRIBU-CR** replaced ATV; Hacienda's technical annex still references ATV.
- **Platform seller reporting** (MH-DGT-RES-0025-2024).
- **Card fee caps**: 2026 review outcome pending.
- **Courier employment**: bill 24.500 awaiting a floor vote.
- **Customs**: per-parcel fee under debate; new customs system planned for 2027.
