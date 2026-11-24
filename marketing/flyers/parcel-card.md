# Card in every parcel

**What it is.** A small card the warehouse puts in every parcel: how returns, the warranty, the delivery code and complaints work, and an invitation to come back.
**Conclusion 1.** It is the only shopper piece allowed in the closed pilot, because it reaches only people who already bought (go-to-market §5 and §7.1).
**Conclusion 2.** Every line repeats what the help page already says; it promises nothing new.
**Conclusion 3.** Code PAQUETE-1 on its QR counts replies; second orders are counted by order number in the console.
**The owner must decide** nothing here.

**Gates:** G1, G2, G4, G6, G9, G12. G6 matters most: the card prints the complaint times, and today the help page says "2 días hábiles" and the complaint form is not wired.

---

## Format

| Item                | Specification                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Size                | Half a media carta, 10.8 × 14.0 cm, portrait. Front Spanish, back English (assumption: confirm the cut with the print shop) |
| Bleed and safe area | 3 mm bleed; text and QR 5 mm inside the trim (assumption)                                                                   |
| Paper               | 200 g/m² matte, so it survives the parcel (assumption)                                                                      |
| Quantity            | 300 for the pilot (100 orders to standard, with room for reprints after the first edits)                                    |
| Type size           | Body at least 9 pt; the code warning at least 10 pt                                                                         |
| Picture             | None. The logo lockup at the top (brand book §6)                                                                            |

## Copy

| Zone          | Español (usted)                                                                                                                                                                                                                                                                                    | English                                                                                                                                                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title         | Gracias por comprar en Yuntera.                                                                                                                                                                                                                                                                    | Thank you for buying on Yuntera.                                                                                                                                                                                                                                |
| Returns       | **Si no le sirve, lo devuelve.** Tiene 8 días hábiles desde que recibe, sin dar explicaciones, salvo perecederos, artículos de uso personal abiertos y hechos a la medida. Pídalo en la página de su pedido. El reembolso llega en un máximo de 8 días naturales, por el mismo medio con que pagó. | **If it's not right, return it.** You have 8 business days from delivery, no reason needed, except perishables, opened personal items and made-to-measure goods. Ask on your order page. The refund arrives within 8 calendar days, by the same means you paid. |
| Warranty      | Todo producto tiene al menos 30 días hábiles de garantía por ley. Si el vendedor ofrece más, lo dice en el producto.                                                                                                                                                                               | Every product has at least 30 business days of legal warranty. If the seller offers more, the product page says so.                                                                                                                                             |
| Delivery code | **Su código de entrega es solo suyo.** Nadie de Yuntera se lo pide por teléfono ni por mensaje.                                                                                                                                                                                                    | **Your delivery code is yours alone.** Nobody from Yuntera asks for it by phone or message.                                                                                                                                                                     |
| Complaints    | ¿Algo salió mal? Escríbanos al [número] o presente su reclamo en [www.yuntera.cr/ayuda]. Le confirmamos que lo recibimos en 1 día hábil y le respondemos en un máximo de 5 días hábiles.                                                                                                           | Something went wrong? Write to us at [number] or file a complaint at [www.yuntera.cr/ayuda]. We confirm we received it within 1 working day and answer within 5 working days.                                                                                   |
| Come back     | Cuando ocupe algo más, estamos en [www.yuntera.cr].                                                                                                                                                                                                                                                | When you need something else, we are at [www.yuntera.cr].                                                                                                                                                                                                       |
| Footer        | [Nombre legal], cédula jurídica [número], [dirección] · Información vigente al [fecha] · Código PAQUETE-1                                                                                                                                                                                          | [Legal name], legal ID [number], [address] · Information valid on [date] · Code PAQUETE-1                                                                                                                                                                       |

Sources for each line: returns, exceptions, refund and warranty (help page `apps/web/src/app/ayuda/page.tsx`; compliance §1); the code warning (help page; brand book §4); complaint times (`docs/06-operations/customer-service.md`: 1 working day to acknowledge, 5 to answer), which the help page must match first (G6). For a cash order, how the refund is paid is **for the lawyer to confirm** (compliance §9 q2).

The "come back" line carries no offer and no price. Whether a printed card inviting a past buyer to return needs prior consent is **for the lawyer to confirm** (Ley 8642 art. 44 names calls, fax, e-mail "o cualquier otro dispositivo"; a card is none of these, but the lawyer reads it under G12). If the lawyer objects, drop the line; the rest of the card is service information.

## How the result is measured

| Item      | Specification                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| QR code   | Opens WhatsApp to the business number with the text "Hola, vengo de la tarjeta PAQUETE-1."                                                  |
| Measure   | Messages with PAQUETE-1 a week; second orders within 60 days, counted by order-number pairs in the console (never by name, e-mail or phone) |
| Who       | The warehouse puts one card in every parcel at packing                                                                                      |
| Done when | Every pilot parcel carries a card, and the Saturday count is written                                                                        |

## Assumptions to verify

| Assumption                                           | How to verify                                 |
| ---------------------------------------------------- | --------------------------------------------- |
| A card at ₡20–₡60 each (go-to-market §5)             | 2 print quotes                                |
| Shoppers read a card in the parcel                   | Count PAQUETE-1 messages against parcels sent |
| The help page and the complaint form match this card | Check G6 the day the card goes to print       |

## Sources

- Repository: `apps/web/src/app/ayuda/page.tsx`; `docs/06-operations/customer-service.md`; `docs/05-security-compliance/compliance-costa-rica.md` §1 and §9; `docs/brand/brand-book.md` §4, §6; `STATUS.md`.
- Go-to-market strategy draft (24 November 2026), §5 ("A printed card in every parcel") and §7.1; roll-out plan draft §4.
- Market research of 24 November 2026, §7.4 (Ley 8642 art. 44).
