# Flyer: shoppers in the first delivery cantons

**What it is.** The copy and specification of a flyer for households and workplaces in the cantons Yuntera serves first, handed out door to door or left on a pilot seller's counter.
**Conclusion 1.** It sells three checkable facts: the 2 p.m. cutoff with the exact date shown before paying, paying by SINPE Móvil or cash, and returns stated as plainly as the price, with the law's exceptions.
**Conclusion 2.** It is for the open launch, not the closed pilot: the pilot has invited shoppers only and no public posts (go-to-market §7.1). The pilot's only shopper piece is the [parcel card](parcel-card.md).
**Conclusion 3.** Two codes (COMPRA-1 door to door, COMPRA-2 on a counter) show which way of handing it out works.
**The owner must decide** whether there is a shopper offer and whether the printed flyer carries it: both are D25 in the [owner decisions](../../docs/00-strategy/owner-decisions.md) list.

**Gates:** G1, G2, G3, G4, G6, G7, G9, G12. Use after: the shop is public, payments are live, the complaint form is wired, and the named cantons are the only ones served.

---

## Format

| Item                     | Specification                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Size                     | Media carta, 21.6 × 14.0 cm, landscape. Front Spanish, back English                                                                                         |
| Bleed and safe area      | 3 mm bleed on every edge (print file 22.2 × 14.6 cm); all text and the QR at least 5 mm inside the trim. Assumption: confirm with the print shop's own spec |
| Paper                    | 150 g/m² or heavier, matte, so it can be written on and does not curl in a mailbox (assumption)                                                             |
| Quantity for a first run | 500, split 400 door to door (COMPRA-1) and 100 for counters (COMPRA-2): two print runs or a code changed on the plate                                       |
| Type size                | Body at least 10 pt; prices at least 14 pt; the canton list at least 10 pt                                                                                  |
| Contrast and colour      | Brand tokens only (brand book §7); nothing said by colour alone                                                                                             |

## What the picture shows

A parcel being handed over at an ordinary Costa Rican gate or a house door with a reja, seen from the street, during the day. The driver's hands and the parcel; no faces, no licence plates, no house number readable (brand book §14). Real photograph if one can be taken with permission; otherwise a simple drawing in the brand's illustration style. No toucans, flags or beaches.

## Copy

| Zone                              | Español (usted)                                                                                                                                                                                                                                         | English                                                                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Headline                          | Pida de lunes a sábado antes de las 2 p. m. y, por lo general, le llega el siguiente día de entrega. La fecha exacta la ve antes de pagar.                                                                                                              | Order Monday to Saturday before 2 p.m. and it usually arrives the next delivery day. You see the exact date before you pay.                                                                                              |
| Subhead                           | Tiendas de Costa Rica, con repartidores propios, en [cantones].                                                                                                                                                                                         | Costa Rican shops, with our own drivers, in [cantons].                                                                                                                                                                   |
| What you can buy                  | [3 o 4 categorías del lanzamiento, por ejemplo: cargadores y cables, artículos para la casa, comida para mascotas, café y artesanía de Costa Rica.]                                                                                                     | [3 or 4 launch categories, for example: chargers and cables, home goods, pet food, Costa Rican coffee and crafts.]                                                                                                       |
| Point 1                           | **Pague como ya paga.** SINPE Móvil o efectivo al recibir (hasta ₡[límite vigente]). [Tarjeta, si está activa.]                                                                                                                                         | **Pay the way you already pay.** SINPE Móvil or cash when it arrives (up to ₡[current limit]). [Card, if switched on.]                                                                                                   |
| Point 2                           | **Sepa cuándo llega y cuánto paga.** Antes de pagar ve la fecha de entrega y el total con IVA y envío.                                                                                                                                                  | **Know when it arrives and what you pay.** Before you pay you see the delivery date and the total with IVA and delivery.                                                                                                 |
| Point 3                           | **Solo usted tiene el código.** El repartidor le pide un código de cuatro dígitos que usted ve en su pedido. Nadie de Yuntera se lo pide por teléfono ni por mensaje.                                                                                   | **Only you have the code.** The driver asks for a four-digit code you see on your order. Nobody from Yuntera asks for it by phone or message.                                                                            |
| Point 4                           | **Si no le sirve, lo devuelve.** Tiene 8 días hábiles desde que recibe, sin dar explicaciones, salvo las excepciones de ley (perecederos, artículos de uso personal abiertos, hechos a la medida). El reembolso llega en un máximo de 8 días naturales. | **If it's not right, return it.** You have 8 business days from delivery, no reason needed, except as the law excludes (perishables, opened personal items, made to measure). The refund arrives within 8 calendar days. |
| Delivery line                     | Envío ₡1 500. Gratis en pedidos desde ₡25 000. Solo en [cantones].                                                                                                                                                                                      | Delivery ₡1 500. Free on orders from ₡25 000. Only in [cantons].                                                                                                                                                         |
| Call to action                    | Escanee el código o entre a [www.yuntera.cr]. ¿Dudas? Escríbanos al [número], de lunes a sábado, [horas].                                                                                                                                               | Scan the code or go to [www.yuntera.cr]. Questions? Write to us at [number], Monday to Saturday, [hours].                                                                                                                |
| Language line (English side only) | —                                                                                                                                                                                                                                                       | The shop is in Spanish for now.                                                                                                                                                                                          |
| Footer                            | [Nombre legal], cédula jurídica [número], [dirección]. Información vigente al [fecha]. Código COMPRA-1.                                                                                                                                                 | [Legal name], legal ID [number], [address]. Information valid on [date]. Code COMPRA-1.                                                                                                                                  |

Every fact is from the product: cutoff 14:00, Monday to Saturday, next day and ₡1,500 / ₡25,000 (`geography_data.sql`, zone `gam-core`); the conditions on the date (`promise.ts`: a seller-shipped item adds handling days, a Sunday order arrives on Tuesday, a full day or a zone closure moves the date; hence "por lo general" and "la fecha exacta"); the cash limit (`cod_max_order_minor`, ₡150,000 today; owner decision D14 proposes ₡50,000 for the pilot, so read the console on the print day); four-digit code and the "nadie se lo pide" wording (help page; brand book §4); returns, the exceptions and refund (help page; compliance §1). The categories line follows go-to-market §2.1 and is filled from what the pilot shops actually sell, re-read on the print day; a shop's name goes on it only with its written permission. The delivery fee and threshold are assumptions in the repository: re-read the zone in the console the day the flyer goes to print. The headline and point 4 are G12 lines.

## Call to action and how the result is measured

| Item                           | Specification                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QR code                        | Opens the shop's home page. While the product records no campaign, the QR on the counter version opens WhatsApp with "Hola, vengo del volante COMPRA-2" instead, so counters can be counted |
| Measure                        | WhatsApp messages carrying COMPRA-1 or COMPRA-2, counted every Saturday; new shopper accounts in the served cantons in the 14 days after the drop, compared with the 14 days before (rough) |
| Better measure, needs building | A short address per code that the shop records (a product gap, not built)                                                                                                                   |
| Who hands out                  | Owner or a paid helper; counters only with the seller's yes                                                                                                                                 |
| Done when                      | 500 handed out; the count written in the Saturday spreadsheet                                                                                                                               |

Door-to-door rules: put it in the mailbox or hand it over; never in a gate's lock; no flyer on cars. Whether the canton requires a permit for street distribution is for the lawyer to confirm.

---

## Decision for the owner

Whether there is a shopper offer, and whether the printed flyer carries it, is
owner decision D25. Its recommended option keeps the offer off the printed
flyer: a flyer stays in kitchens for weeks, and an end date printed on it
becomes misleading after that date (art. 55 i).

## Assumptions to verify

| Assumption                                          | How to verify                           |
| --------------------------------------------------- | --------------------------------------- |
| Media carta is a standard size at local print shops | Two quotes                              |
| 400 doors can be covered in one day by one person   | Time the first 100                      |
| People scan the QR rather than type the address     | Count COMPRA codes against new accounts |

## Sources

- Repository: `supabase/migrations/20261121080300_geography_data.sql`, `20261121080000_foundation.sql`; `packages/core/src/promise.ts`; `apps/web/src/app/ayuda/page.tsx`; `docs/brand/brand-book.md` §4, §7, §14; `docs/05-security-compliance/compliance-costa-rica.md` §1; `STATUS.md`.
- [Market research](../../docs/research/market-and-costs-2026-11.md) of 24 November 2026, §7.4 (Decreto 37899-MEIC art. 55). Go-to-market §2.1 (launch categories), §3 (the promise sentence); owner decisions D14 (cash limit) and D25 (shopper offer).
- Paper sizes: Instituto Tecnológico de Costa Rica, "¿Cómo funciona el servicio de impresión?" (revised 19 January 2024), which names Carta, Tabloide and A3 as its print sizes, https://www.tec.ac.cr/sites/default/files/media/doc/Impresion%20-%20Servicio%20de%20Impresion.pdf (read 24 November 2026). No commercial print shop's price list or spec sheet was found; bleed and safe margins are common practice, to confirm with the print shop.
