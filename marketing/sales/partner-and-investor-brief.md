# Partner and investor brief

**What it is.** A one-page brief and a ten-slide outline for two readers: a partner (a chamber of commerce, a producers' network, a bank) and an investor. Only facts from the repository and sourced market figures; the gaps are said plainly. Spanish and English side by side for the partner; English with Spanish headings for the investor.
**Conclusion 1.** What can be shown is a built, tested product and a sourced reason to exist (SINPE Móvil everywhere, card-only and slow alternatives). What cannot be shown is any real sale.
**Conclusion 2.** The partner ask is small and free: a session with members and five pilot shops. The investor ask is not set; this file gives the facts, not the amount.
**Conclusion 3.** The three numbers that decide the model (margin per order, deliveries per driver-day, 60-day repeat) are assumptions until the pilot measures them. Every slide says so.
**The owner must decide** the three questions at the end (which partner first, whether to meet investors before the pilot, and the ask).

**Gates:** G1 and G2 before sending either brief. Re-read every market figure on its source the week the brief is used; most are press reports from 2025–2026.

---

## 1. Facts this brief may use

### From the repository

| Fact | Source |
| --- | --- |
| Four web apps built: shop, seller centre (Yuntera Vende), staff console (Yuntera Central), driver and warehouse app; four phone apps with the same flows | `STATUS.md`, "What is built" |
| A hosted preview runs all four web apps against a database with 41 migrations, demo data and simulated payments | `STATUS.md`, "In one paragraph" |
| Tests: 33 database test files, 27 browser journeys, 14 phone-app journeys pass | `STATUS.md`, "How it was checked" |
| Apps reach the database only through its functions; no table is readable directly; a security review on 21 November 2026 led to that lockdown | `STATUS.md` |
| Fees itemised and published; payout plus fees equals the money collected, to the céntimo | `pricing-and-fees.md` |
| Payments (ONVO, cards and SINPE Móvil) and electronic invoices (Hacienda v4.4) exist as code against fakes; nothing has charged a card or reached Hacienda | `STATUS.md`, "Not built" |
| The shopper app's Android build is in Google Play internal testing; no app is in a public store | `STATUS.md`, "What needs you" 11 |
| Pilot fees: commission 8%–15% by category, warehouse ₡900–₡4,900 per unit, collection at the gateway's published price; all assumptions | `fees.ts` |
| Contribution per order (planning arithmetic, every cost line an assumption): about ₡2,334 on a ₡20,000 order, ₡394 on an ₡8,000 order | `business-model.md` |
| No legal entity, no bank account, no trademark search, no real seller yet | `STATUS.md`, "What needs you" 1 and 6 |

### From the market research (read 24 November 2026)

| Fact | Source | Confidence |
| --- | --- | --- |
| SINPE Móvil: 747.5 million transfers in 2025 (+15%), more than 3.6 million individuals, nearly 55,000 companies | Tico Times, 17 Jun 2026, citing the central bank | Press |
| 96% of adults with a mobile phone use WhatsApp, 80% Facebook, 58% TikTok, 47% Instagram | CICOM-UCR survey of 792 adults, Aug 2025 (UCR, 27 May 2026) | Verified |
| 36,098 micro, small and medium firms registered with MEIC (May 2026), up 97% since May 2022 | El Observador, 28 Jun 2026, citing MEIC | Press |
| 20,400 small businesses were Correos Pymexpress clients (2024) | La República, 6 May 2024 | Press, dated |
| Amazon Bazaar: free shipping from ₡10,000, two weeks or less, international cards only | El Financiero, Nov 2025 | Press |
| Walmart Marketplace (Jan 2026): sellers deliver; card payment; seller fees not published | Delfino, 21 Jan 2026 (sponsored) | Press, medium |
| Delivery apps charge merchants 25%–29% | El Financiero, 15 Jul 2026 | Press |
| Amazon US and Mexico charge 8%–15% for most general goods | sell.amazon.com/pricing; vender.amazon.com.mx/precios | Verified |
| Correos' small-business tariff inside the GAM: ₡1,756.19–₡2,005.53 before IVA for the first kilo | correos.go.cr/tarifas | Verified |

### What may not be used

- A share of Costa Ricans who buy online: the sources say 80%, 48.5% and 18% (market research §2.2). If an investor asks, give all three with their sources and say they disagree.
- The e-commerce market size (US$6.4 billion in 2024, an industry tracker cited in the fact sheet): the source page returned empty on 24 November 2026 and could not be re-read. Use only if re-read, and call it an industry estimate.
- Any seller or shopper count, revenue, or order figure: there are none.

---

## 2. Partner brief (one page)

**Format.** Carta, portrait, one side per language. Sent as a PDF after a phone call, or printed for a meeting. Same header and footer rules as the seller leave-behind (seller pitch §3).

| Section | Español (usted) | English |
| --- | --- | --- |
| Title | **Una forma de que sus afiliados vendan en línea sin montar su propia logística** | **A way for your members to sell online without building their own logistics** |
| Qué es | Yuntera es una tienda en línea para Costa Rica con bodega y repartidores propios. Las tiendas publican sus productos; nosotros guardamos, cobramos por SINPE Móvil o contra entrega, y entregamos en [cantones]. | Yuntera is an online marketplace for Costa Rica with its own warehouse and drivers. Shops list their products; we store them, collect by SINPE Móvil or cash on delivery, and deliver in [cantons]. |
| Por qué ahora | SINPE Móvil hizo 747,5 millones de transferencias en 2025 (Banco Central, vía Tico Times). Las opciones más conocidas para comprar en línea aceptan solo tarjeta o tardan hasta dos semanas. | SINPE Móvil handled 747.5 million transfers in 2025 (Central Bank, via Tico Times). The best-known ways to buy online accept only cards or take up to two weeks. |
| Lo que reciben sus afiliados | Sin mensualidad ni costo por publicar en el piloto. Comisión del 8% al 15% según la categoría, solo cuando venden. Un estado de cuenta con cada cargo. Pago por transferencia 10 días después de la entrega. | No monthly fee and no listing fee in the pilot. A commission of 8% to 15% by category, only when they sell. A statement of every fee. Payment by transfer 10 days after delivery. |
| Dónde estamos | El sistema completo está construido y probado. Todavía no hemos hecho una venta real. Preparamos un piloto cerrado con cinco tiendas en [cantones]. | The whole system is built and tested. We have not made a real sale yet. We are preparing a closed pilot with five shops in [cantons]. |
| Lo que le pedimos | 1. Una charla de 30 minutos con sus afiliados de [categorías]. 2. Que nos presenten a quienes quieran probar. No pedimos dinero ni datos de sus afiliados. | 1. A 30-minute talk with your members in [categories]. 2. An introduction to those who want to try. We ask for no money and no member data. |
| Lo que le damos | Un informe al final del piloto con lo que aprendimos de las tiendas de su red: ventas, entregas a tiempo y devoluciones, sin datos personales. | A report at the end of the pilot on what we learned with your network's shops: sales, on-time deliveries and returns, with no personal data. |
| Contacto | [Nombre], [WhatsApp], [correo] · [Nombre legal], cédula jurídica [número] · Código SOCIO-1 | [Name], [WhatsApp], [e-mail] · [Legal name], legal ID [number] · Code SOCIO-1 |

"No member data": a partner must not hand over a list of members' contacts for us to message; the members contact us (Ley 8642 art. 44; [seller outreach](../messages/seller-outreach.md#consent-rules)).

**For a bank**, replace "Lo que le pedimos" with: "Conocer sus condiciones para una cuenta empresarial y para pagar a muchas tiendas por transferencia. / To learn your terms for a business account and for paying many shops by transfer." Note: BAC runs Pyme Store, a competing store builder for small businesses (Ticoslandia, Dec 2025, low confidence; market research §3.1). Payouts to sellers are made by hand today (`STATUS.md`), and whether collecting and paying out needs SUGEF registration is for the lawyer (`STATUS.md`, "What needs you" 2.2).

## 3. Partner deck (ten slides)

| # | Título / Title | On the slide | Source |
| --- | --- | --- | --- |
| 1 | Yuntera | Company sentence | messaging.md |
| 2 | Lo que viven sus afiliados / What your members face | Messages, couriers, fake SINPE receipts, only their followers buy | Market research §3.5, §4.3 |
| 3 | Cómo funciona / How it works | Publish · bring stock · we deliver and collect | Seller pitch §3 |
| 4 | Dónde / Where | Map of [cantones]; cutoff 2 p.m., next delivery day, Monday to Saturday | `geography_data.sql` |
| 5 | Cómo paga el comprador / How buyers pay | SINPE Móvil, cash on delivery; 747.5 million SINPE transfers in 2025 | Tico Times |
| 6 | Lo que cuesta / What it costs | Fee table | Seller pitch §6 |
| 7 | Una venta / One sale | ₡20,000 → ₡15,367 | `pricing-and-fees.md` |
| 8 | Dónde estamos / Where we are | Built and tested; no real sale; 5-shop pilot | `STATUS.md` |
| 9 | Lo que pedimos / What we ask | A talk, introductions; no money, no member data | This file |
| 10 | Lo que devolvemos / What we give back | End-of-pilot report, no personal data | This file |

---

## 4. Investor brief (one page)

English is the working language; Spanish headings help a Costa Rican reader. Format: carta or A4 PDF, one side.

| Section | Text |
| --- | --- |
| **Yuntera — qué es / what it is** | An online marketplace for Costa Rica with its own warehouse and drivers. Local shops sell; Yuntera stores, collects payment (SINPE Móvil, cash on delivery, cards) and delivers, starting in a cluster of cantons in the central GAM. |
| **El problema / the problem** | Shoppers who pay by SINPE Móvil and want a parcel tomorrow have few options: the best-known cross-border stores accept only cards and take up to two weeks (Amazon Bazaar, El Financiero, Nov 2025); Walmart's new marketplace takes cards and leaves delivery to sellers (Delfino, Jan 2026, sponsored). Small sellers juggle couriers and fake SINPE receipts (press, market research §3.5). |
| **Por qué aquí / why here** | SINPE Móvil: 747.5 million transfers in 2025 by more than 3.6 million people (Tico Times, 17 Jun 2026). WhatsApp reaches 96% of adults with a phone (UCR, 2025). 36,098 small firms are registered with MEIC (May 2026). |
| **Cómo gana / how it earns** | A commission of 8%–15% on each sale (inside the 8%–15% Amazon publishes for general goods), a warehouse fee per unit, a payment fee passed through at cost, and the shopper's delivery charge (₡1,500 in the central zone, free from ₡25,000). All amounts are pilot assumptions. |
| **Lo construido / what is built** | Shop, seller centre, staff console, driver and warehouse app, four phone apps; payments and electronic invoicing as code against test fakes; 33 database test files, 27 browser journeys and 14 phone journeys passing; a hosted preview with demo data (`STATUS.md`, 23 Nov 2026). Built by the founder with AI tooling. |
| **Lo que falta / what is missing** | No real sale. No legal entity, gateway contract or tax registration yet. No trademark search. No seller signed. Paid marketing waits for the pilot's results. |
| **Lo que decide el modelo / what decides the model** | Three numbers, measured in a closed pilot of about 100 orders: margin per order (planning estimate ₡2,334 on a ₡20,000 order, ₡394 on ₡8,000), delivered stops per driver-day (an own driver beats Correos' small-business tariff at about 22–26 stops, at an assumed ₡45,000 driver-day), and the share of shoppers who order again within 60 days. |
| **Plan / plan** | Closed pilot: 5 shops, 3–5 cantons, invited shoppers, about 100 orders. Open launch in the central GAM only if margin per order is positive and a third of pilot shoppers reorder unasked (roadmap). |
| **Lo que buscamos / the ask** | [Owner to set: amount, form, use of funds.] |
| **Contacto / contact** | [Name], [e-mail], [legal name and ID once it exists] |

The stops figure is the go-to-market draft's re-run of the business model against Correos' published volume tariff (₡45,000 ÷ ₡2,005.53 to ₡1,756.19). The ₡45,000 driver-day is an assumption; legal-minimum labour is about ₡21,700 of it (market research §6.2, estimate).

## 5. Investor deck (ten slides)

| # | Title | On the slide | Gap said on the slide |
| --- | --- | --- | --- |
| 1 | Yuntera | Company sentence; tagline | — |
| 2 | The problem | Card-only, slow cross-border; sellers' courier and receipt pains | Problem described, not sized |
| 3 | Why Costa Rica, why now | SINPE Móvil 2025; WhatsApp 96%; 36,098 registered small firms | No survey after 2022 of how many buy online |
| 4 | The product | Screenshots of the preview's shop, seller centre, console, driver app (demo data only) | Preview, not a public site |
| 5 | How it earns | Fee table; one order worked through | All fees are assumptions |
| 6 | Unit economics | ₡20,000 order → ₡2,334; ₡8,000 order → ₡394; break-even on stops | Every cost line is an assumption |
| 7 | Competition | Amazon Bazaar, Temu, Shein (cross-border); Walmart Marketplace, Boxful, Pyme Store BAC, Correos–BCR pilot (local); delivery apps | None publishes seller fees; Mercado Libre's local checkout unverified |
| 8 | Where we lose | Catalogue breadth, price on cheap imports, unknown brand, one zone | From `market-and-wedge.md` |
| 9 | Plan and tests | Pilot exit criteria; open-launch exit criteria | Dates depend on the gateway and tax registration |
| 10 | The ask | [Owner to set] | — |

Screenshots: only demo data from the preview, never a real person's data; check every screen for names before capturing.

---

## Decisions for the owner

1. **Which partner first?**
   - A. Correos' Dirección de Pymes, asking also for its small-business tariff and a session for its 20,400 Pymexpress clients. **(recommended)** One meeting serves the courier fallback and seller recruitment.
   - B. MEIC (EXPOPYME and its registers).
   - C. A chamber of commerce in the pilot cantons.
2. **Meet investors before the pilot?**
   - A. No; send the brief only after 100 pilot orders. **(recommended)** Without a real sale, the three deciding numbers are guesses, and the brief says so.
   - B. Yes, to fund the pilot itself.
3. **What is the ask on slide 10?**
   - A. Leave it out until decision 2 is answered. **(recommended)** No amount has been worked out in the repository.
   - B. The owner writes an amount and use of funds now, from the go-to-market draft's budget levels.

## Assumptions to verify

| Assumption | How to verify |
| --- | --- |
| A partner will host a 30-minute talk at no cost | Ask the first two partners |
| The end-of-pilot report is something partners value | Ask in the first meeting |
| An own driver beats Correos at 22–26 stops a day | Measure stops per driver-day and the real driver-day cost in the pilot |

## Sources

- Repository: `STATUS.md` (23 November 2026); `docs/00-strategy/business-model.md`, `market-and-wedge.md`; `docs/01-product/pricing-and-fees.md`, `roadmap.md`; `packages/core/src/fees.ts`; `supabase/migrations/20261121080300_geography_data.sql`; `docs/research/costa-rica-fact-sheet.md` §8.
- Market research of 24 November 2026 (`/root/yuntera-audit/strategy-pack/research/market.md`): Tico Times, 17 Jun 2026, https://ticotimes.net/2026/06/17/costa-rica-hits-record-digital-payment-use-as-cash-declines; UCR, 27 May 2026, https://www.ucr.ac.cr/noticias/2026/5/27/un-estudio-desmonta-mitos-sobre-el-uso-de-las-plataformas-digitales-en-costa-rica.html and https://mediapolis.ucr.ac.cr/confianza-y-consumo/habitos-y-practicas-de-consumo/; El Observador, 28 Jun 2026, https://observador.cr/las-mipymes-registradas-casi-se-duplicaron-en-cuatro-anos-en-costa-rica-emprendedores-inscritos-llegan-a-12-050/; La República, 6 May 2024, https://www.larepublica.net/noticia/correos-de-costa-rica-facilita-el-crecimiento-de-las-pymes-con-envios-diarios-de-8500-paquetes; El Financiero, Amazon Bazaar, https://www.elfinancierocr.com/tecnologia/amazon-contraataca-a-temu-estrena-su-seccion/TIZ3DKNZ4ZH4DMOEZV6XNJQLPI/story/; Delfino, 21 Jan 2026, https://delfino.cr/2026/01/walmart-lanza-productos-exclusivos-en-linea; El Financiero, 15 Jul 2026, https://www.elfinancierocr.com/negocios/la-rebelion-del-delivery-los-restaurantes-de-costa/OSEH7STGYRH5VJQTNRWBHKDDDE/story/; https://sell.amazon.com/pricing; https://vender.amazon.com.mx/precios; https://correos.go.cr/tarifas/; Ticoslandia on Pyme Store BAC (search result); §2.2 on the three conflicting online-buying figures; §6.2 on wages.
- Go-to-market strategy draft (this pack, 24 November 2026), §6 (stops against Correos).
