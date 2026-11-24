# Flyer and stand poster: makers and producers at a fair

**What it is.** A flyer handed to exhibitors and a poster for a table or stand at a small-business fair, for makers who have never sold online: crafts, packaged coffee and food, small local brands.
**Conclusion 1.** It leads with what a maker fears (building a shop, delivering, not being paid) and answers each with a built fact.
**Conclusion 2.** It is honest about the two entry conditions in the pilot: a barcode on each unit for the warehouse, and the maker's own electronic invoice or the simplified regime.
**Conclusion 3.** Code FERIA-[month] on the QR and a sign-up sheet with an unticked consent box measure each fair separately.
**The owner must decide** the question at the end (which fair first).

**Gates:** G1, G2, G8, G9. Hand it out only as a visitor or with the fair's permission; a stand needs the organiser's terms (MEIC's EXPOPYME exhibitor fee was not found; market research §7.3).

---

## Format

| Piece | Specification |
| --- | --- |
| Flyer | Media carta, 21.6 × 14.0 cm, portrait, Spanish front, English back; 3 mm bleed, 5 mm safe area (assumption: confirm with the print shop); 150 g/m² |
| Stand poster | Tabloide, 27.9 × 43.2 cm (11 × 17 in), portrait, Spanish only, with a small English line at the foot; 3 mm bleed; readable from 2 m: headline at least 60 pt, body at least 24 pt (assumption; check on a printed proof) |
| Sign-up sheet | Carta, plain paper, on a clipboard (below) |
| Quantity | 150 flyers per fair; 1 poster |

## What the picture shows

A maker's hands at work on their product (a coffee bag being sealed, a wooden piece being sanded, a jar being labelled), then the same product on a shelf in a bin with a label. Real photograph with the maker's written permission, or a drawing. No folk-costume imagery, no flags (brand book §3, §14).

## Flyer copy

| Zone | Español (usted) | English |
| --- | --- | --- |
| Headline | ¿Nunca ha vendido en línea? Usted hace el producto. Nosotros hacemos el resto. | Never sold online? You make the product. We do the rest. |
| Q1 | **"No sé hacer una tienda en línea."** Le ayudamos a publicar sus productos en Yuntera Vende. Su tienda tiene su propia página, con su descripción y su logotipo. | **"I don't know how to build an online shop."** We help you list your products in Yuntera Vende. Your shop gets its own page, with your description and logo. |
| Q2 | **"No tengo quién entregue."** Guardamos su producto en nuestra bodega, lo empacamos y nuestro repartidor lo entrega en [cantones], de lunes a sábado. | **"I have nobody to deliver."** We store your product in our warehouse, pack it, and our driver delivers it in [cantons], Monday to Saturday. |
| Q3 | **"Me da miedo que no me paguen."** Cobramos nosotros, por SINPE Móvil o en efectivo al recibir, y le pagamos por transferencia 10 días después de la entrega. | **"I'm afraid I won't get paid."** We collect, by SINPE Móvil or cash on delivery, and pay you by transfer 10 days after delivery. |
| Fees | Sin mensualidad. En _Hecho en Costa Rica_ la comisión del piloto es del 10%, solo cuando vende, más el cargo de bodega desde ₡900 por unidad y el cargo de cobro (SINPE Móvil 1,5%), con IVA. Ejemplo: una bolsa de café de ₡8 000, tamaño sobre, pagada por SINPE Móvil: usted recibe ₡5 943,40. | No monthly fee. For _Made in Costa Rica_ the pilot commission is 10%, only when you sell, plus a warehouse fee from ₡900 a unit and a collection fee (SINPE Móvil 1.5%), plus IVA. Example: an ₡8,000 bag of coffee, envelope size, paid by SINPE Móvil: you receive ₡5,943.40. |
| Conditions | Para el piloto necesita: cédula física o jurídica, una cuenta IBAN, un código de barras en cada unidad, y emitir la factura electrónica de sus ventas (o estar en el Régimen Simplificado). Si le falta algo, se lo explicamos. | For the pilot you need: a personal or company ID, an IBAN account, a barcode on each unit, and to issue the electronic invoice for your sales (or be in the simplified regime). If something is missing, we explain. |
| Pilot line | Todavía no hemos hecho una venta real. Buscamos las primeras tiendas para un piloto cerrado. | We have not made a real sale yet. We are looking for the first shops for a closed pilot. |
| Call to action | Escanee el código o déjenos su contacto en la hoja de la mesa. | Scan the code or leave your contact on the sheet at the table. |
| Footer | [WhatsApp], lunes a sábado, [horas] · [Nombre legal], cédula jurídica [número] · Tarifas del piloto vigentes al [fecha] · Código FERIA-[mes] | [WhatsApp], Monday to Saturday, [hours] · [Legal name], legal ID [number] · Pilot fees valid on [date] · Code FERIA-[month] |

₡5,943.40: commission ₡800 + warehouse ₡900 + collection ₡120 = ₡1,820, IVA ₡236.60 (schedule `2026-11-assumptions`; arithmetic of `fees.ts`). "Le ayudamos a publicar" holds in the pilot because the founder onboards sellers by hand (roadmap phase 1). Barcode: label printing for unlabelled units is a Launch feature, not built (`scope-by-app.md`).

## Poster copy

| Español | English (foot line, small) |
| --- | --- |
| **Usted hace el producto. Nosotros lo guardamos, lo entregamos y cobramos.** · Sin mensualidad · Comisión solo cuando vende · Pague y cobre con SINPE Móvil · Pregúntenos aquí. | You make it. We store it, deliver it and collect. No monthly fee. Ask us here. |

## Sign-up sheet

Columns: business name · first name · WhatsApp or e-mail · what you make · a box. The box, unticked, beside the words:

| Español | English |
| --- | --- |
| ☐ Acepto que Yuntera me escriba por WhatsApp o correo sobre el piloto para vendedores. Puedo pedir que no me escriban más en cualquier momento. | ☐ I agree that Yuntera may write to me by WhatsApp or e-mail about the seller pilot. I can ask them to stop at any time. |

Only rows with the box ticked by the person get a message. The sheet is kept, then typed into the visit log and destroyed after 90 days (assumption; the privacy document sets no period for paper; for the lawyer to confirm). Whether this sheet satisfies Ley 8642 art. 44's prior consent is for the lawyer to confirm.

## How the result is measured

| Measure | Where |
| --- | --- |
| QR messages with FERIA-[month] | WhatsApp, counted after the fair |
| Ticked rows on the sign-up sheet | The sheet |
| Registrations in the console in the 14 days after the fair | **Vendedores**, status `pending` |
| Done when | All three written in the visit log the Monday after the fair |

## Decision for the owner

1. **Which fair first?**
   - A. The Feria Nacional de Economía Social y Solidaria, 4–6 December 2026, Parque Nacional, San José, as a visitor. **(recommended)** It is the next one found, in the GAM, with no stand to pay; the date comes from a search result only, so confirm it first.
   - B. The next regional EXPOPYME edition, asking MEIC for a stand.
   - C. Wait for Expo Pyme CR's next edition (the 2026 edition was 3–4 October, free entry).

## Assumptions to verify

| Assumption | How to verify |
| --- | --- |
| Fair dates and terms | The organiser's own page or a call |
| Makers at fairs often lack barcodes | Count it on the sign-up sheet ("what you make") |
| Tabloide is readable from 2 m | Printed proof |

## Sources

- Repository: `packages/core/src/fees.ts`; `supabase/migrations/20261121080450_catalog_reference.sql` (`hecho-en-cr` 10%); `docs/01-product/scope-by-app.md`, `roadmap.md`; `docs/05-security-compliance/compliance-costa-rica.md` §3; `STATUS.md` (shop page with description and logo); `docs/brand/brand-book.md` §3, §14.
- Market research of 24 November 2026, §7.3: EXPOPYME (Delfino, April 2026, https://www.delfino.cr/2026/04/expopyme-oficial-2026-reunira-a-235-emprendimientos-en-la-antigua-aduana); Expo Pyme CR (Delfino, May 2026, https://delfino.cr/2026/05/expo-pyme-cr-anuncia-cuarta-edicion-con-feria-gratuita-en-parque-la-libertad); Feria Nacional de Economía Social y Solidaria (search result, low confidence); §7.4 (Ley 8642 art. 44).
- Paper sizes: see [shopper flyer, Sources](shoppers-first-zones.md#sources).
