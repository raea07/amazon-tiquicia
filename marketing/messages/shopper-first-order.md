# Messages around a shopper's first order

**What it is.** The texts a person at Yuntera sends by hand around a shopper's first order (an invitation to the pilot, answers before the order, a late-delivery call, a check-in after delivery), plus the one marketing e-mail allowed later. With the consent rules for each.
**Conclusion 1.** The product already sends the order's own messages (received, out for delivery, delivery failed); nothing here repeats or replaces them, and nothing here ever contains a delivery code.
**Conclusion 2.** Service messages (answers, a late delivery, a check-in) need no marketing consent; anything that invites a new purchase does, and starts with "Publicidad".
**Conclusion 3.** "¿Cómo nos conoció?" is asked once, after the first delivery, to count which channel works until the product records it.
**The owner must decide** whether the check-in asks for a review: D34 in the [owner decisions](../../docs/00-strategy/owner-decisions.md) list.

**Gates:** G4 and G9 before any message about a real order. G10 before messages 6 and 7 (the invitations to buy again). G12 for the refund and return lines.

---

## What the product already sends

Not written here; listed so nobody duplicates them. Sources: `packages/notifications/whatsapp/*.json` and `docs/06-operations/notifications.md`. None reaches a real person until the messaging provider is set up (`STATUS.md`, "What needs you" 7).

| Message                                                           | Channel                                | When                     |
| ----------------------------------------------------------------- | -------------------------------------- | ------------------------ |
| Pedido recibido (`order_placed`)                                  | E-mail always; WhatsApp if switched on | Order placed             |
| Su pedido va en camino (`shipment_out_for_delivery`)              | Same                                   | Parcel leaves on a route |
| No pudimos entregar su pedido (`shipment_delivery_failed`)        | Same                                   | A failed attempt         |
| Return approved, goods received, refund, code locked and released | E-mail and the shopper's channels      | Each event               |

## Consent rules for shoppers

| Kind of message                                           | Consent needed                                                                                                                                                          | Source                                                                        |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| An answer to a shopper who wrote                          | None beyond their message                                                                                                                                               | Ley 8642 art. 44 covers direct sales, not answers (for the lawyer to confirm) |
| About an order: a delay, a check-in, "¿cómo nos conoció?" | None; it concerns their order. No offer inside                                                                                                                          | Customer-service targets; the same reading                                    |
| An invitation to buy (again)                              | Prior consent for that channel, recorded in the product. The commercial box covers e-mail only ("por correo"); a WhatsApp consent needs its own box and log first (G10) | Art. 44; `privacy.md`, "Comunicaciones comerciales"                           |
| Marketing e-mail after a purchase                         | Allowed for **similar** products with a free opt-out, under art. 44's exception; the product's rule is stricter and requires the unticked box                           | Art. 44; `notifications.md`                                                   |

Always: name the sender, give a way to stop, never ask for or write the delivery code, an address, a card number or an ID number (CLAUDE.md privacy rules; help page).

---

## WhatsApp, sent by hand

### 1. Pilot invitation, to someone who already said yes in person

Only to friends, family and sellers' customers who agreed to test the pilot (roadmap phase 1). Record the yes and its date.

| Español (usted)                                                                                                                                                                                                                                                                                                                                                                                                                         | English                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hola, [nombre]. Soy [nombre], de Yuntera. Como hablamos, aquí está el enlace para el piloto: [enlace]. Entregamos en [cantones]; si pide de lunes a sábado antes de las 2 de la tarde, por lo general le llega el siguiente día de entrega, y la fecha exacta la ve antes de pagar. Paga con SINPE Móvil o en efectivo al recibir. Es una compra real: si algo no funciona, cuénteme aquí. Si prefiere que no le escriba más, dígamelo. | Hello, [name]. I'm [name], from Yuntera. As we discussed, here is the link for the pilot: [link]. We deliver in [cantons]; if you order Monday to Saturday before 2 p.m., it usually arrives the next delivery day, and you see the exact date before you pay. You pay by SINPE Móvil or cash on delivery. It is a real purchase: if anything doesn't work, tell me here. If you'd rather I don't write again, just say so. |

### 2. Answers before the first order (to a shopper who wrote)

| Question                    | Español (usted)                                                                                                                                                                                                                                  | English                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ¿Entregan en mi zona?       | Entregamos en [cantones]. Al escribir su distrito en la tienda le decimos si llegamos ahí. Si todavía no llegamos, se lo dice antes de pagar.                                                                                                    | We deliver in [cantons]. When you enter your district in the shop, it tells you if we go there. If we don't yet, it says so before you pay.                                                                   |
| ¿Cuánto cuesta el envío?    | ₡1 500 en [cantones]; gratis en pedidos desde ₡25 000. Lo ve en el producto, antes de pagar.                                                                                                                                                     | ₡1 500 in [cantons]; free on orders from ₡25 000. You see it on the product, before you pay.                                                                                                                  |
| ¿Cuándo me llega?           | Si pide de lunes a sábado antes de las 2 de la tarde, por lo general el siguiente día de entrega. La fecha exacta sale en el producto y antes de confirmar.                                                                                      | If you order Monday to Saturday before 2 p.m., usually the next delivery day. The exact date shows on the product and before you confirm.                                                                     |
| ¿Cómo pago con SINPE Móvil? | Al confirmar el pedido, la página del pedido le muestra los pasos para pagar. Pague solo desde esa página; nunca le pediremos una transferencia por mensaje a otro número.                                                                       | When you confirm the order, the order page shows you how to pay. Pay only from that page; we will never ask you by message for a transfer to another number.                                                  |
| ¿Y si no me gusta?          | Tiene 8 días hábiles desde que recibe para devolverlo, sin dar explicaciones, salvo perecederos, artículos de uso personal abiertos y hechos a la medida. Lo pide en la página del pedido y el reembolso llega en un máximo de 8 días naturales. | You have 8 business days from delivery to return it, no reason needed, except perishables, opened personal items and made-to-measure goods. Ask on the order page; the refund arrives within 8 calendar days. |

"Pague solo desde esa página" matches the payment design: the order page's pay step, the gateway's word, never a receipt photo (`STATUS.md`, Payments). The SINPE Móvil steps themselves are on the order page; do not copy them into messages, because they depend on the gateway's set-up.

### 3. A late delivery, sent before the promised date passes

The customer-service target: Yuntera contacts the shopper first, the same day, and agrees a new date or a refund (`customer-service.md`).

| Español (usted)                                                                                                                                                                                                                                    | English                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hola, [nombre]. Soy [nombre], de Yuntera. Su pedido [número] no va a llegar hoy, como le prometimos. Fue culpa nuestra: [motivo en una frase]. Puede elegir: se lo llevamos el [fecha], o cancela y le devolvemos todo lo que pagó. ¿Qué prefiere? | Hello, [name]. I'm [name], from Yuntera. Your order [number] will not arrive today, as we promised. It was our fault: [reason in one sentence]. You can choose: we bring it on [date], or you cancel and we refund everything you paid. Which do you prefer? |

If the delay is not Yuntera's fault, drop "Fue culpa nuestra" and do not blame anyone (brand book §4, rule 2).

### 4. Check-in after the first delivery (the next working day)

| Español (usted)                                                                                                                                                                                         | English                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hola, [nombre]. Soy [nombre], de Yuntera. Ayer le entregamos su primer pedido. ¿Llegó todo bien? Si algo no está bien, dígame aquí y lo resolvemos. Una pregunta, si me permite: ¿cómo supo de Yuntera? | Hello, [name]. I'm [name], from Yuntera. We delivered your first order yesterday. Did everything arrive well? If anything is wrong, tell me here and we'll sort it out. One question, if I may: how did you hear about Yuntera? |

Write only the channel in the Saturday spreadsheet, never the person's name, words or contact. Ask it once per shopper.

### 5. When the shopper reports a problem

| Español (usted)                                                                                                                                                                                            | English                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lamento mucho que haya pasado eso, [nombre]. Para resolverlo: [cambio o reembolso]. El reembolso llega en un máximo de 8 días naturales, por el mismo medio con que pagó. Le aviso aquí cuando esté hecho. | I'm very sorry that happened, [name]. To put it right: [replacement or refund]. The refund arrives within 8 calendar days, by the same means you paid. I'll let you know here when it's done. |

For an order paid in cash, the refund route (SINPE Móvil with the shopper's written agreement) is for the lawyer to confirm (compliance §9, question 2); until then say "le explico cómo le devolvemos el dinero" and follow `customer-service.md`.

### 6. Invitation to order again (marketing: held until G10)

Not used until the product records a WhatsApp commercial consent (G10). A yes kept by hand outside the product cannot meet `privacy.md`: consent is saved only by `set_my_commercial_consent` with its wording version, can be withdrawn from any message and from the account, and is deleted with the account. Then only to a shopper whose recorded consent covers WhatsApp. Not to everyone who bought.

| Español (usted)                                                                                                                                                                                                                                                                                  | English                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publicidad. Hola, [nombre]. Soy [nombre], de Yuntera. Esta semana [tienda] publicó [producto] en Yuntera: [enlace]. Si pide de lunes a sábado antes de las 2 de la tarde, por lo general le llega el siguiente día de entrega en [cantones]. Si no quiere recibir estos mensajes, responda BAJA. | Advertising. Hello, [name]. I'm [name], from Yuntera. This week [shop] listed [product] on Yuntera: [link]. If you order Monday to Saturday before 2 p.m., it usually arrives the next delivery day in [cantons]. If you don't want these messages, reply BAJA. |

BAJA, ALTO and NO MAS are the opt-out words planned for the product (`STATUS.md`, "What needs you" 7.1). Once G10 is met, the product's suppression list holds them.

---

## E-mail

### 7. Marketing e-mail after the first order (only after G10)

Sent from the product, never by hand, because only the product records consent, adds "Publicidad" and the one-step unsubscribe link (`notifications.md`, `templates/commercial.ts`). Only to shoppers who ticked "Acepto recibir ofertas y novedades de Yuntera por correo". The words, for the template:

|         | Español (usted)                                                                                                                                                                                                                                                                                            | English                                                                                                                                                                                                                                                           |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subject | Publicidad: lo nuevo en Yuntera esta semana                                                                                                                                                                                                                                                                | Advertising: what's new on Yuntera this week                                                                                                                                                                                                                      |
| Body    | Hola, [nombre]: Estas tiendas publicaron productos nuevos esta semana: [lista de 3 tiendas y productos, con enlace]. Recuerde: si pide de lunes a sábado antes de las 2 de la tarde, por lo general le llega el siguiente día de entrega en [cantones]. El envío es gratis desde ₡25 000 en esos cantones. | Hello, [name]: These shops listed new products this week: [list of 3 shops and products, with links]. Remember: order Monday to Saturday before 2 p.m. and it usually arrives the next delivery day in [cantons]. Delivery is free from ₡25 000 in those cantons. |
| Footer  | Recibe este correo porque aceptó recibir ofertas de Yuntera el [fecha]. Darse de baja: [enlace de un solo paso]. [Nombre legal], cédula jurídica [número], [dirección].                                                                                                                                    | You receive this e-mail because you agreed to Yuntera offers on [date]. Unsubscribe: [one-step link]. [Legal name], legal ID [number], [address].                                                                                                                 |

Any offer inside it follows art. 55 (dates, quantity, restrictions, former price).

---

## How the result is measured

| Measure                                        | Where                                                                                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| "¿Cómo nos conoció?" answers by channel        | Saturday spreadsheet                                                                                                                               |
| Second orders within 60 days by pilot shoppers | By hand until the product has a report (go-to-market §6, number 6), counted by order-number pairs from the console, never by name, e-mail or phone |
| Problems reported in the check-in              | Written as a case once the console's support desk exists (owner decision D1; being built); until then, the spreadsheet                             |
| Opt-outs                                       | Log; the product's suppression list once G10 is met                                                                                                |

## Decision for the owner

Whether the check-in (message 4) asks for a review is owner decision D34.
Until it is answered, the check-in asks only how the delivery went and how the
shopper heard of us.

## Assumptions to verify

| Assumption                                           | How to verify                                               |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| Shoppers answer a next-day check-in                  | Reply rate in the pilot                                     |
| Message 3 reaches the shopper before the date passes | Compare the time sent with the promised date in the console |
| The WhatsApp Business app is enough for one person   | The support research: until two people answer at once       |

## Sources

- Repository: `packages/notifications/whatsapp/order_placed.json`, `shipment_out_for_delivery.json`, `shipment_delivery_failed.json`; `docs/06-operations/notifications.md`, `customer-service.md`; `docs/05-security-compliance/privacy.md`, `compliance-costa-rica.md` §9; `apps/web/src/app/ayuda/page.tsx`; `docs/brand/brand-book.md` §4; `docs/01-product/roadmap.md`; `STATUS.md`.
- Ley 8642 art. 44 and Decreto 37899-MEIC art. 55, read 24 November 2026 by the market research (§7.4).
- [Support research](../../docs/research/support-and-system-health-tools.md) of 24 November 2026, §2.1; owner decision D49 (WhatsApp Business app until two people answer).
