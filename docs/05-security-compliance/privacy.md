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

### What a driver's phone holds, and for how long

The drivers' app (Yuntera Ruta) keeps two things on the phone so a route
still works without signal
([decision 26](../02-architecture/decisions.md#26-a-drivers-offline-day-in-ordinary-app-storage-kept-small-and-short)).
Both are in the app's ordinary storage, which the phone encrypts with its own
keys and keeps to the app; the app adds no encryption of its own.

| What                                                                                                                                                            | Removed                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The day's routes still to drive: for each stop the recipient's name, _señas_, map pin, Plus Code, parcels and cash, and the phone number while the stop is open | At sign-out, when the driver loses access or is suspended, when another account opens the app, and 24 hours after it was saved, even if nobody opens the app. Finished routes are never saved                                       |
| Actions taken without signal: arrivals, failed deliveries (with the reason and the position at the door) and the driver's latest position                       | As soon as they are sent. Positions at sign-out or after 5 minutes; everything of an account when it loses access or another account signs in; an unsent arrival or failure after 36 hours, when the driver is told it was not sent |

The delivery code is never written to the phone. Nothing of this goes into
logs. The drivers' app is kept out of Android's cloud backup, and this storage
is kept out of iPhone backups. Moving to a new Android phone with Google's
device-to-device transfer can still copy it; the copy is at most a day old and
is removed when the app next starts. Not yet checked on a phone.

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
| A route kept on the driver's phone for a dead zone               | 24 hours, less at sign-out or lost access | Readable without signal; see [What a driver's phone holds](#what-a-drivers-phone-holds-and-for-how-long). Removed by the app itself, so this one is enforced, not proposed               |
| Support conversations                                            | 2 years                                   | Dispute evidence, service quality                                                                                                                                                        |
| Audit log                                                        | 5 years                                   | Accountability; matches financial records                                                                                                                                                |
| Risk signals and decisions                                       | 1 year                                    | Fraud patterns; reviewability of decisions. Risk scoring is not wired in yet, so nothing is stored                                                                                       |
| Abandoned, unverified accounts                                   | 12 months of inactivity, then deleted     | No purpose                                                                                                                                                                               |
| Marketing consent                                                | Until withdrawn                           |                                                                                                                                                                                          |
| Seller identity documents                                        | Duration of the relationship plus 5 years | Platform reporting duty to Hacienda                                                                                                                                                      |

Deleting an account is self-service and immediate; what it erases and keeps
is described in [Deleting an account](#deleting-an-account) below.

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
| Deletion                        | Self-service in every app (_Su cuenta → Eliminar mi cuenta_), immediate; see [Deleting an account](#deleting-an-account)   |
| Withdrawal of marketing consent | Immediate, from any message and from the account                                                                           |
| Record                          | Every request and its outcome is logged                                                                                    |

Deletion and withdrawal of marketing consent are self-service. Access and
rectification beyond the profile and addresses are handled by hand from the
privacy email, as is deletion for someone who can no longer sign in. A named
person is responsible; in the Pilot that is the founder.

## Deleting an account

What the system does today (`public.delete_my_account`, in
`supabase/migrations/20261121082500_account_security.sql`, extended by
`20261121082600_notifications.sql` for what notifications hold and by
`20261121082700_product_photos.sql` for a closed shop's photos; tested table by table
in `supabase/tests/095_account_security.sql` and in the browser journey
`tools/e2e/journeys/account-deletion.cjs`).

**How a person asks.** In any app, _Su cuenta → Eliminar mi cuenta_ explains
what is erased and what is kept, asks for the password again and an explicit,
unticked-by-default confirmation, and then deletes at once. The shop's public
page `/ayuda/eliminar-cuenta` explains the same without signing in; it is the
address both app stores require. Someone who cannot sign in writes to the
privacy contact.

**When it waits.** Deletion is refused, with the reason and what to do, while
the account has an order in progress, an open return, a refund still owed for a
paid order that was cancelled (the refund goes back through the gateway, to the
card or phone that paid, so the details are still needed), an open complaint,
is the only person in charge of a shop that is open or awaiting approval
(Yuntera closes the shop first), belongs to a shop with stock, undelivered
orders or money pending in either direction, or holds a staff, driver or
warehouse role (an administrator removes those first). An account with a second
factor can be deleted only from a session that has passed it.

**What is erased**, in one transaction:

| Where                                   | What happens                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile                                 | Name and phone erased, phone verification and marketing choice cleared                                                                                                                                                                                                                                                                                                                                    |
| Addresses                               | Deleted                                                                                                                                                                                                                                                                                                                                                                                                   |
| Consents                                | Deleted                                                                                                                                                                                                                                                                                                                                                                                                   |
| Notification settings                   | Channel choices and the WhatsApp/SMS number deleted; the commercial-consent history deleted; push tokens deleted                                                                                                                                                                                                                                                                                          |
| Messages                                | Anything not yet sent to the person is skipped and never sent; the frozen text of messages to the person or about their orders (which holds the address and name) erased. The delivery rows (template, channel, status, times) stay, as order history does                                                                                                                                                |
| Suppressions                            | Entries for the person's e-mail and phone numbers deleted, unless another account or shop still uses that address                                                                                                                                                                                                                                                                                         |
| Past orders and their route stops       | Recipient name, phone, _señas_ and Plus Code erased; the map pin rounded to about 1 km                                                                                                                                                                                                                                                                                                                    |
| Returns and complaints (closed)         | The person's own text erased                                                                                                                                                                                                                                                                                                                                                                              |
| Content reports they filed              | The e-mail given erased                                                                                                                                                                                                                                                                                                                                                                                   |
| Reviews                                 | Stay published, shown as «Cliente»: the name they came from is gone                                                                                                                                                                                                                                                                                                                                       |
| Shop memberships, inactive staff row    | Deleted; a former driver's record keeps no name, phone, ID number or plate                                                                                                                                                                                                                                                                                                                                |
| A shop left with nobody in charge       | Closed. Never traded: its private details (legal name, cédula, contact, bank) deleted. Traded: contact, address and bank details erased; legal name and identification number kept with its invoices. Either way its requests to change the payout account are deleted, and its photos leave the review queue and the shop (unless another shop still sells that listing), with their descriptions erased |
| Second factors, sessions, sign-in links | Deleted: every session ends, and every access token issued for them stops working at once                                                                                                                                                                                                                                                                                                                 |
| Sign-in record (`auth.users`)           | E-mail replaced by `<id>@cuenta-eliminada.invalid`, password and metadata erased, sign-in banned for 100 years                                                                                                                                                                                                                                                                                            |
| Auth's own sign-in log, where kept      | Entries for the account deleted                                                                                                                                                                                                                                                                                                                                                                           |

**What is kept, and why.** Orders, their lines, payments, shipments,
electronic invoices and ledger entries, for the legal retention period (five
years for electronic-invoicing records): Yuntera and the sellers must be able
to show every sale to Hacienda. They keep pointing at the account's id, which
no longer leads to a name, e-mail, phone or address. A register
(`private.account_deletions`) records that a deletion happened, on which day
and how many orders were kept, with no id. The record of who did what at work
(order events, stock movements, audit trail) keeps the bare id.

**The audit trail holds no personal columns.** It is immutable, so it never
receives them: for drivers it leaves out name, phone, ID number, plate and
licence dates; for a shop's private details, the legal name, identification
number, contact details, fiscal address and bank account. It keeps that a
change happened, who made it, and the names of the columns that changed
(`changed_private`). Rows written before this rule were stripped of those
columns once, by the migration that introduced it.

**Photo files.** Files are not rows: no database function can delete them.
A closed shop's photos become disposable, and the console deletes them
through the storage API at the next catalogue decision. There is no scheduled
clean-up yet, so until then the files stay in the private bucket, readable
only by catalogue staff, or (for photos that were public) at their public
address. The public copy of a photo shown on a past order is kept while the
order is.

**The e-mail address is free again.** A new sign-up with the same address is a
new, unrelated account.

**Why the sign-in record is anonymised rather than deleted.** Orders, returns,
complaints and ledger transactions refer to `auth.users` without a cascade, as
records the law requires must: deleting the row would fail for anyone who ever
bought something, and pointing all of them at one shared "deleted account"
would merge strangers' records. Supabase Auth's own "soft delete" works the
same way (it obfuscates the e-mail and phone and keeps the row). Deleting
through Auth's admin API would also need a secret key, which no app holds.

**Verified on the hosted preview on 21 November 2026** (details in the
[runbook](../07-deployment/runbook-first-deploy.md#migrations-20261121082500-to-20261121082700)):
points 1–3 below held, with three real deletions of throwaway accounts (one
through the API, two from the shop's "Eliminar mi cuenta"), and a search of
every row of every table in `public`, `private`, `auth` and `storage` found
nothing personal of them afterwards. Point 4 was half done: Auth loaded the
deleted row without error when its old token was presented, but its user
listing and admin API need the secret key, which nothing uses, so the
dashboard's user list is still to be opened once. Not covered by the deletion:
`auth.flow_state` keeps the id (nothing personal) of an unfinished PKCE sign-in
or reset.

1. The function's owner may write the Auth tables:
   `select has_table_privilege(p.proowner, 'auth.users', 'UPDATE') from pg_proc p where p.proname = 'delete_my_account'`,
   and the same for `DELETE` on `auth.sessions`, `auth.identities`,
   `auth.mfa_factors`, `auth.one_time_tokens` and `auth.audit_log_entries`.
   Running `supabase/tests/095_account_security.sql` there
   (`remote-db.sh test`) exercises exactly these writes and rolls back.
2. After a real deletion, Auth refuses the old password (`invalid_credentials`)
   and the old refresh token, and a sign-up with the same address creates a new
   account.
3. **Access tokens issued before the deletion.** Auth's access tokens are
   valid by themselves for up to an hour. The Data API runs
   `public.check_request` before every request (`pgrst.db_pre_request`, set by
   the migration on the `authenticator` role for the project's database), and
   it refuses a token whose account is deleted or whose session no longer
   exists. It also locks the account's sign-in row for the length of a writing
   request, so a request and a deletion of the same account never overlap.
   Verify on the hosted project: `select setconfig from pg_db_role_setting s
   join pg_roles r on r.oid = s.setrole where r.rolname = 'authenticator'`
   shows the setting, and a token kept from before a test deletion gets
   `session_ended` from `/rest/v1/rpc/my_orders`. If the migration's
   `alter role authenticator in database …` was refused there, run Supabase's
   documented form, `alter role authenticator set pgrst.db_pre_request =
   'public.check_request'; notify pgrst, 'reload config';`, as `postgres`.
4. **The ban Auth can read.** The sign-in row is banned until now + 100 years
   (Auth's own bans are finite; it reads the column into a Go time value). After
   a test deletion, open the dashboard's user list and fetch that user with the
   admin API to see that both still load.

## Messages and photos: what they hold and for how long

- **Planned and sent messages** (`private.notification_deliveries`) hold the
  template, channel, status, times and ids, never the address: the address
  is looked up when the message is claimed. The exact text sent is kept only
  while a retry may need it and cleared at the first final state. These rows
  are kept without an end date today; a retention clean-up is not built.
- **Preferences, consent and push tokens** live as long as the account.
- **Suppressions** (addresses that bounced, complained or sent STOP) are kept
  so they are not written to again; they go with an account deletion when no
  one else uses the address.
- **Photo files** waiting for review are readable only by the shop's members
  (by download, never by a shareable link) and catalogue staff. Approved
  photos are public. Publishing re-encodes every photo on the console's
  server, which drops location and camera data.

## Second factor for staff

Staff enrol an authenticator app (time-based codes) from the console's
account page; the QR code is drawn on Yuntera's own server and the key is also
shown as text. Once enrolled, sign-in asks for a code after the password, in
every web app and in the seller, driver and warehouse apps; the shopper app
sends such an account to the website. The code is never stored on the phone. When the setting `require_staff_mfa` is on, a member of staff with
no factor is taken to enrolment before anything else, and the database refuses
staff functions to any session that has not passed the second step. Whatever
the setting, an account that has a factor counts in the database only once its
session has passed it (`private.factor_ok`, in the staff and seller helpers and
the deletion functions, and `public.check_request` before every Data API
request): a password alone, used against the API directly, opens nothing but
the second step. Removing
or replacing a factor needs a fresh code. An administrator who lost the phone
is recovered by another administrator from _Seguridad_
(`public.ops_reset_staff_factor`: never on oneself, recorded in the audit
trail); the colleague's sessions end, and their access tokens stop working,
at once. Five wrong codes in fifteen minutes pause the second step for that
account (`private.mfa_failures`): the apps reserve each attempt before the code
goes to Auth, under a per-account lock, so parallel requests are counted too.
Auth's own per-account hook needs the Team plan and is written, not enabled;
when it is, it turns the apps' reservation into the failure instead of counting
twice. Codes sent to Auth directly, bypassing the apps, meet only Auth's per-IP
limit until the hook is enabled. Sellers may turn the same protection on for
their account.

An administrator cannot reset their own factor. Keep at least two
administrators with a factor before turning `require_staff_mfa` on (the
_Seguridad_ screen warns while there are fewer); the break-glass procedure for
the last administrator is in `security-program.md`.

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

> ☐ Acepto recibir ofertas y novedades de Yuntera por correo

Wording version `comercial-2026-11`, on the shop's and the seller centre's
_Notificaciones_ page (with the explanation above it: optional, not needed to
buy or sell, withdrawn there or with the link in every message, and every such
message says it is advertising) and in the shopper app's account screen. Saved
only by `set_my_commercial_consent` (or with the channel choices), with the
wording version and where it was given; `update_profile` no longer changes it.
No commercial message can be sent yet: there is no commercial template and no
one-step unsubscribe page.

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
