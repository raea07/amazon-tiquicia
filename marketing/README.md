# Marketing and sales material

**What it is.** The words and the specifications for Yuntera's first marketing and sales pieces, in Spanish (usted) and English side by side. Written 24 November 2026. No piece is designed yet.
**Conclusion 1.** No piece may be printed, posted or sent before the trademark search is done and `yuntera.cr` is registered (gate G1). The brand book says so in section 15.
**Conclusion 2.** The seller pieces are useful first: seller interviews and visits can start once G1 and G2 are met. Shopper pieces wait for real payments and a public shop.
**Conclusion 3.** Every claim here is checked against `STATUS.md` of 23 November 2026. A claim that depends on something not yet live names its gate.
**The owner must decide** the five questions at the end of this file. The answers change words in several pieces.

---

## What is here

| File | What it is for | Who uses it | Status |
| --- | --- | --- | --- |
| [messaging.md](messaging.md) | The message house: one sentence for the company; problem, promise, proofs, objection and answer for each audience; words to use and to avoid | Everyone who writes for Yuntera | Final text; the native copy editors still read it |
| [sales/seller-pitch.md](sales/seller-pitch.md) | Five-minute visit, one-minute message, one-page leave-behind, ten-slide deck, objections, price sheet, the seller's first week | Owner and the first sales agent | Final text; the leave-behind and deck wait for the design |
| [sales/partner-and-investor-brief.md](sales/partner-and-investor-brief.md) | One-page brief and ten-slide outline for a partner (chamber, producers' network, bank) and for an investor | Owner | Final text; facts to re-check on the day it is used |
| [flyers/shoppers-first-zones.md](flyers/shoppers-first-zones.md) | Door and counter flyer for shoppers in the first delivery cantons | Owner, sellers | Waits for the design and for gates G3, G4, G6, G7 |
| [flyers/shops.md](flyers/shops.md) | Flyer left with shops on a visit | Owner, sales agent | Waits for the design and G1, G2 |
| [flyers/makers-at-a-fair.md](flyers/makers-at-a-fair.md) | Flyer and stand poster for makers and producers at a fair | Owner | Waits for the design and G1, G2, G8 |
| [flyers/drivers.md](flyers/drivers.md) | Notice to recruit drivers | Owner | Waits for the design and G11 (the lawyer's answer on how drivers are engaged) |
| [social/launch-calendar.md](social/launch-calendar.md) | Four weeks of posts on Facebook, Instagram, TikTok and WhatsApp Status | Owner or a contractor | Final text; pictures wait for the design; starts at the open launch |
| [messages/seller-outreach.md](messages/seller-outreach.md) | WhatsApp and e-mail texts to sellers, first contact and follow-up, with the consent rules | Owner, sales agent | Final text; usable after G1, G2, G9 |
| [messages/shopper-first-order.md](messages/shopper-first-order.md) | Messages a person sends around a shopper's first order, with the consent rules | Owner, support | Final text; usable after G4, G9 |

"Final text" means the words are ready for the native copy editors and the lawyer to read. It does not mean ready to publish.

The visual design is being chosen this week by a separate team. These files say what each piece must contain and how big it is. They do not choose colours, fonts or layouts beyond what the brand book already fixes (logo use, money format, contrast, 44 px touch targets).

---

## The gates

A gate is a fact that must be true before a piece that depends on it is used. Each piece lists its gates at the top. The source of each gate is the file named.

| Gate | What must be true | Why | Source |
| --- | --- | --- | --- |
| **G1 Name** | The trademark search at the Registro Nacional is done and clear; `yuntera.cr` is registered | "Do not print, advertise or sign contracts under the name until that search is done" | `docs/brand/brand-book.md` §15; `STATUS.md`, "What needs you" 1 |
| **G2 Legal identity** | The company exists; its legal name, cédula jurídica and address are known | Every marketing message must name its sender (Ley 8642 art. 44); every shop page must name the merchant | `docs/05-security-compliance/compliance-costa-rica.md` §1; market research §7.4 |
| **G3 Public shop** | The shop opens on a stranger's phone without the Vercel login | Today every address is behind a login | `STATUS.md`, "In one paragraph" |
| **G4 Payments live** | The ONVO contract is signed and `payments_mode` is `live` | The preview simulates payments | `STATUS.md`, "Not built" |
| **G5 Invoices live** | Yuntera is registered with Hacienda as an electronic issuer | No document has reached Hacienda | `STATUS.md`, "Not built" |
| **G6 Complaint route** | The shop's complaint form calls `file_complaint`, and the help page's answer time matches `customer-service.md` (1 working day to acknowledge, 5 to answer) | The help page says "2 días hábiles" and only offers e-mail | Support research §1.2 |
| **G7 Zone set** | The pilot cantons are chosen and every other district is marked not served in **Operación** | A flyer names cantons; the shop must agree | `docs/02-architecture/decisions.md` 41; go-to-market draft §2.3 |
| **G8 Warehouse open** | A storage space exists, with drop-off appointments | Stock to the warehouse is the seller offer | `docs/06-operations/logistics-playbook.md`, "Inbound" |
| **G9 Contact channels** | The WhatsApp Business number and the support mailbox exist | `ayuda@yuntera.cr` does not exist yet | `docs/brand/brand-book.md` §15 |
| **G10 Commercial messages** | A commercial template and a one-step unsubscribe page are built | The worker refuses every marketing message today | `docs/06-operations/notifications.md`; `STATUS.md`, "Not built" |
| **G11 Driver basis** | The lawyer has said in writing how drivers are engaged, and an INS work-risk policy covers them | Employment status is unsettled; no driver rides without INS cover | Compliance §7 |
| **G12 Lawyer read it** | The lawyer has read the piece's legal lines (warranty, withdrawal, refunds) | Advertising promises are enforceable (Decreto 37899-MEIC art. 55 b) | Market research §7.4 |

G1 and G12 apply to every public piece.

---

## Rules for claims

### What may be said, and why

| Claim | May be said | Condition | Source |
| --- | --- | --- | --- |
| Order by 2 p.m., arrives the next delivery day, Monday to Saturday, in the central zone | Yes, naming the served cantons | G4, G7; the date shown in the shop is the promise | `geography_data.sql` (zone `gam-core`, cutoff 14, Monday to Saturday, 1 day); help page |
| Delivery ₡1,500 in central GAM, free from ₡25,000 | Yes, with the zone beside the price | The amounts are working assumptions; re-check the console's zone before printing | `geography_data.sql`; `pricing-and-fees.md` |
| Pay by SINPE Móvil or cash on delivery | Yes | G4 | `STATUS.md`, "What is built", Shop |
| Pay by card | Only if cards are switched on at that moment | G4 | Go-to-market draft §3 |
| Cash on delivery up to ₡150,000 | Yes, as "hasta ₡150 000" | Setting `cod_max_order_minor`; re-check | `foundation.sql` |
| A four-digit delivery code that only the shopper sees | Yes | Built | `STATUS.md`, "How the new parts work" |
| 8 business days to return, counted from delivery, without a reason | Yes, in the help page's words | G12 | Help page; compliance §1 |
| Refund within 8 calendar days by the same means of payment | Yes | G4, G12; cash orders: for the lawyer to confirm | Customer service; compliance §9 q2 |
| At least 30 business days of legal warranty | Yes, as the law's minimum, never as "garantía Yuntera" | G12 | Help page; art. 55 h |
| If the promised date is missed, the shopper can cancel and get everything back | Yes, in the help page's words | G12 | Help page |
| Sellers see every fee before they list | Yes | Built (itemised fee preview) | `STATUS.md`, Seller centre |
| No monthly fee, no listing fee in the pilot | Yes | Pilot schedule | `pricing-and-fees.md`, "Not charged in the Pilot" |
| Commission 8% to 15% by category, warehouse fee ₡900 to ₡4,900 | Yes, as "tarifas del piloto" | They are assumptions in the code; say "piloto" | `fees.ts`; `catalog_reference.sql` |
| Paid 10 days after delivery, from ₡5,000, by bank transfer | Yes, "por transferencia" | Transfers are made by hand | `people_payouts.sql`; `STATUS.md` |
| Sellers see only the buyer's first name and district | Yes | Built | CLAUDE.md; `STATUS.md` |
| We publish good and bad reviews | Yes | Built | Brand book §4; compliance §1 |
| How results are ordered is published | Yes | Built (help page) | Help page |
| Yuntera issues a factura electrónica for its fees and for delivery | Only after G5 | G5 | `STATUS.md`, Electronic invoices |

### What may not be said, and why

| Do not say | Why |
| --- | --- |
| Any share of Costa Ricans who buy online ("80%", "48.5%", "18%") | Three sources disagree; statistics in advertising need identified, checkable sources (Decreto 37899-MEIC art. 55 g) |
| "Garantía Yuntera", "garantizado" | Allowed only for terms better than the legal warranty, stated in the advert (art. 55 h) |
| "Envío gratis" without "desde ₡25 000" and the zone | Misleading by omission (art. 55 c) |
| "Todo el país", "en minutos", "el mismo día", "automático" | Not true: one zone, next delivery day, payouts by hand |
| "Más barato que …", any comparison with a named competitor's price | No sourced, current comparison; Amazon Bazaar is cheaper on small imported goods |
| A discount, a free-delivery window, a first-order gift | Only with start and end dates, the quantity if limited, every restriction and the former price (art. 55 i, j; MEIC found these missing in 31% of 26 digital adverts in June 2026) |
| A draw, raffle or contest | Needs a reglamento, a notary or sworn declaration and the winner published nationally (art. 59); paid entry may need the JPS, for the lawyer to confirm |
| "Descargue la app" | The shopper app is only in test tracks; seller, driver and warehouse apps have not run on a phone |
| Anything in English about the shop's screens being in English | The interface is Spanish only (`STATUS.md`, "Later") |
| A customer's or seller's name, photo or words | Only with their written permission, kept on file |
| The delivery code, an address, a phone number of a customer | Privacy rules in CLAUDE.md |
| "Pura vida", "mae", emoji, capitals for emphasis, more than one exclamation | Brand book §3 |
| Payment-method conditions ("pague con SINPE y ahorre") | MEIC flagged conditions tied to a payment method; for the lawyer to confirm |

### How English is used

Every customer piece carries the English beside the Spanish so the owner, a partner or an English-reading customer can read it. **The Spanish is the version published in Costa Rica.** The shop's screens are Spanish only today, so an English piece meant for English readers must say "La tienda está en español por ahora. / The shop is in Spanish for now." until the English release (task 45). The English uses American spelling, pending the owner's decision in the English research (decision 2).

### Money and dates

- Colones first, as the brand book writes them: `₡25 000` in Spanish copy, `₡25,000` in English copy (decision 4 below).
- US dollars appear only in the investor brief, at **₡450 per US$**, the banks' selling rate of 18 November 2026 (market research §6.4). Re-check on the day of use.
- Dates as people say them: _lunes 7 de diciembre_.

---

## Order to produce things in

| Step | What | Who | Done when |
| --- | --- | --- | --- |
| 1 | Owner answers the five decisions below | Owner | Answers written at the end of this file |
| 2 | Native Costa Rican Spanish copy editor and native English copy editor read `messaging.md` and `sales/seller-pitch.md` | Copy editors | Comments returned and applied |
| 3 | Lawyer reads every line marked G12 | Lawyer | Written note per file |
| 4 | Gates G1 and G2 met | Owner, lawyer | Search result in writing; company data known |
| 5 | Seller leave-behind and shop flyer designed; 2 print quotes | Design team; owner | Proof approved |
| 6 | Seller visits start with the talk track | Owner | Visit list kept (seller pitch §8) |
| 7 | Seller deck designed | Design team | Deck file approved |
| 8 | Fair flyer and poster designed, once a fair date is set | Design team; owner | Proof approved |
| 9 | Driver notice, after G11 | Owner; design team | Lawyer's note on file |
| 10 | Shopper flyer and social calendar, after G3, G4, G6, G7 | Owner | Shop opens on a stranger's phone; payments live |
| 11 | Partner and investor brief, re-checked the week it is used | Owner | Every figure re-read on its source |

---

## How results are measured

The product does not record where a customer came from (no "¿Cómo nos conoció?" field, no campaign tag; go-to-market draft §1). Until it does, each piece carries its own code, and the owner counts by hand in one spreadsheet every Saturday.

- **A WhatsApp link with a pre-written first line.** Each piece's QR code opens `wa.me/[número]?text=...` with a code in the text, for example "Hola, vengo del volante VENDE-1". The person sends it; the code arrives with the message. This needs nothing built.
- **A code to say out loud** at a fair or on the phone, printed beside the QR.
- **Codes are never personal.** They name the piece and the place, never a person.

Code list:

| Code | Piece |
| --- | --- |
| COMPRA-1 | Shopper flyer, door to door |
| COMPRA-2 | Shopper flyer, left on a seller's counter |
| VENDE-1 | Shop flyer |
| VENDE-2 | Seller leave-behind (one page) |
| FERIA-[month] | Fair flyer and poster, for example FERIA-DIC |
| RUTA-1 | Driver notice |
| RED-[week]-[post] | Social posts, for example RED-S1-03 |
| SOCIO-1 | Partner brief |

---

## Decisions for the owner

1. **Which cantons do the shopper pieces name?**
   - A. Cluster A, East: San José Central, Montes de Oca, Curridabat, Goicoechea, Moravia. **(recommended)** It matches the go-to-market draft's recommendation, so the pieces and the zone switch agree.
   - B. Cluster B, West: Escazú, Santa Ana, Belén.
   - C. Cluster C, North: Heredia Central, Santo Domingo, San Pablo, Flores.
2. **Do the seller pieces offer the 6-month price lock and free set-up of the first 20 products?**
   - A. Yes, with a dated join-by line. **(recommended)** It is the pricing proposal's recommended offer (decision 4A there) and costs staff time, not margin.
   - B. No offer; fees only.
3. **Do the launch posts include a free-delivery window?**
   - A. No offer in the first four weeks. **(recommended)** The go-to-market draft recommends no offer, and a missing date or stock line is the commonest breach MEIC found.
   - B. Yes, the pricing proposal's 14 days of free delivery in central GAM, with the dates in every post.
4. **How do amounts look in English copy?**
   - A. `₡25,000` in English, `₡25 000` in Spanish. **(recommended)** English readers expect the comma; the amount is the same.
   - B. `₡25 000` in both, as the English research recommends for the screens.
5. **Who answers the WhatsApp number printed on the pieces?**
   - A. The owner, Monday to Saturday, with the hours printed. **(recommended)** The customer-service document sets those days, and a number nobody answers breaks the first promise.
   - B. A sales agent for sellers and the owner for shoppers, on two numbers.

---

## Assumptions to verify

| Assumption | Used where | How to verify |
| --- | --- | --- |
| Delivery ₡1,500, free from ₡25,000, cutoff 2 p.m., Monday to Saturday | Every shopper piece | Console, **Operación → Zonas**, on the day the piece goes to print |
| Pilot fees stay as in `2026-11-assumptions` | Seller pieces | `fees.ts` and the console's **Cobros** section (mode and fees) before printing |
| A pre-written WhatsApp link (`wa.me/...?text=`) is enough to count responses | Every piece | Test one link on two phones before printing |
| Print shops in Costa Rica work in carta, media carta and tabloide | Flyers | Two print quotes |

## Sources

- Repository: `STATUS.md` (23 November 2026); `docs/brand/brand-book.md` §3, §4, §8, §15; `docs/01-product/pricing-and-fees.md`; `packages/core/src/fees.ts`; `supabase/migrations/20261121080300_geography_data.sql`, `20261121080000_foundation.sql`, `20261121082300_people_payouts.sql`, `20261121080450_catalog_reference.sql`; `apps/web/src/app/ayuda/page.tsx`; `docs/05-security-compliance/compliance-costa-rica.md`, `privacy.md`; `docs/06-operations/customer-service.md`, `notifications.md`; `docs/02-architecture/decisions.md` 41.
- Pack research, read 24 November 2026: market research (`/root/yuntera-audit/strategy-pack/research/market.md`) §6.4 and §7.4, citing Decreto 37899-MEIC arts. 55 and 59 (consolidated print of 7 January 2026, https://www.micitt.go.cr/sites/default/files/marco_juridico_legal/), Ley 8642 art. 44 (https://www.sutel.go.cr/sites/default/files/normativas/ley_general_de_telecomunicaciones.pdf) and Infobae, 17 June 2026 (MEIC inspection); support research (`support-and-it.md`) §1.2; English research (`english.md`) §7.
- Pack drafts read for consistency on 24 November 2026: go-to-market strategy and pricing strategy proposal (other writers' work in progress).
