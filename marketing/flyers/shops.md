# Flyer: shops that already sell

**What it is.** A small flyer left with a shop on a visit, or after a visit that could not happen, inviting it to join the closed pilot. The full fee sheet is the separate one-page leave-behind ([seller pitch §3](../sales/seller-pitch.md#3-the-one-page-leave-behind)).
**Conclusion 1.** It carries one promise (we store, pack, deliver and collect), one worked sale (₡20,000 → ₡15,367) and one ask (write to us).
**Conclusion 2.** It says the pilot has no real sale yet; a shop that joins knowing that does not feel misled later.
**Conclusion 3.** Code VENDE-1 on the QR counts how many shops write after a flyer.
**The owner must decide** nothing new here. The offer line follows the pricing proposal's decision 4, and the payout day README decision 3.

**Gates:** G1, G2, G8, G9. G4 before the "paid when the gateway confirms" line. The headline goes to the copy editor with the taglines (messaging, decision 2): it is a sentence, but close to "Usted vende. Nosotros lo llevamos."

---

## Format

| Item                | Specification                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Size                | Media carta, 21.6 × 14.0 cm, portrait. Front Spanish, back English                                                |
| Bleed and safe area | 3 mm bleed (print file 22.2 × 14.6 cm); text and QR 5 mm inside the trim. Assumption: confirm with the print shop |
| Paper               | 200 g/m² or heavier, so it stands up on a counter (assumption)                                                    |
| Quantity            | 200 for the first two pilot cantons; reprint after the first 50 visits with the shops' own words                  |
| Type size           | Body at least 10 pt; amounts at least 14 pt                                                                       |

## What the picture shows

The back room of a small shop: shelves with boxed goods, a hand putting a product into a labelled bin, or boxes being handed over a counter. No faces needed; no other brand's logo visible (originality rule, CLAUDE.md; brand book §14). Real photograph with permission, or a drawing.

## Copy

| Zone           | Español (usted)                                                                                                                                                                                                                          | English                                                                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headline       | Usted vende. Nosotros guardamos, empacamos, entregamos y le cobramos al cliente.                                                                                                                                                         | You sell. We store, pack, deliver and collect from the customer.                                                                                                                                                |
| Body           | Traiga su producto una vez a nuestra bodega, el día que coordinemos. Cuando alguien compra, lo empacamos y nuestro repartidor lo entrega en [cantones]. El comprador paga con SINPE Móvil o en efectivo al recibir.                      | Bring your product to our warehouse once, on a day we agree. When someone buys, we pack it and our driver delivers it in [cantons]. The buyer pays by SINPE Móvil or cash on delivery.                          |
| Example box    | Una venta de ₡20 000 en Hogar, pagada por SINPE Móvil: comisión, bodega, cobro e IVA de esos cargos suman ₡4 633. **Usted recibe ₡15 367.**                                                                                              | A ₡20,000 home sale paid by SINPE Móvil: commission, warehouse, collection and IVA on those fees add up to ₡4,633. **You receive ₡15,367.**                                                                     |
| Three facts    | Sin mensualidad ni costo por publicar. · Antes de publicar ve cada cargo. · Su dinero queda disponible 10 días después de la entrega y se lo transferimos en el pago [semanal] siguiente.                                                | No monthly fee and no listing fee. · You see every fee before you list. · Your money becomes available 10 days after delivery and we transfer it in the next [weekly] payout.                                   |
| Pilot line     | Todavía no hemos hecho una venta real. Buscamos cinco tiendas para un piloto cerrado. [Oferta, si se decide: Si se une antes del [fecha], sus tarifas no suben antes del [fecha de fin]; no incluye el cargo por almacenaje prolongado.] | We have not made a real sale yet. We are looking for five shops for a closed pilot. [Offer, if chosen: If you join before [date], your fees do not rise before [end date]; this excludes the long-storage fee.] |
| Call to action | Escanee el código y escríbanos. Le mandamos todas las tarifas y le explicamos los pasos.                                                                                                                                                 | Scan the code and write to us. We'll send you every fee and explain the steps.                                                                                                                                  |
| Footer         | [Número de WhatsApp], lunes a sábado, [horas] · [Nombre legal], cédula jurídica [número] · Tarifas del piloto vigentes al [fecha] · Código VENDE-1                                                                                       | [WhatsApp number], Monday to Saturday, [hours] · [Legal name], legal ID [number] · Pilot fees valid on [date] · Code VENDE-1                                                                                    |

₡4,633 = ₡2,400 commission + ₡1,400 warehouse + ₡300 collection + ₡533 IVA (`pricing-and-fees.md`, worked example). The collection fee is the schedule's 1.5%, the low end of the range the leave-behind prints (seller pitch §6.3). The offer's end date is a calendar date, because "6 months from the launch" cannot be checked while the launch date is an estimate (pricing proposal, decision 4).

## Call to action and how the result is measured

| Item      | Specification                                                                                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| QR code   | Opens WhatsApp to the business number with the text "Hola, vengo del volante VENDE-1. Quiero saber más." The shop writing first is the consent for the reply ([seller outreach](../messages/seller-outreach.md#consent-rules)) |
| Measure   | Messages with VENDE-1 per 100 flyers left; registrations in the console (**Vendedores**, status `pending`) in the same weeks                                                                                                   |
| Done when | The visit log (seller pitch §8) shows each flyer left, and the Saturday count is written                                                                                                                                       |

## Assumptions to verify

| Assumption                                 | How to verify                                       |
| ------------------------------------------ | --------------------------------------------------- |
| A shop that was not visited will scan a QR | Count VENDE-1 messages from shops with no visit row |
| 200 g/m² media carta stands on a counter   | A printed proof                                     |

## Sources

- Repository: `docs/01-product/pricing-and-fees.md`; `packages/core/src/fees.ts`; `supabase/migrations/20261121082300_people_payouts.sql`; `STATUS.md` (seller centre fee preview); `docs/brand/brand-book.md` §14; `docs/01-product/roadmap.md` (five sellers).
- Paper sizes: see [shopper flyer, Sources](shoppers-first-zones.md#sources).
