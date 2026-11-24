# Owner decisions

**What this is.** Every question the strategy documents, the marketing pieces and the November research ask the owner, each asked once, in the order the answers are needed. Written 24 November 2026.
**How to answer.** Reply like "D4 A, D10 D". "ok" accepts every recommended option of one group, for example "ok before the pilot". An answer is recorded in `docs/02-architecture/decisions.md`.
**Where they come from.** [Go-to-market](go-to-market.md), [roll-out plan](rollout-plan.md), [team structure](team-structure.md), [pricing strategy](pricing-strategy.md), the [marketing pieces](../../marketing/README.md) and the research in [market and costs](../research/market-and-costs-2026-11.md), [support and system-health tools](../research/support-and-system-health-tools.md) and [English translation](../research/english-translation-plan.md). Those documents point here instead of asking.
**Count.** 54 numbers: 4 already decided, 5 needed now, 2 the builders do unless you object, 31 before the pilot with real money, 10 before the open launch, 2 later. A number never changes once given, so the list is not in number order.

Amounts are colones a month unless stated, from the document named; US dollars at ₡450. Every amount is an estimate or an assumption, as its source says. Questions for the lawyer and the accountant are separate: they are in [compliance](../05-security-compliance/compliance-costa-rica.md) §9 and §10 and in [open questions](../08-open-questions.md) 67 to 82. A decision that waits on one names it.

---

## Already decided

**D1. Where do support and system-health tools live?** Decided 24 November 2026: inside the staff console, as the areas Casos, Salud del sistema and Versiones. WhatsApp stays in the WhatsApp Business app for now. From: support research §3.3, question 1. Waits on it: the support desk build.

**D2. How is system health watched?** Decided 24 November 2026: a Salud del sistema page in the console, plus a free error tracker and a free uptime monitor that send alerts to the owner's phone, with personal data removed. Cost now ₡0. From: support research §3.3, question 2. The tracker is Sentry (D50). Waits on it: roll-out phase 1, step 1.

**D3. Do new Android test builds reach testers without a click?** Decided 23 November 2026: yes, from the first Android release on. The owner made that first release on 23 November 2026, and the build setting was changed on 24 November 2026. Google may refuse such a build before its first review of the app (not verified); the build then arrives as a draft. From: `STATUS.md`, "What needs you", item 11, step 7; [store testing](../07-deployment/store-testing.md) §7. Changing the build setting is the builders' work.

**D50. Which error tracker?** Decided 24 November 2026: Sentry, on its free plan, in the owner's existing account. Only projects whose names start with yuntera are created there; names, phones, e-mails and addresses are removed before anything is sent; alerts arrive by e-mail. The four websites come first; the phone apps follow with their next version. Cost ₡0 now; US$26 a month on a yearly plan (₡11,700) once a second developer joins (support research §2.4). From: support research §3.3, question 5. Waits on it: the error-tracking build.

---

## Needed now

**D4. When is week 1?** From: roll-out plan.

- A. The week the lawyer and the accountant are engaged. **(recommended)** Their answers gate the company, the gateway and the tax registration.
- B. This week, with the advisers found later. Some work may have to be redone once they answer.

Cost: lawyer's first package ₡1,000,000–₡3,000,000 once, accountant ₡100,000–₡300,000 a month (go-to-market §9, assumptions). Waits on it: every week number in the roll-out plan, go-to-market §7 and the marketing owner steps.

**D6. Which apps get English first?** From: English research §7, question 1.

- A. All eight apps at once. The largest block of work comes first.
- B. Shoppers first (shop website, shop app, messages, help), then sellers, then staff and drivers. **(recommended)** Shoppers are the people who may not read Spanish.
- C. Shoppers and sellers only; staff and drivers stay in Spanish. Staff and drivers must read Spanish.

Size: about 33,300 different words (45,167 in all); the staff console holds 11,729 of all words, about a quarter. Waits on it: the start of the English work.

**D7. Which language does a person see first?** From: English research §7, question 3.

- A. On the web, Spanish with a one-line offer of English; on a phone set to English, English. The choice is remembered. **(recommended)** Spanish stays the default, and Google advises against automatic redirects.
- B. Always Spanish until the person switches. A visitor who reads only English must find the switch.
- C. Always the browser's or the phone's language. A Costa Rican with an English phone sees English without asking.

Waits on it: the English foundation.

**D9. How do amounts look in English?** From: marketing README and English research §7, question 6.

- A. `₡25 000` in English too, on screens, receipts and print. **(recommended)** The brand book fixes one money format, so paper and screen show the same figure.
- B. `₡25,000` in English, on screens and print. The product needs a second money format.
- C. `₡25,000` in English print only; screens keep `₡25 000`. Paper and screen then differ.

Cost: none. Waits on it: every amount in the English copy (the pieces follow A until answered).

**D45. Which English spelling?** From: English research §7, question 2.

- A. American ("canceled", "catalog"). **(recommended)** Most English readers in Costa Rica are assumed to be North American (to verify).
- B. British, as the 446 existing error messages are written. Those messages stay, and the marketing pieces change.

Waits on it: the English work and the English columns of the marketing pieces (American until answered).

---

## The builders do these unless you object

**D5. Bug reports and releases.** The builders keep bug reports in the code repository's free issue list, follow a one-page checklist before each release, and add a console page that shows which version runs. Cost ₡0. The other option was a bought test tool (price not researched). From: support research §3.3, question 3.

**D8. English web addresses.** English pages keep today's addresses with `/en` in front, so every link already sent keeps working. The other option was translated addresses, which needs a second set of links. From: English research §7, question 4.

---

## Before the pilot with real money

**D10. Which cantons does the pilot serve?** From: go-to-market.

- A. East: San José Central, Montes de Oca, Curridabat, Goicoechea, Moravia. Central to the rest of the core, with heavy traffic.
- B. West: Escazú, Santa Ana, Belén. Close together; a fulfilment competitor opened in Escazú in December 2025.
- C. North: Heredia Central, Santo Domingo, San Pablo, Flores. Compact; Heredia had a third of San José's online buyers in 2022.
- D. The 3 to 5 adjacent core cantons around the 5 signed sellers and the warehouse. **(recommended)** No source tells the clusters apart, and routes fill fastest where stock and first customers are.

Until 5 sellers sign, seller pieces print "en el centro del Valle Central" in place of `[cantones]`; the cantons are fixed when the fifth seller signs. Waits on it: the zones in the console (gate G7), the warehouse lease, every `[cantones]` in the pieces.

**D53. Which categories does the pilot sell?** From: open question 9; the shopper flyer prints "[3 o 4 categorías del lanzamiento]".

- A. The four in market and wedge: urgent replacements, bulky goods, electronics with a local warranty, packaged goods made in Costa Rica. The flyer names the 3 or 4 that signed sellers carry. **(recommended)** Go-to-market §2.1 already recruits sellers by them.
- B. Whatever the first 5 sellers sell. Recruiting has no focus, and baskets may be small.

Waits on it: the "What you can buy" line on the shopper flyer.

**D11. How big is the warehouse?** From: roll-out plan.

- A. About 20 m² near the first sellers for the pilot; about 50 m² at the launch. **(recommended)** 5 to 10 sellers at 5 to 10 orders a day fit, and every budget assumes these sizes.
- B. About 50 m² from the pilot, to avoid a move: ₡108,000–₡189,000 a month more in the pilot.
- C. About 100 m²: ₡288,000–₡504,000 a month more than A in the pilot.

Rent (assumption, US$8–14 per m²): 20 m² ₡72,000–₡126,000; 50 m² ₡180,000–₡315,000; 100 m² ₡360,000–₡630,000 (go-to-market §9). Waits on it: the lease (weeks 2–6), shelving, gate G8.

**D12. Which address goes on the shop's legal footer and on print?** From: gate G2; the shop footer, every printed piece and the seller agreement need one.

- A. The company's registered address, as the lawyer sets it at incorporation; the warehouse address goes only to sellers bringing stock. If that address would be the owner's home, use a lawyer's or a virtual office. **(recommended)** It keeps the warehouse and the owner's home off public print.
- B. The warehouse address. Anyone can find where the stock is.
- C. The owner's home address. The owner's home is on every flyer.

For the lawyer to confirm what the law requires on the footer. Waits on it: gate G2, roll-out phase 2 item 3, every print footer.

**D13. Which payment methods in the pilot?** From: roll-out plan.

- A. SINPE Móvil and cash on delivery; cards at the open launch. **(recommended)** Scope by app puts cards at Launch, and fewer methods means less to reconcile by hand.
- B. SINPE Móvil, cash and cards from the pilot. The card fee (D38) must be settled first.
- C. Cash on delivery only. Every order is cash the driver carries.

Waits on it: the "[tarjeta, si está activa]" lines.

**D14. What is the cash-on-delivery ceiling?** From: roll-out plan.

- A. ₡50,000 an order in the pilot; back to ₡150,000 at the open launch only if the pilot's cash variance was zero. **(recommended)** One driver carries the cash, and the console changes it in one step.
- B. Keep today's ₡150,000 throughout. One driver may carry more cash than is safe.

Printed material never states the ceiling as a fixed number; it reads the setting on the print day ("hasta ₡[límite vigente]"). Waits on it: the console setting in roll-out phase 2.

**D15. Is the shopper phone app public in the pilot?** From: roll-out plan.

- A. Testers only; public in both stores at the open launch. **(recommended)** The store builds so far lack account deletion, which both stores require.
- B. Public from the pilot. A store may reject or remove it.

**D16. How many invited shoppers in the pilot?** From: roll-out plan.

- A. 40 to 80, invited one by one. **(recommended)** It meets the roadmap's 40-shopper test with room for no-shows, and one driver can serve it.
- B. No cap. One driver may not reach every order.

**D17. Which budget level?** From: go-to-market.

- A. Lean until the pilot's exit test, then base. **(recommended)** It spends on people only after route density is proven.
- B. Base from the pilot. The pilot pays a launch team before any route is proven.
- C. Bold from the launch. It breaks even only at 55 to 60 orders a day.

Cash out before revenue and founder pay: lean ₡441,000–₡978,000; base ₡2.89M–₡4.57M; bold ₡7.10M–₡7.79M. Option A needs about ₡2.2M from week 1 to 13 weeks after the launch, up to ₡11.6M in the worst case (go-to-market §9). Waits on it: hiring, the ad cap, the investor brief.

**D18. Is founder pay in the budget?** From: team structure.

- A. Not until the launch exit test; then at the operations lead's level. **(recommended)** It keeps pilot cash out small, and the accountant can advise on the form.
- B. From the pilot. The pilot needs more cash from day one.

Effect: each ₡500,000 a month of founder pay needs about 105 more orders a month, 4 a day, to break even. One driver is already at its limit, so the first ₡500,000 also needs a second driver: about 934 orders, 36 a day (pricing strategy §3.3). Operations lead ₡564,600–₡1,065,500 loaded (team structure §1).

**D19. How are drivers and the backup person engaged?** From: team structure; the driver notice waits on it.

- A. Employees with INS work-risk cover. **(recommended)** The cost model budgets them so, and two court rulings point that way.
- B. Independent contractors, if the lawyer approves in writing. A court may still find them employees.
- C. Through a courier company. No hiring, and Yuntera does not choose or train the drivers.

Cost of A: ₡1,170,000 a driver a month all-in, of which labour ₡564,600, paid by the day at the legal minimum (team structure §1); the backup person ₡150,600 for 8 days. For the lawyer and the accountant (open questions 70 and 79). Waits on it: gate G11, the driver notice, the INS quote.

**D54. Whose vehicle do drivers use?** From: team structure; the driver notice.

- A. A vehicle Yuntera provides. **(recommended)** The ₡45,000 driver-day already includes it.
- B. Their own motorbike, with an allowance. The ₡45,000 driver-day must be worked out again, and the job may then be "Mensajero" (₡519,200 loaded).

Waits on it: the vehicle line of the driver notice.

**D20. Do seller commissions change before the pilot?** From: pricing strategy.

- A. No: keep today's table, 8% to 15% by category. **(recommended)** It sits inside the published range, and route density, not commission, decides the margin.
- B. One flat 10%: a ₡20,000 Hogar seller receives ₡452 more, an electronics seller ₡452 less.
- C. Raise Hogar, Ferretería, Deportes, Juguetes, Mascotas and Libros from 12% to 15%: ₡600 more per ₡20,000 Hogar order; the seller receives ₡678 less.

If D22 A is chosen, a rise waits until the lock date; a fall can happen at any time. Waits on it: every fee line in the seller pieces.

**D21. Does the free-delivery threshold in the core zone change?** From: pricing strategy and market research §9 (both recommend A).

- A. No: keep ₡25,000; compete on next-day delivery, SINPE Móvil, cash and a local claim route. **(recommended)** At 20 stops a ₡15,000 order earns ₡1,285 with the charge and loses ₡20 without it.
- B. Lower it to ₡15,000 for good: the company loses about ₡1,305 on each order from ₡15,000 to ₡24,999.
- C. Lower it to ₡10,000 for good, as Amazon Bazaar used in November 2025: a ₡12,000 order at 20 stops goes from ₡925 to −₡380.

A dated ₡10,000 window at the launch only would be a shopper offer under D25, not a threshold. Check Amazon Bazaar's current page before answering C. Waits on it: the zone setting and every "gratis desde ₡25 000".

**D22. What do the first sellers get for joining?** From: pricing strategy, marketing README, seller pitch, shop flyer.

- A. A written price lock to a fixed calendar date (about 6 months after the planned launch), storage fee excluded, plus free set-up of the first 20 products. **(recommended)** It costs staff time, not margin, and needs no development.
- B. Commission 4 points lower for everyone for 90 days: −₡457,600 a month at early launch (572 orders).
- C. No fulfilment fee for 90 days: −₡800,800 a month at early launch.
- D. No joining offer: the pieces drop the offer line. No cost, and one less reason for a shop to join now.

A freezes the public fee schedule for every seller until that date, because the product has no per-seller rates. The lock wording is for the lawyer (open question 72). Waits on it: the offer line in the leave-behind, the shop flyer and the deck.

**D23. Is there a storage fee?** From: pricing strategy.

- A. None in the pilot; from the launch, a fee on units stored more than 90 days, at measured cost, with 30 days' notice. **(recommended)** It clears dead stock without charging sellers who are testing.
- B. A fee from the first day: about ₡38 a month per 10-litre box, and it deters new sellers.
- C. Never; ask sellers to remove stock after 180 days. Dead stock fills the shelves for half a year.

The charge is not built. Waits on it: the price-lock text (D22).

**D24. How much notice before a fee change?** From: pricing strategy; the leave-behind prints it.

- A. 30 days. **(recommended)** Already proposed in pricing and fees, and long enough for a seller to reprice.
- B. 60 days. A wrong fee stays in place two months.
- C. 15 days. A seller may not have time to reprice.

Until answered, the leave-behind says "con aviso previo".

**D25. Which offer do shoppers get, in the pilot and at the launch?** From: go-to-market, pricing strategy, shopper flyer.

- A. Pilot: normal delivery charge. Launch: 14 stated days of free delivery in the served cantons, in posts and messages only. **(recommended)** The pilot still measures the charge, and a printed end date misleads once passed.
- B. Pilot: normal charge. Launch: as A, and also printed on the shopper flyer with cantons, dates and every restriction, handed out only in the week before.
- C. Pilot: first delivery free, with start date, end date and number of orders stated. Launch: no offer.
- D. Pilot: no offer. Launch: a first-order discount code. It needs development and the accountant's answer on IVA.
- E. No offer in the pilot or at the launch.

Cost of A: about ₡320,000 (pricing strategy §4.2). A and B need one product-page line changed first ("Envío ₡0." to "Envío gratis"). The window wording is for the lawyer (open question 72). Waits on it: the launch posts and the shopper flyer.

**D26. How often are sellers paid?** From: marketing README.

- A. One payout run a week, on a fixed weekday printed in the seller pieces. **(recommended)** A printed day lets a seller check the promise.
- B. Twice a week: twice the transfer cost and twice the finance work.
- C. Whenever finance has time, with no day printed. A seller cannot check the promise.

Cost: ONVO's US$3 a payout is about ₡5,850 a month weekly, ₡11,700 twice a week and ₡35,100 daily (pricing strategy §2.2). Waits on it: every "[semanal]" in the pieces.

**D27. What must a shop have to join the pilot?** From: seller pitch.

- A. Products with barcodes, electronic invoicing (the Régimen Simplificado only once the accountant answers), and an IBAN account in the shop's name. **(recommended)** Each is needed for a legal, scannable sale today.
- B. The same, but makers without barcodes join with shop-packed orders arranged one by one, and an account in the owner's own name after staff check it. More makers join, with more work by hand.

Waits on it: the seller pitch, the leave-behind and outreach message 5.

**D28. Who visits shops?** From: seller pitch.

- A. The owner for the first 15, then the sales agent with the script. **(recommended)** The roadmap wants the founder to hear the first objections.
- B. A sales agent from the start (₡584,100 a month loaded). The founder does not hear the first objections.

**D29. Who answers the printed WhatsApp number and the comments on posts?** From: marketing README and social calendar.

- A. The owner, Monday to Saturday with the hours printed, for both, through the pilot and the first four weeks of the launch. **(recommended)** An unanswered number breaks the first promise, and early comments are product research.
- B. A sales agent for sellers and the owner for shoppers, on two numbers; a contractor for comments. Two numbers to print, and a contractor to pay.

Waits on it: the hours line on every piece, gate G9.

**D30. May marketing quote how many Costa Ricans buy online?** From: go-to-market and market research §9 (both recommend A).

- A. No; describe the problem instead. **(recommended)** The three sources disagree (80%, 48.5%, 18%), and adverts need checkable sources (art. 55 g).
- B. "48.5% (UCR, 2022)", with the year shown. Checkable, and four years old.
- C. "About 80%", naming the industry source. The source cannot be checked.

**D31. Which company sentence goes on every piece?** From: messaging.

- A. The long one, with the short one for headers and bios. **(recommended)** The long one says what we do for both sides.
- B. The short one only. It does not say what sellers get.

**D32. Which tagline goes in public?** From: messaging.

- A. "Lo que ocupa, a su puerta." only. **(recommended)** It is already in the product, and the others wait for a copy editor.
- B. Also "Usted vende. Nosotros lo llevamos." for sellers, after the copy editor reads it. Two taglines to keep consistent.

**D33. How many follow-ups after the fee sheet?** From: seller outreach.

- A. Two on WhatsApp, at least 5 working days apart, and one by e-mail; then stop. **(recommended)** A busy shop gets a second chance without pressure.
- B. One only. Some busy shops are lost.
- C. None; wait for the shop to write. Most busy shops never write.

Whether a first message to a shop is lawful is for the lawyer (open question 73).

**D34. Does the check-in after a first order ask for a review?** From: shopper messages.

- A. No; ask only how the delivery went and how they heard of us. **(recommended)** It stays a service message.
- B. Yes, add a review request. The message may then count as commercial and need consent (for the lawyer).

**D35. Which partner first?** From: partner and investor brief.

- A. Correos' Dirección de Pymes: the volume tariff, cash collection, and a session for its 20,400 Pymexpress clients. **(recommended)** One meeting serves the courier fallback and seller recruitment.
- B. MEIC first (EXPOPYME and its registers). It reaches many small businesses and settles no courier question.
- C. A chamber of commerce in the pilot cantons. Local, and smaller.

Waits on it: roll-out phase 0 step 11.

**D51. Which courier carries parcels the route cannot?** From: market research §9.

- A. Correos' volume tariff, once Correos authorises it; its locker price until then. **(recommended)** It is the only published courier price.
- B. Written quotes from Moovin and Boxful first, then choose. The choice waits for their answers, and Boxful also competes for sellers.
- C. Uber Direct, for same-day parcels only. It publishes no merchant price.

Cost of A: until authorised, about ₡2,600 a parcel with IVA; once authorised, ₡1,756.19–₡2,005.53 before IVA by monthly volume for parcels dropped off, or ₡1,500–₡2,000 a collection plus ₡1,890 a small parcel if Correos collects (go-to-market §6). Whether its IVA can be credited is for the accountant (open question 67). Waits on it: the courier line in the budget.

**D36. Meet investors before the pilot?** From: partner and investor brief.

- A. No; send the brief only after 100 pilot orders. **(recommended)** Without a real sale, the three deciding numbers are guesses.
- B. Yes, to fund the pilot. Investors judge the business on guesses.

**D37. Who reviews the words?** From: English research §7, question 8, and the marketing owner steps.

- A. Hire a native English copy editor and a Costa Rican Spanish copy editor, the marketing pieces first, then the screens. **(recommended)** 33,000 words is too much to check by eye.
- B. The team reviews. No cost, and mistakes reach print.

Cost: not researched; ask 2 editors for quotes. Waits on it: every "final text" piece, the tagline (D32), the English release.

---

## Before the open launch

**D38. What is the card fee?** From: pricing strategy and market research §9. Today 3.9% + ₡180; the central bank caps local card acquiring at 1.95%, and the seller centre says the cost passes through "sin recargo".

- A. Keep cards off until the gateway answers in writing how the cap applies and whether IVA is added; then choose B, C or D on its answer. **(recommended)** Cards are not in the pilot, so waiting costs nothing, and the cap may make 3.9% itself wrong.
- B. Keep 3.9% + ₡180, and change the seller-centre wording to say the fixed part covers exchange-rate moves (the lawyer reads it).
- C. Lower the fixed part now to ₡157 (US$0.35 is ₡157.50): the seller receives ₡26 more per card order; the company's card line loses ₡59 instead of ₡36.
- D. Charge the fixed part in dollars at the central bank's rate of the day. The fee on a seller's statement changes every day.

The market research recommended B; this list recommends A because the cap may make 3.9% itself wrong. If D22 A is chosen, a rise waits until the lock date; a fall can happen at any time. For the lawyer and the gateway (open question 69). Waits on it: the card line of the price sheet.

**D39. Who is the first hire after the backup person?** From: team structure.

- A. A driver (₡1,170,000 a month all-in). **(recommended)** Driving takes the founder off everything else for half of each day.
- B. A sales agent (₡584,100). The founder keeps driving.
- C. A support agent (₡564,600). The founder keeps driving.

The hiring trigger: the open launch, or the founder's route at about 23 delivered stops a day for 2 weeks (team structure §6). Waits on it: when the driver notice is posted.

**D40. How do people with two jobs get access, while the product allows one staff role per person?** From: team structure.

- A. Each person gets the role of their main job; the founder (admin) covers the rest. **(recommended)** Buyer data stays with the fewest people.
- B. Give them the admin role. They see everything, including all buyer data.
- C. Have the product allow more than one role per person. It must be built first.

**D41. Are there draws or contests in the first 90 days?** From: go-to-market and market research §9.

- A. None. **(recommended)** Each draw needs a written reglamento, a notary or sworn declaration and the winner published nationally (art. 59).
- B. Free-entry draws only, with all of art. 59 met. Paperwork for each draw.
- C. Purchase-linked draws, after the lawyer confirms when the JPS must authorise them (open question 75).

The market research recommended B; this list recommends A so the launch weeks carry no draw paperwork.

**D42. When does paid advertising start?** From: go-to-market.

- A. After the pilot's exit test, with a ₡25,000 test first. **(recommended)** Ads before route density buy scattered orders.
- B. In launch week. Orders arrive from every canton before routes are full.

Cap after the test: ₡150,000 a month at the base level, ₡500,000 at bold (go-to-market §9).

**D43. Which day is the launch day?** From: social calendar.

- A. A Monday, so week 1 runs Monday to Saturday with deliveries every day. **(recommended)** The first post promises the next delivery day, and Sunday has none.
- B. Whatever day payments go live. The first post may promise a day with no delivery.

**D44. Which is the first fair with the flyer and the sign-up card?** From: fair flyer. The 4–6 December 2026 fair is for visiting only, with nothing handed out.

- A. The first regional EXPOPYME of 2027 near the pilot cantons, once gates G1, G2 and G8 are met. **(recommended)** MEIC runs it for small businesses, and a stand gives the sign-up card a table.
- B. Expo Pyme CR 2027, as a visitor. No stand, so no sign-up cards.
- C. A local craft or producers' fair in a pilot canton. Close to the routes, with fewer visitors.

Cost: the exhibitor fee was not found; ask MEIC. Keeping the sign-up cards and handing out flyers are for the lawyer (open questions 74 and 77).

**D52. Does the payout hold count business days?** From: seller pitch §5; open question 76.

- A. Count business days, so the hold always covers the 8-business-day withdrawal window. **(recommended)** A return after payout then never needs taking off the next payout.
- B. Keep 10 calendar days, and take a return off the next payout. Sellers are paid sooner.

A is a product change: the hold counts calendar days today. Waits on it: the payout line in the seller pieces.

**D46. Can sellers' own words appear in English?** From: English research §7, question 5.

- A. Shown as the seller wrote them, with a short English note that the text is in Spanish. **(recommended)** Nothing can be mistranslated, and sellers have no new work.
- B. Sellers may add an English title and description later. More work for sellers, and two texts to check.
- C. Automatic translation. A wrong description becomes Yuntera's problem (the lawyer would assess it).

It can wait: until it is answered, sellers' words show as written, which is option A.

**D47. Are legal pages in English?** From: English research §7, question 7.

- A. Spanish stays the binding text, with an English translation beside it reviewed by the lawyer. **(recommended)** The law requires Spanish terms, and an English reader still understands them.
- B. Spanish only, with a short English summary. An English reader may miss a term.

---

## Later

**D48. Does the investor brief state an ask?** From: partner and investor brief. Waits on D36.

- A. Leave it out until D36 is answered. **(recommended)** No amount has been worked out.
- B. The owner writes an amount and use of funds now, from the budget levels in D17. The amount rests on guesses.

**D49. When does a bought WhatsApp inbox come in?** From: support research §3.3, question 4.

- A. When two or more people answer WhatsApp at the same time, or above an agreed number of conversations a day. **(recommended)** Until then the phone app is enough and costs nothing.
- B. Before the launch. A monthly cost before two people share the number.

Cost: about US$38–138 a month for 2 people (₡17,100–₡62,100), support research §2.4.
