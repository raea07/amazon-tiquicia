# Privacy

Yuntera holds the thing people guard most: where they live and how to reach
them. This document fixes who may see which personal data and why, the rules
that keep each role to the minimum, how long data is kept, how people exercise
their rights, and the consent texts the product needs. The texts are drafts for
a lawyer to review; the access rules are requirements the engineering
workstream implements and tests.

The legal basis is Ley 8968 and its reglamento; see the
[fact sheet, section 4](../research/costa-rica-fact-sheet.md#4-personal-data).

## Principles

1. **Need to know, for as long as needed.** A role sees a piece of personal
   data only if it cannot do its job without it, and only while the job lasts.
2. **Enforced in the data layer, not in the screens.** Hiding a field in an app
   is not a control.
3. **Snapshots over lookups.** A driver receives a copy of what the delivery
   needs, not access to the shopper's account.
4. **No sale or sharing of personal data** for anyone else's purposes. This
   also keeps Yuntera outside the PRODHAB registration duty as currently
   understood (lawyer to confirm).

## Data inventory by role

### What a shopper can see

| Data                                                                                                | Why                                                   |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Their own profile, addresses, orders, payments status, invoices, reviews                            | It is theirs                                          |
| The seller's public identity: trade name, legal name, identification number, performance indicators | The law requires that a buyer can identify the seller |
| The delivery PIN for their own shipment                                                             | To prove receipt                                      |
| The driver's first name while the order is out for delivery (assumption to validate)                | To know who is at the door                            |

A shopper never sees another shopper's data. A review shows a first name and
initial only.

### What a seller can see

| Data                                                                                       | Why                                                        |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Their own company data, bank details, team members, listings, stock, statements            | It is theirs                                               |
| For each of their order lines: order number, item, quantity, price, status, promised dates | To know what sold and plan stock                           |
| The shopper's **first name and district** (assumption to validate)                         | Enough context for service without identifying a household |
| The invoice data the shopper provided, when the seller must issue the electronic document  | Legally required to issue it; see below                    |

A seller does **not** see the shopper's phone, email, full address or map pin
while Yuntera delivers the order. They do not need them: Yuntera collects,
delivers and handles contact.

**The invoicing exception.** A _factura electrónica_ names the receiver, so a
seller issuing one needs the name and identification the shopper entered for
invoicing, and possibly an email for delivery of the document. A _tiquete
electrónico_ for a final consumer needs none of that. The default is therefore
a tiquete; the shopper opts into a factura and is told the seller will receive
their invoicing data. If Yuntera later issues documents on sellers' behalf,
this exception disappears.

### What a driver can see

| Data                                                                                                                         | Why                            | For how long                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| For each stop on a route assigned to them: recipient name, phone, _señas_, map pin, Plus Code, parcel count, cash to collect | To find the door and hand over | While the route is assigned or in progress, and for a short period after completion to resolve same-day issues (proposal: 24 hours) |

A driver does **not** see the order contents beyond parcel count and handling
notes, the price paid when no cash is due, the shopper's email or order
history, any stop not on their route, or the delivery PIN. The PIN is checked
by the system; a driver cannot look it up.

### What a warehouse associate can see

| Data                                                                       | Why                        |
| -------------------------------------------------------------------------- | -------------------------- |
| Stock, locations, inbound notices, pick and pack tasks for their warehouse | To do the work             |
| Order number and parcel label reference                                    | To match parcels to routes |

No shopper contact details. The label carries a reference and a zone, not a
phone number.

### What staff can see

| Role          | Data                                                           | Why                                               |
| ------------- | -------------------------------------------------------------- | ------------------------------------------------- |
| Support       | Orders, delivery details, shopper and seller contact, messages | To resolve problems                               |
| Operations    | The above plus routes, driver data, stock                      | To run the day                                    |
| Finance       | Payments, refunds, payouts, seller bank details, invoices      | To pay and reconcile                              |
| Catalogue     | Listings, reviews, reports                                     | To moderate                                       |
| Administrator | Everything, including roles                                    | To administer; held by the fewest people possible |

Every staff view of personal data is logged. Staff access requires
multi-factor authentication from Launch.

### What Yuntera holds about drivers and staff

Identity, licence and vehicle documents, insurance, bank details, and for
drivers the positions recorded during active routes. Location is collected
**only while a route is active**, never in the background outside it.

## Data minimisation rules

These are requirements. Each must have an automated test.

1. A driver can read delivery details only for stops on a route currently
   assigned to them.
2. A seller can read order lines only for their own products, and no shopper
   contact fields.
3. The delivery PIN is readable only by the shopper who owns the order.
4. Addresses are readable only by their owner and by staff with a support,
   operations or administrator role.
5. A shopper's order history is never exposed to sellers or drivers.
6. Payment card data is never stored or logged; only the gateway's reference.
7. Risk scoring does not use district, name, nationality or identification
   type (`packages/core/src/risk.ts`).
8. Logs and error reports contain identifiers, not names, phones or addresses.
9. Analytics use order and product identifiers; co-purchase recommendations
   are computed from anonymous baskets (`packages/core/src/recommendations.ts`).
10. Exports of personal data by staff are logged and limited to named roles.

## Retention

**Every period below is an assumption** — a proposal to be confirmed by the
lawyer and accountant — except the five-year retention of electronic invoicing
records, which comes from the research. No retention job is built: today
nothing is deleted automatically.

| Data                                                             | Proposed retention                        | Reason                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orders, payments, invoices, seller statements                    | 5 years                                   | Electronic invoicing records must be kept 5 years ([fact sheet, section 2](../research/costa-rica-fact-sheet.md#2-electronic-invoicing)); confirm whether other tax rules require longer |
| Delivery details on a completed route (as visible to the driver) | 24 hours                                  | Same-day issue resolution                                                                                                                                                                |
| Proof-of-delivery photos                                         | 90 days                                   | Covers the warranty and dispute window. Photo capture is not built yet                                                                                                                   |
| Driver position history                                          | Not kept                                  | Only each driver's latest position is stored, and it is overwritten; there is no history to retain (`driver_positions`)                                                                  |
| Support conversations                                            | 2 years                                   | Dispute evidence, service quality                                                                                                                                                        |
| Audit log                                                        | 5 years                                   | Accountability; matches financial records                                                                                                                                                |
| Risk signals and decisions                                       | 1 year                                    | Fraud patterns; reviewability of decisions. Risk scoring is not wired in yet, so nothing is stored                                                                                       |
| Abandoned, unverified accounts                                   | 12 months of inactivity, then deleted     | No purpose                                                                                                                                                                               |
| Marketing consent                                                | Until withdrawn                           |                                                                                                                                                                                          |
| Seller identity documents                                        | Duration of the relationship plus 5 years | Platform reporting duty to Hacienda                                                                                                                                                      |

Deleting an account removes or anonymises profile, addresses and reviews'
authorship. Records that the law requires Yuntera to keep stay, restricted to
finance and administrator roles, and the person is told which and why.

## Data-subject rights

Ley 8968 gives people rights of access, rectification, deletion and to withdraw
consent.

| Step                            | What happens                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Request                         | From the account (_Mis datos_) or by writing to the privacy contact. No fee                                                |
| Identity check                  | The person is signed in, or confirms through the email or phone on the account                                             |
| Response                        | Proposed target: 5 business days to acknowledge and 10 business days to complete; the lawyer to confirm the legal deadline |
| Access                          | A readable copy of profile, addresses, orders, reviews, consents                                                           |
| Rectification                   | Self-service for profile and addresses; by request for the rest                                                            |
| Deletion                        | As described under retention                                                                                               |
| Withdrawal of marketing consent | Immediate, from any message and from the account                                                                           |
| Record                          | Every request and its outcome is logged                                                                                    |

Until self-service exists (Launch), requests are handled by hand from the
privacy email. A named person is responsible; in the Pilot that is the founder.

## Processors and processing abroad

The platform runs on cloud services operated outside Costa Rica (database and
authentication, web hosting, error monitoring, edge network, mobile builds,
messaging). Ley 8968 requires express authorisation for transfers and has no
list of approved countries. The plan:

- Name the categories of provider and the countries in the privacy notice and
  obtain express consent at account creation.
- Choose the hosting region closest to Costa Rica where there is a choice.
- Keep a register of processors with what each one receives.
- Send error monitoring and analytics identifiers, not personal data.

Whether hosting with a processor is a "transfer" in the legal sense is a
question for the lawyer
([compliance](compliance-costa-rica.md#9-questions-for-the-lawyer)).

## Consent texts

**BORRADORES — para revisión legal. No publicar sin aprobación de un abogado.**

### Al crear la cuenta

> **Aviso de privacidad.** Yuntera (_nombre legal y cédula jurídica_) es
> responsable de sus datos personales. Los usamos para crear su cuenta,
> procesar y entregar sus pedidos, cobrar, emitir comprobantes, atender
> consultas y reclamos, prevenir fraudes y cumplir obligaciones legales.
>
> Compartimos solo lo necesario: con el repartidor, su nombre, teléfono y
> dirección de entrega mientras dure la ruta; con el vendedor, los datos del
> pedido y, si usted pide factura electrónica, sus datos de facturación; con
> los proveedores de pago y de tecnología que operan la plataforma, algunos de
> ellos ubicados fuera de Costa Rica (_lista de países_).
>
> Usted puede consultar, corregir o eliminar sus datos y retirar su
> consentimiento en _Mi cuenta → Mis datos_ o escribiendo a
> _[correo de privacidad: el buzón todavía no existe y debe crearse antes de
> publicar este aviso]_.
>
> ☐ He leído el aviso de privacidad y autorizo el tratamiento de mis datos,
> incluido su tratamiento por proveedores fuera de Costa Rica, para los fines
> indicados.

The box is unticked. The account cannot be created without it, and the text
says so.

### Comunicaciones comerciales (opcional, sin marcar)

> ☐ Quiero recibir ofertas y novedades de Yuntera por correo y WhatsApp. Puedo
> darme de baja en cualquier momento.

### Ubicación al registrar una dirección

> Usaremos su ubicación solo para colocar el pin de entrega en el mapa. Usted
> puede moverlo antes de guardar. No rastreamos su ubicación.

### Factura electrónica

> Si solicita factura electrónica, el vendedor recibirá el nombre, la
> identificación y el correo que usted indique, únicamente para emitirla.

### Repartidores: ubicación durante la ruta

> Mientras una ruta esté activa, Yuntera Ruta registra la ubicación de su
> teléfono para mostrar el avance de las entregas y resolver reclamos. Al
> terminar la ruta, el registro se detiene. Conservamos estos datos 30 días.
>
> ☐ Autorizo el registro de mi ubicación durante las rutas activas.

### Prueba de entrega con fotografía

> Si no es posible confirmar la entrega con el PIN, el repartidor tomará una
> fotografía del paquete en el lugar de entrega. No se fotografía a personas.
> La imagen se conserva 90 días.

### Vendedores: reporte a Hacienda

> Yuntera está obligada a verificar la identidad de quienes venden en la
> plataforma y a reportar a la Dirección General de Tributación su
> identificación y los montos de sus ventas. Al registrarse, usted acepta que
> esa información sea reportada.
