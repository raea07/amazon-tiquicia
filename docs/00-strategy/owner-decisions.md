# Owner decisions

**What this is.** Every question the strategy documents, the marketing pieces and the November research ask the owner, each asked once, in the order the answers are needed. Written 24 November 2026.
**How to answer.** Reply like "D4 A, D10 D". "ok" accepts every recommended option of one group, for example "ok before the pilot". An answer is recorded in `docs/02-architecture/decisions.md`.
**Where they come from.** [Go-to-market](go-to-market.md), [roll-out plan](rollout-plan.md), [team structure](team-structure.md), [pricing strategy](pricing-strategy.md), the [marketing pieces](../../marketing/README.md) and the research in [market and costs](../research/market-and-costs-2026-11.md), [support and system-health tools](../research/support-and-system-health-tools.md) and [English translation](../research/english-translation-plan.md). Those documents now point here instead of asking.
**Count.** 49 decisions: 3 already decided, 6 needed now, 28 before the pilot with real money, 10 before the open launch, 2 later.

Amounts are colones a month unless stated, from the document named; US dollars at ₡450. Every amount is an estimate or an assumption, as its source says. Questions for the lawyer and the accountant are separate: they are in [compliance](../05-security-compliance/compliance-costa-rica.md) §9 and §10.

---

## Already decided

**D1. Where support and system-health tools live.** Decided 24 November 2026: inside the staff console, as the areas Casos, Salud del sistema and Versiones. WhatsApp stays in the WhatsApp Business app for now. From: support research §3.3, questions 1 and 2. Waits on it: the support desk build.

**D2. How error and outage alerts reach the owner.** Decided 24 November 2026: through the owner's error-tracking account on its free plan, with personal data removed, plus a free uptime monitor. Cost now ₡0. From: support research §3.3, questions 2 and 5. Waits on it: roll-out phase 1, step 1.

**D3. New Android test builds.** Decided 23 November 2026: they go straight to the testers, with no draft release to start by hand. From: [store testing](../07-deployment/store-testing.md) §7; `apps/shop-native/eas.json` (`releaseStatus` "completed").

---

## Needed now

**D4. When is week 1?** From: roll-out plan.

- A. The week the lawyer and the accountant are engaged. **(recommended)** Their answers gate the company, the gateway and the tax registration.
- B. This week, with the advisers found later.

Cost: lawyer's first package ₡1,000,000–₡3,000,000 once, accountant ₡100,000–₡300,000 a month (go-to-market §9, assumptions). Waits on it: every week number in the roll-out plan, go-to-market §7 and the marketing owner steps.

**D5. How bugs and releases are handled.** From: support research §3.3, question 3.

- A. GitHub Issues for bug reports, a one-page release checklist, and a Versiones panel on the health page. **(recommended)** It costs nothing and fits the tests that exist.
- B. A bought test-management tool (price not researched).

Waits on it: step 8 of the support desk build.

**D6. Which apps get English first?** From: English research §7, question 1.

- A. All eight apps at once.
- B. Shoppers first (shop website, shop app, messages, help), then sellers, then staff and drivers. **(recommended)** Shoppers are the people who may not read Spanish.
- C. Shoppers and sellers only; staff and drivers stay in Spanish.

Size: about 33,300 words; the staff console holds 26% of them. Waits on it: the start of the English work.

**D7. Which language does a person see first?** From: English research §7, question 3.

- A. On the web, Spanish with a one-line offer of English; on a phone set to English, English. The choice is remembered. **(recommended)** Spanish stays the default, and Google advises against automatic redirects.
- B. Always Spanish until the person switches.
- C. Always the browser's or the phone's language.

Waits on it: the English foundation.

**D8. What do English web addresses look like?** From: English research §7, question 4.

- A. `/en` in front of today's address, for example `/en/pedidos/YT-123`. **(recommended)** Every link already sent keeps working, with one set of pages.
- B. Translated addresses, for example `/en/orders/YT-123`.

Waits on it: the English foundation.

**D9. How do amounts look in English?** From: marketing README (amounts in English copy) and English research §7, question 6. They gave different answers; this is the one question.

- A. `₡25 000` in English too, on screens, receipts and print. **(recommended)** The brand book fixes one money format from one function, so paper and screen show the same figure.
- B. `₡25,000` in English, on screens and print.
- C. `₡25,000` in English print only; screens keep `₡25 000`.

Cost: none. Waits on it: every amount in the English copy (the pieces follow A until answered) and the English money format.

---

## Before the pilot with real money

**D10. Which cantons does the pilot serve?** From: go-to-market (the marketing README's own canton question was removed in its favour).

- A. East: San José Central, Montes de Oca, Curridabat, Goicoechea, Moravia.
- B. West: Escazú, Santa Ana, Belén.
- C. North: Heredia Central, Santo Domingo, San Pablo, Flores.
- D. The 3 to 5 adjacent core cantons around the 5 signed sellers and the warehouse. **(recommended)** No source tells the clusters apart, and routes fill fastest where stock and first customers are.

Waits on it: the zones in the console (gate G7), the warehouse lease, every `[cantones]` in the pieces.

**D11. How big is the warehouse?** From: roll-out plan (pilot size); the launch size is added so the budget and the monthly result use one size per stage.

- A. About 20 m² near the first sellers for the pilot; about 50 m² at the launch. **(recommended)** 5 to 10 sellers at 5 to 10 orders a day fit, and every budget assumes these sizes.
- B. About 50 m² from the pilot, to avoid a move.
- C. About 100 m².

Rent (assumption, US$8–14 per m²): 20 m² ₡72,000–₡126,000; 50 m² ₡180,000–₡315,000; 100 m² ₡360,000–₡630,000 (go-to-market §9). Waits on it: the lease (weeks 2–6), shelving, gate G8.

**D12. Which address goes on the shop's legal footer and on print?** Added: the shop footer, every printed piece (gate G2) and the seller agreement need one, and no document asked.

- A. The company's registered address, as the lawyer sets it at incorporation; the warehouse address goes only to sellers bringing stock. **(recommended)** It keeps the warehouse and the owner's home off public print.
- B. The warehouse address.
- C. The owner's home address.

For the lawyer to confirm what the law requires on the footer. Waits on it: gate G2, roll-out phase 2 item 3, every print footer.

**D13. Which payment methods in the pilot?** From: roll-out plan.

- A. SINPE Móvil and cash on delivery; cards at the open launch. **(recommended)** Scope by app puts cards at Launch, and fewer methods means less to reconcile by hand.
- B. SINPE Móvil, cash and cards from the pilot.
- C. Cash on delivery only.

Waits on it: the "[tarjeta, si está activa]" lines; the card fee (D38) only matters once cards are on.

**D14. What is the cash-on-delivery ceiling?** From: roll-out plan; the pieces print "hasta ₡[límite vigente]".

- A. ₡50,000 an order in the pilot; back to ₡150,000 at the open launch only if the pilot's cash variance was zero. **(recommended)** One driver carries the cash, and the console changes it in one step.
- B. Keep today's ₡150,000 throughout.

Printed material never states the ceiling as a fixed number; it reads the setting on the print day. Waits on it: the console setting in roll-out phase 2.

**D15. The shopper phone app in the pilot?** From: roll-out plan.

- A. Testers only; public in both stores at the open launch. **(recommended)** The store builds so far lack account deletion, which both stores require.
- B. Public from the pilot.

**D16. How many invited shoppers in the pilot?** From: roll-out plan.

- A. 40 to 80, invited one by one. **(recommended)** It meets the roadmap's 40-shopper test with room for no-shows, and one driver can serve it.
- B. No cap.

**D17. Which budget level?** From: go-to-market.

- A. Lean until the pilot's exit test, then base. **(recommended)** It spends on people only after route density is proven.
- B. Base from the pilot.
- C. Bold from the launch.

Cash out before revenue and founder pay: lean ₡441,000–₡978,000; base ₡2.89M–₡4.57M; bold ₡7.10M–₡7.79M. Option A needs about ₡2.1M from week 1 to 13 weeks after the launch, up to ₡11.6M in the worst case (go-to-market §9). Waits on it: hiring, the ad cap, the investor brief.

**D18. Is founder pay in the budget?** From: team structure.

- A. Not until the launch exit test; then at the operations lead's level. **(recommended)** It keeps pilot cash out small, and the accountant can advise on the form.
- B. From the pilot.

Effect: each ₡500,000 a month of founder pay needs about 105 more orders a month, 4 a day, to break even (pricing strategy §3.3). Operations lead ₡564,600–₡1,065,500 loaded (team structure §1).

**D19. How are drivers and the backup person engaged, and whose vehicle?** From: team structure; the drivers' notice waits on it.

- A. Employees with INS work-risk cover, in a vehicle Yuntera provides. **(recommended)** The cost model budgets them so, and two court rulings point that way.
- B. Independent contractors, if the lawyer approves in writing.
- C. Through a courier company.
- D. Their own motorbike, with an allowance.

Cost: A is ₡1,170,000 a driver a month all-in, of which labour ₡564,600 (team structure §1); the backup person ₡150,600 for 8 days. D means working out the ₡45,000 driver-day again; the job may then be "Mensajero" (₡519,200 loaded). For the lawyer to confirm. Waits on it: gate G11, the driver notice, the INS quote.

**D20. Seller commission.** From: pricing strategy.

- A. Keep today's table, 8% to 15% by category. **(recommended)** It sits inside the published range, and route density, not commission, decides the margin.
- B. One flat 10%: a ₡20,000 Hogar seller receives ₡452 more, an electronics seller ₡452 less.
- C. Raise Hogar, Ferretería, Deportes, Juguetes, Mascotas and Libros from 12% to 15%: ₡600 more per ₡20,000 Hogar order; the seller receives ₡678 less.

Waits on it: every fee line in the seller pieces.

**D21. Free-delivery threshold in the core zone.** From: pricing strategy and market research §9 (both recommend A).

- A. Keep ₡25,000; compete on next-day delivery, SINPE Móvil, cash and a local claim route. **(recommended)** At 20 stops a ₡15,000 order earns ₡1,285 with the charge and loses ₡20 without it.
- B. ₡15,000: the company loses about ₡1,305 on each order from ₡15,000 to ₡24,999.
- C. ₡10,000, as Amazon Bazaar used in November 2025: a ₡12,000 order at 20 stops goes from ₡925 to −₡380.

Check Amazon Bazaar's current page before answering C. Waits on it: the zone setting and every "gratis desde ₡25 000".

**D22. Offer for the first sellers.** From: pricing strategy (the marketing README, seller pitch and shop flyer now point here).

- A. A written price lock to a fixed calendar date (about 6 months after the planned launch), storage fee excluded, plus free set-up of the first 20 products. **(recommended)** It costs staff time, not margin, and needs no development.
- B. Commission 4 points lower for everyone for 90 days: −₡520,000 a month at early launch.
- C. No fulfilment fee for 90 days: −₡910,000 a month at early launch.

A freezes the public fee schedule for every seller until that date, because the product has no per-seller rates. The lock wording is for the lawyer. Waits on it: the offer line in the leave-behind, the shop flyer and the deck.

**D23. Storage fee.** From: pricing strategy.

- A. None in the pilot; from the launch, a fee on units stored more than 90 days, at measured cost, with 30 days' notice. **(recommended)** It clears dead stock without charging sellers who are testing.
- B. A fee from the first day: about ₡38 a month per 10-litre box, and it deters new sellers.
- C. Never; ask sellers to remove stock after 180 days.

The charge is not built. Waits on it: the price-lock text (D22).

**D24. Notice before a fee change.** From: pricing strategy; the leave-behind prints it.

- A. 30 days. **(recommended)** Already proposed in pricing and fees, and long enough for a seller to reprice.
- B. 60 days.
- C. 15 days.

Until answered, the leave-behind says "con aviso previo".

**D25. Offer for shoppers, in the pilot and at the launch.** From: go-to-market (pilot offer), pricing strategy (launch offer) and the shopper flyer (whether print carries it). They were three questions; this is one.

- A. Normal delivery charge in the pilot; at the launch, 14 stated days of free delivery in the served cantons, in posts and messages only. **(recommended)** The pilot still measures the charge, and a printed end date misleads once passed.
- B. As A, and printed on the shopper flyer with cantons, dates and every restriction, handed out only in the week before.
- C. First delivery free in the pilot, with start date, end date and number of orders stated.
- D. A first-order discount code.
- E. No offer.

Cost of A: about ₡320,000 (pricing strategy §4.2). A and B need one product-page line changed first ("Envío ₡0." to "Envío gratis"); D needs development and the accountant's answer on IVA. Waits on it: the launch posts and the shopper flyer.

**D26. How often are sellers paid?** From: marketing README.

- A. One payout run a week, on a fixed weekday printed in the seller pieces. **(recommended)** A printed day lets a seller check the promise.
- B. Twice a week.
- C. Whenever finance has time, with no day printed.

Cost: ONVO's US$3 a payout is about ₡5,850 a month weekly, ₡11,700 twice a week and ₡35,100 daily (pricing strategy §2.2). Waits on it: every "[semanal]" in the pieces.

**D27. What must a shop have to join the pilot?** From: seller pitch.

- A. Products with barcodes, electronic invoicing (the Régimen Simplificado only once the accountant answers), and an IBAN account in the shop's name. **(recommended)** Each is needed for a legal, scannable sale today.
- B. The same, but makers without barcodes join with shop-packed orders arranged one by one, and an account in the owner's own name after staff check it.

Waits on it: the seller pitch, the leave-behind and outreach message 5.

**D28. Who visits shops?** From: seller pitch.

- A. The owner for the first 15, then the sales agent with the script. **(recommended)** The roadmap wants the founder to hear the first objections.
- B. A sales agent from the start (₡584,100 a month loaded).

**D29. Who answers the printed WhatsApp number and the comments on posts?** From: marketing README (the social calendar's own question was merged into it).

- A. The owner, Monday to Saturday with the hours printed, for both, through the pilot and the first four weeks of the launch. **(recommended)** An unanswered number breaks the first promise, and early comments are product research.
- B. A sales agent for sellers and the owner for shoppers, on two numbers; a contractor for comments.

Waits on it: the hours line on every piece, gate G9.

**D30. May marketing quote how many Costa Ricans buy online?** From: go-to-market and market research §9 (both recommend A).

- A. No; describe the problem instead. **(recommended)** The three sources disagree (80%, 48.5%, 18%), and adverts need checkable sources (art. 55 g).
- B. "48.5% (UCR, 2022)", with the year shown.
- C. "About 80%", naming the industry source.

**D31. Which company sentence goes on every piece?** From: messaging.

- A. The long one, with the short one for headers and bios. **(recommended)** The long one says what we do for both sides.
- B. The short one only.

**D32. Which tagline in public?** From: messaging.

- A. "Lo que ocupa, a su puerta." only. **(recommended)** It is already in the product, and the others wait for a copy editor.
- B. Also "Usted vende. Nosotros lo llevamos." for sellers, after the copy editor reads it.

**D33. How many follow-ups after the fee sheet?** From: seller outreach.

- A. Two on WhatsApp, at least 5 working days apart, and one by e-mail; then stop. **(recommended)** A busy shop gets a second chance without pressure.
- B. One only.
- C. None; wait for the shop to write.

**D34. Does the check-in after a first order ask for a review?** From: shopper messages.

- A. No; ask only how the delivery went and how they heard of us. **(recommended)** It stays a service message.
- B. Yes, add a review request.

**D35. Which partner first, and which courier takes what the route cannot?** From: partner brief and market research §9.

- A. Correos' Dirección de Pymes: authorisation for the volume tariff (all four tiers), the pickup price, cash collection, and a session for its 20,400 Pymexpress clients. **(recommended)** One meeting serves the courier fallback and seller recruitment.
- B. MEIC first (EXPOPYME and its registers).
- C. A chamber of commerce in the pilot cantons.
- D. Written quotes from Moovin and Boxful before choosing a courier.

Cost: until authorised, Correos' locker price, about ₡2,600 a parcel with IVA; once authorised, ₡1,756.19–₡2,005.53 before IVA by monthly volume, plus ₡1,500–₡2,000 a pickup (go-to-market §6). Waits on it: roll-out phase 0 step 11.

**D36. Meet investors before the pilot?** From: partner and investor brief.

- A. No; send the brief only after 100 pilot orders. **(recommended)** Without a real sale, the three deciding numbers are guesses.
- B. Yes, to fund the pilot.

**D37. Who reviews the words?** From: English research §7, question 8, and the marketing owner steps (copy editors read the pieces in weeks 1–2).

- A. Hire a native English copy editor and a Costa Rican Spanish copy editor, the marketing pieces first, then the screens. **(recommended)** 33,000 words is too much to check by eye.
- B. The team reviews.

Cost: not researched; ask 2 editors for quotes. Waits on it: every "final text" piece, the tagline (D32), the English release.

---

## Before the open launch

**D38. The card fee.** From: pricing strategy and market research §9. Today 3.9% + ₡180; the central bank caps local card acquiring at 1.95%, and the seller centre says the cost passes through "sin recargo".

- A. Before cards go on, ask the gateway in writing how the cap applies and whether IVA is added; then set the fee at contracted cost. **(recommended)** Cards are not in the pilot, so waiting costs nothing.
- B. Keep 3.9% + ₡180, and change the seller-centre wording to say the fixed part covers exchange-rate moves (the lawyer reads it).
- C. Lower the fixed part now to ₡157 (US$0.35 is ₡157.50): the seller receives ₡26 more per card order; the company's card line loses ₡59.00 instead of ₡36.00.
- D. Charge the fixed part in dollars at the central bank's rate of the day.

The market research recommended B; this list recommends A because the cap may make 3.9% itself wrong. Waits on it: the card line of the price sheet; it matters once cards are on (D13).

**D39. Who is the first hire after the backup person?** From: team structure.

- A. A driver (₡1,170,000 a month all-in). **(recommended)** Driving takes the founder off everything else for half of each day.
- B. A sales agent (₡584,100).
- C. A support agent (₡564,600).

The hiring trigger: the open launch, or the founder's route at about 25 delivered stops a day for 2 weeks (team structure §6). Waits on it: when the driver notice is posted.

**D40. How do combined jobs get access, while the product allows one staff role per person?** From: team structure.

- A. Each person gets the role of their main job; the founder (admin) covers the rest. **(recommended)** Buyer data stays with the fewest people.
- B. Give combined-job staff the admin role.
- C. Have the product allow more than one role per person (a change to build).

**D41. Draws and contests in the first 90 days?** From: go-to-market and market research §9.

- A. None. **(recommended)** Each draw needs a written reglamento, a notary or sworn declaration and the winner published nationally (art. 59).
- B. Free-entry draws only, with all of art. 59 met.
- C. Purchase-linked draws, after the lawyer confirms when the JPS must authorise them.

The market research recommended B; this list recommends A so the launch weeks carry no draw paperwork.

**D42. When does paid advertising start?** From: go-to-market.

- A. After the pilot's exit test, with a ₡25,000 test first. **(recommended)** Ads before route density buy scattered orders.
- B. In launch week.

Cap after the test: ₡150,000 a month at the base level, ₡500,000 at bold (go-to-market §9).

**D43. Which day is the launch day?** From: social calendar.

- A. A Monday, so week 1 runs Monday to Saturday with deliveries every day. **(recommended)** The first post promises the next delivery day, and Sunday has none.
- B. Whatever day payments go live.

**D44. Which is the first fair with the flyer and the sign-up card?** From: fair flyer. The 4–6 December 2026 fair is for visiting only, with nothing handed out.

- A. The first regional EXPOPYME of 2027 near the pilot cantons, once gates G1, G2 and G8 are met. **(recommended)** MEIC runs it for small businesses, and a stand gives the sign-up card a table.
- B. Expo Pyme CR 2027, as a visitor.
- C. A local craft or producers' fair in a pilot canton.

Cost: the exhibitor fee was not found; ask MEIC.

**D45. Which English spelling?** From: English research §7, question 2.

- A. American ("canceled", "catalog"). **(recommended)** Most English readers in Costa Rica are assumed to be North American (to verify).
- B. British, as the 446 existing error messages are written.

**D46. Sellers' own words in English?** From: English research §7, question 5.

- A. Shown as the seller wrote them, with a short English note that the text is in Spanish. **(recommended)** Nothing can be mistranslated, and sellers have no new work.
- B. Sellers may add an English title and description later.
- C. Automatic translation (the lawyer would assess a wrong description).

**D47. Legal pages in English?** From: English research §7, question 7.

- A. Spanish stays the binding text, with an English translation beside it reviewed by the lawyer. **(recommended)** The law requires Spanish terms, and an English reader still understands them.
- B. Spanish only, with a short English summary.

---

## Later

**D48. The ask in the investor brief.** From: partner and investor brief. Waits on D36.

- A. Leave it out until D36 is answered. **(recommended)** No amount has been worked out.
- B. The owner writes an amount and use of funds now, from the budget levels in D17.

**D49. When does a bought WhatsApp inbox come in?** From: support research §3.3, question 4.

- A. When two or more people answer WhatsApp at the same time, or above an agreed number of conversations a day. **(recommended)** Until then the phone app is enough and costs nothing.
- B. Before the launch.

Cost: about US$38–138 a month for 2 people (₡17,100–₡62,100), support research §2.4.
