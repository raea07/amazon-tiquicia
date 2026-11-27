# Carreta rebuild: screen inventory

Taken on 24 November 2026 from the main line at commit `d6b637e` (the update
that was still being joined that day is not in it). Screenshots of the browser
and phone journeys were read beside the source (256 and 165 files).

**Measured** means counted by a script or a search over the source.
**Estimated** means judged by reading. Every count below is measured unless it
says "estimated". `SISTEMA.md` was revised after this inventory; where the two
differ, `SISTEMA.md` wins.

## 1. Totals

| App | Screen files | Other route files (no screen) | Layouts |
|---|---:|---:|---:|
| apps/web (shop website) | 25 (23 `page.tsx` + `not-found` + `error`) | 4 `route.ts` | 1 |
| apps/seller (seller centre) | 25 (23 + 2) | 3 `route.ts` | 1 |
| apps/ops (staff console) | 50 (48 + 2) | 3 `route.ts` | 1 |
| apps/field (driver and warehouse web app) | 19 (17 + 2) | 1 `route.ts` + `manifest.ts` | 3 |
| apps/shop-native | 19 | 0 | 2 |
| apps/seller-native | 21 | 0 | 3 |
| apps/driver-native | 7 | 0 | 2 |
| apps/warehouse-native | 11 | 0 | 2 |
| **All eight apps** | **177** | 11 | 15 |

Messages (not screens, but they carry the brand): 10 account e-mails in
`supabase/templates/*.html` plus their `_layout.html`; 37 event messages
(26 in `packages/notifications/src/templates/catalog.ts`, 10 in
`followups.ts`, 1 in `staff-catalogue.ts`) all drawn by one HTML frame,
`renderEmail` in `packages/notifications/src/templates/render.ts`, plus SMS
and WhatsApp text; 4 WhatsApp templates in `packages/notifications/whatsapp/*.json`;
one commercial e-mail frame in `templates/commercial.ts`. The fiscal
document (`packages/next-kit/src/fiscal-document.tsx`) is drawn on 3 screens.

Many screens hold several states in one file (empty, refused, offline,
done). Measured: `<EmptyState` 45 uses in 42 web files; in the phone apps
`<EmptyState` 26, `<ErrorState` 46, `<LoadingState` 45, `<Alert` 96.
These states are counted with their screen, not as screens of their own.

## 2. Every screen, with purpose, kind and template

The template letters refer to section 5.

### apps/web: 25 screens

| File under `apps/web/src/app/` | Purpose | Kind | Template |
|---|---|---|---|
| `page.tsx` | Shop front with categories | shop home | T1 |
| `buscar/page.tsx` | Search results with brand filter | product list with filters | T2 |
| `c/[slug]/page.tsx` | One category's products | product list with filters | T2 |
| `tienda/[slug]/page.tsx` | One seller's shop and products | seller storefront | T2 |
| `p/[slug]/page.tsx` | Product, offers, reviews | product page | T3 |
| `carrito/page.tsx` | Cart with quantities | cart | T4 |
| `pagar/page.tsx` | Address, delivery, payment, invoice | checkout step | T4 |
| `pedidos/page.tsx` | List of own orders | list of own records | T5 |
| `pedidos/[numero]/page.tsx` | Order, payment, code, returns | order page | T5 |
| `comprobantes/[id]/page.tsx` | Electronic invoice view | fiscal document | T9 |
| `zona/page.tsx` | Choose delivery district | one-question form | T12 |
| `reportar/page.tsx` | Report a product or seller | one-question form | T12 |
| `cuenta/page.tsx` | Name, addresses, security | account form | T11 |
| `cuenta/notificaciones/page.tsx` | Message channels and consent | settings | T11 |
| `cuenta/eliminar/page.tsx` | Delete own account | confirmation (destructive) | T14 |
| `cuenta-eliminada/page.tsx` | Account deleted notice | confirmation | T14 |
| `ingresar/page.tsx` | Sign in or create account | sign-in and recovery | T13 |
| `recuperar/page.tsx` | Ask for reset link | sign-in and recovery | T13 |
| `recuperar/nueva/page.tsx` | Set new password | sign-in and recovery | T13 |
| `verificar/page.tsx` | Second step code | sign-in and recovery | T13 |
| `auth/confirm/page.tsx` | Confirm e-mail link | sign-in and recovery | T13 |
| `ayuda/page.tsx` | Help, terms, privacy | help or legal text | T15 |
| `ayuda/eliminar-cuenta/page.tsx` | Public account-deletion instructions | help or legal text | T15 |
| `not-found.tsx` | Page not found | error state | T14 |
| `error.tsx` | Something failed | error state | T14 |

Route files without a screen: `api/catalogo/refrescar/route.ts`,
`auth/salir/route.ts`, `comprobantes/[id]/[archivo]/route.ts` (file
download), `pedidos/[numero]/pago/retorno/route.ts` (return from the card
page).

### apps/seller: 25 screens

| File under `apps/seller/src/app/` | Purpose | Kind | Template |
|---|---|---|---|
| `page.tsx` | Today's tasks and sales | dashboard of tasks | T6 |
| `productos/page.tsx` | Listings, paused offers | table with filters | T7 |
| `productos/[id]/page.tsx` | Edit listing, photos, variants | detail page with actions + long form | T9 (hybrid, see 5) |
| `productos/nuevo/page.tsx` | Publish a new product | long form | T10 |
| `productos/ofrecer/page.tsx` | Sell an existing product | search then one form | T12 |
| `inventario/page.tsx` | Stock and its history | table with filters | T7 |
| `pedidos/page.tsx` | Orders to pack | table / queue | T7 |
| `pagos/page.tsx` | Payouts, statements, fee invoices | table with summary | T7 |
| `tienda/page.tsx` | Shop face: description, logo | long form | T10 |
| `equipo/page.tsx` | Team members and invitations | settings list | T11 |
| `invitaciones/page.tsx` | Invitations to accept | queue of items to decide | T8 |
| `cuenta/page.tsx` | Business data, bank account | long form | T10 |
| `cuenta/notificaciones/page.tsx` | Message channels | settings | T11 |
| `cuenta/eliminar/page.tsx` | Delete own account | confirmation (destructive) | T14 |
| `cuenta-eliminada/page.tsx` | Account deleted notice | confirmation | T14 |
| `registro/page.tsx` | Register a new shop | long form | T10 |
| `ingresar/page.tsx` | Sign in | sign-in and recovery | T13 |
| `recuperar/page.tsx` | Ask for reset link | sign-in and recovery | T13 |
| `recuperar/nueva/page.tsx` | Set new password | sign-in and recovery | T13 |
| `verificar/page.tsx` | Second step code | sign-in and recovery | T13 |
| `dos-pasos/page.tsx` | Enrol second step | sign-in and recovery | T13 |
| `auth/confirm/page.tsx` | Confirm e-mail link | sign-in and recovery | T13 |
| `comprobantes/[id]/page.tsx` | Fee invoice view | fiscal document | T9 |
| `not-found.tsx` | Page not found | error state | T14 |
| `error.tsx` | Something failed | error state | T14 |

Route files: `auth/salir`, `comprobantes/[id]/[archivo]`, `fotos/[...path]`.

### apps/ops: 50 screens

| File under `apps/ops/src/app/` | Purpose | Kind | Template |
|---|---|---|---|
| `page.tsx` | Today across the operation | dashboard of tasks | T6 |
| `pedidos/page.tsx` | Find any order | table with filters | T7 |
| `pedidos/[numero]/page.tsx` | Order, parcels, money, actions | detail page with actions | T9 |
| `despacho/page.tsx` | Assign parcels to routes | table with filters and bulk actions | T7 |
| `liquidaciones/page.tsx` | Drivers' cash settlements | table with action form | T7 |
| `atencion/page.tsx` | Complaints and returns to decide | queue of items to decide | T8 |
| `mensajes/page.tsx` | Stopped messages to retry | queue of items to decide | T8 |
| `vendedores/page.tsx` | Sellers to approve, list | queue of items to decide | T8 |
| `repartidores/page.tsx` | Drivers and their state | table with action form | T7 |
| `bodegas/page.tsx` | Warehouses and their staff | settings list | T11 |
| `cambios-tienda/page.tsx` | Shop changes to decide | queue of items to decide | T8 |
| `tarifas/page.tsx` | Offers paused by fees | table | T7 |
| `personal/page.tsx` | Staff and roles | table with action form | T7 |
| `auditoria/page.tsx` | Who did what | table | T7 |
| `seguridad/page.tsx` | Staff second-step status | table with actions | T7 |
| `catalogo/page.tsx` | Listings and photos to review | queue of items to decide | T8 |
| `catalogo/productos/page.tsx` | Correct a product | search then long form | T10 |
| `catalogo/categorias/page.tsx` | Category tree editor | settings (tree) | T11 (hybrid, see 5) |
| `catalogo/marcas/page.tsx` | Brands, rename, merge | settings list | T11 |
| `catalogo/busqueda/page.tsx` | Search synonyms | settings list | T11 |
| `catalogo/resenas/page.tsx` | Reviews to moderate | queue of items to decide | T8 |
| `catalogo/fotos/page.tsx` | Remove a product's photos | search then one form | T12 |
| `catalogo/logotipos/page.tsx` | Shop logos to review | queue of items to decide | T8 |
| `operacion/page.tsx` | Delivery zones | settings list | T11 |
| `operacion/distritos/page.tsx` | Districts per zone | settings (matrix with checkboxes) | T11 (hybrid, see 5) |
| `operacion/feriados/page.tsx` | Holidays | settings list | T11 |
| `operacion/cierres/page.tsx` | Zone closures | settings list | T11 |
| `operacion/ubicaciones/page.tsx` | Warehouse locations, moves review | settings list | T11 |
| `operacion/rutas/page.tsx` | Stopped routes to resolve | queue of items to decide | T8 |
| `operacion/ajustes/page.tsx` | Platform settings | settings | T11 |
| `cobros/page.tsx` | Day's payments | table with summary | T7 |
| `cobros/revision/page.tsx` | Payments to check | queue of items to decide | T8 |
| `cobros/reembolsos/page.tsx` | Refunds and their state | table with actions | T7 |
| `cobros/ajustes/page.tsx` | Payment mode and fees | settings | T11 |
| `pagos-vendedores/page.tsx` | Seller payout runs | table with summary | T7 |
| `pagos-vendedores/corridas/[id]/page.tsx` | One payout run | detail page with actions | T9 |
| `comprobantes/page.tsx` | Electronic documents and failures | table with summary | T7 |
| `comprobantes/[id]/page.tsx` | One document, replace it | fiscal document | T9 |
| `cuenta/page.tsx` | Own account security | account form | T11 |
| `cuenta/eliminar/page.tsx` | Delete own account | confirmation (destructive) | T14 |
| `cuenta-eliminada/page.tsx` | Account deleted notice | confirmation | T14 |
| `sin-acceso/page.tsx` | No access to section | error state | T14 |
| `ingresar/page.tsx` | Staff sign-in | sign-in and recovery | T13 |
| `recuperar/page.tsx` | Ask for reset link | sign-in and recovery | T13 |
| `recuperar/nueva/page.tsx` | Set new password | sign-in and recovery | T13 |
| `verificar/page.tsx` | Second step code | sign-in and recovery | T13 |
| `dos-pasos/page.tsx` | Enrol second step | sign-in and recovery | T13 |
| `auth/confirm/page.tsx` | Confirm e-mail link | sign-in and recovery | T13 |
| `not-found.tsx` | Page not found | error state | T14 |
| `error.tsx` | Something failed | error state | T14 |

Route files: `auth/salir`, `comprobantes/[id]/[archivo]`,
`pagos-vendedores/corridas/[id]/transferencias` (bank file).

Only one console screen has real bulk selection: `despacho` (2 checkbox
groups). `catalogo/page.tsx` has 1 checkbox inside a decision form.

### apps/field: 19 screens

| File under `apps/field/src/app/` | Purpose | Kind | Template |
|---|---|---|---|
| `page.tsx` | Choose route or warehouse | role chooser | T6 (no clean fit, see 5) |
| `ruta/page.tsx` | Today's route and stops | route list | T16 |
| `ruta/[parada]/page.tsx` | Deliver, code, cash, fail | stop detail | T16 |
| `bodega/page.tsx` | Parcels to pick, returns | dashboard of tasks | T6 |
| `bodega/paquete/[id]/page.tsx` | Pick and pack a parcel | detail page with actions | T17 |
| `bodega/ubicacion/page.tsx` | Count stock in a location | scanner screen (typed codes) | T17 |
| `bodega/ubicaciones/page.tsx` | Find a location | scanner screen (typed codes) | T17 |
| `bodega/buscar/page.tsx` | Find a product's location | scanner screen (typed codes) | T17 |
| `cuenta/page.tsx` | Own account security | account form | T11 |
| `cuenta/eliminar/page.tsx` | Delete own account | confirmation (destructive) | T14 |
| `cuenta-eliminada/page.tsx` | Account deleted notice | confirmation | T14 |
| `sin-acceso/page.tsx` | No driver or warehouse role | error state | T14 |
| `ingresar/page.tsx` | Sign in | sign-in and recovery | T13 |
| `recuperar/page.tsx` | Ask for reset link | sign-in and recovery | T13 |
| `recuperar/nueva/page.tsx` | Set new password | sign-in and recovery | T13 |
| `verificar/page.tsx` | Second step code | sign-in and recovery | T13 |
| `auth/confirm/page.tsx` | Confirm e-mail link | sign-in and recovery | T13 |
| `not-found.tsx` | Page not found | error state | T14 |
| `error.tsx` | Something failed | error state | T14 |

Route file: `auth/salir`. `manifest.ts` makes it installable.

### apps/shop-native: 19 screens

| File under `apps/shop-native/src/app/` | Purpose | Kind | Template |
|---|---|---|---|
| `(tabs)/index.tsx` | Shop front | shop home | T1 |
| `(tabs)/categorias.tsx` | Department list | category index | T2 |
| `(tabs)/buscar.tsx` | Search with results | product list with filters | T2 |
| `(tabs)/carrito.tsx` | Cart | cart | T4 |
| `(tabs)/cuenta.tsx` | Account hub, help links | account form / menu | T11 |
| `c/[slug].tsx` | One category's products | product list with filters | T2 |
| `p/[slug].tsx` | Product, offers, reviews | product page | T3 |
| `pagar.tsx` | Address, payment, confirm | checkout step | T4 |
| `pedidos/index.tsx` | List of own orders | list of own records | T5 |
| `pedidos/[numero].tsx` | Order, code, returns | order page | T5 |
| `zona.tsx` | Choose district (modal) | one-question form | T12 |
| `direcciones/nueva.tsx` | New address with pin | account form | T10 |
| `reportar.tsx` | Report a problem | one-question form | T12 |
| `ayuda.tsx` | Help topics | help or legal text | T15 |
| `ingresar.tsx` | Sign in, sign up, reset | sign-in and recovery | T13 |
| `cuenta/contrasena.tsx` | Change password | one-question form | T12 |
| `cuenta/notificaciones.tsx` | Message channels | settings | T11 |
| `cuenta/eliminar.tsx` | Delete own account | confirmation (destructive) | T14 |
| `+not-found.tsx` | Screen not found | error state | T14 |

Layouts: `_layout.tsx` (stack), `(tabs)/_layout.tsx` (bottom bar).

### apps/seller-native: 21 screens

| File under `apps/seller-native/src/app/` | Purpose | Kind | Template |
|---|---|---|---|
| `(app)/(tabs)/index.tsx` | Today's tasks and sales | dashboard of tasks | T6 |
| `(app)/(tabs)/pedidos.tsx` | Orders to pack | table / queue (cards) | T7 |
| `(app)/(tabs)/productos.tsx` | Listings | table (cards) | T7 |
| `(app)/(tabs)/inventario.tsx` | Stock, inbound shipments | table (cards) | T7 |
| `(app)/(tabs)/pagos.tsx` | Payouts and bank state | table with summary | T7 |
| `(app)/oferta/[id].tsx` | Price and stock of offer | detail page with actions | T9 |
| `(app)/editar/[id].tsx` | Edit listing | long form | T10 |
| `(app)/publicar.tsx` | Publish a product | long form | T10 |
| `(app)/ofrecer.tsx` | Sell an existing product | search then one form | T12 |
| `(app)/lugar.tsx` | Pickup place with pin | long form | T10 |
| `(app)/envio.tsx` | Send stock to warehouse | long form | T10 |
| `(app)/cuenta.tsx` | Business data, bank, shop face | long form | T10 |
| `(app)/equipo.tsx` | Team members | settings list | T11 |
| `(app)/invitaciones.tsx` | Invitations to accept | queue of items to decide | T8 |
| `(app)/notificaciones.tsx` | Message channels | settings | T11 |
| `(app)/contrasena.tsx` | Change password | one-question form | T12 |
| `(app)/nueva-tienda.tsx` | Register another shop | long form | T10 |
| `registro.tsx` | Sign up and register shop | long form | T10 |
| `ingresar.tsx` | Sign in, reset | sign-in and recovery | T13 |
| `sin-acceso.tsx` | No seller role | error state | T14 |
| `eliminar-cuenta.tsx` | Delete own account | confirmation (destructive) | T14 |

Layouts: root `_layout.tsx`, `(app)/_layout.tsx` (stack with shop name
under the title), `(app)/(tabs)/_layout.tsx` (bottom bar).

### apps/driver-native: 7 screens

| File under `apps/driver-native/src/app/` | Purpose | Kind | Template |
|---|---|---|---|
| `(app)/index.tsx` | Today's route, offline queue | route list | T16 |
| `(app)/parada/[id].tsx` | Deliver, code, cash, fail | stop detail | T16 |
| `(app)/ubicacion.tsx` | Why we ask location | permission explanation | T14 (no clean fit, see 5) |
| `(app)/cuenta.tsx` | Own account | account form | T11 |
| `ingresar.tsx` | Sign in | sign-in and recovery | T13 |
| `sin-acceso.tsx` | No driver role | error state | T14 |
| `eliminar-cuenta.tsx` | Delete own account | confirmation (destructive) | T14 |

### apps/warehouse-native: 11 screens

| File under `apps/warehouse-native/src/app/` | Purpose | Kind | Template |
|---|---|---|---|
| `(app)/index.tsx` | Warehouse board of tasks | dashboard of tasks | T6 |
| `(app)/paquete/[id].tsx` | Pick parcel by scanning | scanner screen | T17 |
| `(app)/recibir/[id].tsx` | Receive seller's stock | scanner screen | T17 |
| `(app)/devuelto/[id].tsx` | Check in returned parcel | detail page with actions | T17 |
| `(app)/buscar.tsx` | Find product's location | scanner screen | T17 |
| `(app)/ubicaciones.tsx` | Shelves and areas | scanner screen + list | T17 |
| `(app)/ubicacion/[codigo].tsx` | Count stock in location | scanner screen | T17 |
| `(app)/cuenta.tsx` | Own account | account form | T11 |
| `ingresar.tsx` | Sign in | sign-in and recovery | T13 |
| `sin-acceso.tsx` | No warehouse role | error state | T14 |
| `eliminar-cuenta.tsx` | Delete own account | confirmation (destructive) | T14 |

`BarcodeScanner` (camera, typing, hand scanner) is on 4 of these screens:
`paquete/[id]`, `recibir/[id]`, `buscar`, `ubicaciones`. The web field app
reads codes typed or from a hand scanner; it has no camera.

### Count by kind (all 177 screens, counted from the tables above)

| Kind | Screens |
|---|---:|
| sign-in and recovery | 26 |
| table (with filters, summary, action form, bulk actions; card lists on phone) | 20 |
| settings and settings lists (incl. 1 tree, 1 matrix) | 17 |
| error state (not found, error, no access) | 14 |
| confirmation (8 destructive: delete account; 4 notices: account deleted) | 12 |
| long form (incl. 1 search then long form) | 12 |
| queue of items to decide | 11 |
| one-question form (incl. 3 search then one form) | 9 |
| detail page with actions (incl. 3 fiscal documents, 1 detail + long form) | 9 |
| scanner screen (4 camera on phone, 3 typed codes on web, 1 with list) | 8 |
| account form (own account hub, incl. 1 menu) | 7 |
| dashboard of tasks (incl. 1 role chooser) | 6 |
| product list with filters (incl. 1 seller storefront, 1 category index) | 6 |
| help or legal text | 3 |
| shop home, product page, cart, checkout step, order page, list of own records, route list, stop detail | 2 each, 16 in all |
| permission explanation | 1 |

The kind of each screen is a judgement made by reading it (estimated);
the file counts are measured.

## 3. Navigation as it is

| App | Where | Destinations | Notes |
|---|---|---:|---|
| web | Sticky header (`apps/web/src/components/header.tsx`): logo, search box, zone link, account link, cart link with count | 5 | Search drops to its own row under 768 px. |
| web | Category bar under the header | top-level categories with products (13 in the demo data, 01-home.png) | Scrolls sideways; links are `min-h-10` (40 px), under the 44 px rule. |
| web | Footer (`footer.tsx`): two lists "Ayuda" and "Yuntera" | 8 | Plain text links, no minimum height. |
| seller | `AppShell` header + `NavLinks` row (`apps/seller/src/app/layout.tsx`) | 8: Resumen, Productos, Tienda, Inventario, Pedidos (count), Pagos, Equipo, Cuenta | Shop chooser in the header when the person has more than one shop. Row scrolls sideways. |
| ops | `AppShell` header + `NavLinks menu` (`apps/ops/src/lib/staff.ts` `SECTIONS`) | 19 for an administrator, filtered by role | Wraps on wide screens; under 1024 px folds into a "Secciones" disclosure. |
| ops | Sub-navigation inside sections | Catálogo 8 (`catalogue-nav.tsx`, used on 8 pages), Operación 7 (`operations-nav.tsx`, 7 pages), Cobros 4 (`payment-nav.tsx`, 4 pages, drawn as buttons) | Three different components for the same job. |
| field | `Frame` around `AppShell` with no section row; header has "Cambiar" (if both roles), "Cuenta", "Salir" | 3 | Home `/` is a two-card chooser (Ruta, Bodega). Bodega has 2 buttons to Ubicaciones and Buscar. |
| shop-native | Bottom bar (`(tabs)/_layout.tsx`) | 5: Inicio, Categorías, Buscar, Carrito (badge), Cuenta | 13 stack screens above it; `zona` opens as a modal. |
| seller-native | Bottom bar (`(app)/(tabs)/_layout.tsx`) | 5: Inicio, Pedidos (badge), Productos, Inventario, Pagos | Header carries shop name, "Cambiar" and an account icon (native-seller-03-home-today.png); 12 stack screens; Tienda, Equipo, Cuenta reached from the account icon. |
| driver-native | Stack only, home without header | 3 more screens: Parada, Su ubicación (modal), Su cuenta | |
| warehouse-native | Stack only, home without header | 7 more screens | |

Web seller has 8 sections; the seller phone app has 5 tabs plus the account
icon. The two do not group sections the same way (Tienda and Equipo are top
level on the web, inside Cuenta on the phone).

## 4. Shared components and repeated patterns

Use counts are `<Name` occurrences in `.tsx` files of the apps and the
packages (definition file excluded), measured. "Files" is files with at
least one use.

### packages/ui (`packages/ui/src/primitives.tsx`, `commerce.tsx`)

| Component | Files | Uses | Where |
|---|---:|---:|---|
| Skeleton | 85 | 103 | ops 41, seller 17, web 14, field 12 |
| Alert | 50 | 137 | ops 20, seller 13, field 7, web 5, next-kit 5 |
| Badge | 57 | 122 | ops 33, seller 10, field 6, web 5 |
| TextField | 42 | 130 | ops 21, seller 8, web 5, field 4, next-kit 4 |
| EmptyState | 42 | 45 | ops 22, seller 9, web 7, field 4 |
| SelectField | 30 | 48 | ops 15, seller 6, web 4, field 4 |
| TextAreaField | 22 | 31 | ops 13, seller 5, web 3 |
| `buttonClass()` (function, not a tag) | 41 | 78 | all four web apps |
| Button | 7 | 15 | most buttons use `buttonClass` on a link or submit instead |
| OrderStatusBadge | 5 | 5 | web 2, ops 2, seller 1 |
| ShipmentStatusBadge | 3 | 3 | web, ops, seller |
| YunteraLogo | 3 | 3 | web 2, next-kit `AppShell` |
| Price | 2 | 3 | web only; `formatPrice()` is called 190 times instead |
| Stars | 2 | 4 | web only |
| WheelGlyph | 1 | 2 | inside `EmptyState` and `Skeleton` only |
| Card, Spinner, YunteraMark | 0 | 0 | exported, never used |

### packages/next-kit

| Component | Files | Uses | Where |
|---|---:|---:|---|
| PageHeader (`shell.tsx`) | 48 | 48 | ops 36, seller 12; web and field write their own `<h1>` |
| ActionForm | 29 | 54 | ops 22, field 4, seller 2, web 1 |
| SubmitButton | 24 | 67 | all apps |
| FormMessage | 24 | 74 | all apps |
| Stat | 7 | 41 | ops 5 files, seller 2 |
| DataTable | 14 | 17 | ops 10, seller 4 |
| DecisionForm | 6 | 9 | ops only |
| AppShell | 3 | 3 | seller, ops, field |
| NavLinks | 2 | 2 | seller, ops |
| SignInForm 4, SignUpForm 2, RecoveryPage 4, NewPasswordPage 4, ConfirmLinkPage 4, VerifyPage 4, SecondFactorPage 2, AccountSecuritySection 4, DeleteAccountPage 4, AccountDeletedPage 4 | 1 per app | | the 27 sign-in and 14 confirmation screens are already shared |
| ProductImage | 6 | 7 | web 5, seller 1 |
| ShopLogo | 4 | 4 | web 2, ops, seller |
| FiscalDocumentView | 3 | 3 | web, seller, ops |
| InvoiceStatusBadge | 4 | 4 | |
| ListingChanges | 2 | 3 | ops, seller |
| DistrictPicker 3, PinPicker 2, NotificationSettingsForm 2, HumanCheck 7 (inside next-kit) | | | |

### packages/expo-kit (`src/ui`, `src/account`, `src/auth`, `src/scanner`)

| Component | Files | Uses | Where |
|---|---:|---:|---|
| Text | 84 | 683 | every screen; the apps never import `Text` from react-native |
| Stack (layout, expo-kit) | about 54 | about 157 | includes 3 expo-router `<Stack>` tags in layouts (measured 3) |
| Button | 51 | 122 | seller-native 24 files, shop-native 13 |
| Card | 44 | 91 | |
| TextField | 33 | 80 | |
| FormMessage | 32 | 73 | |
| Screen | 49 | 63 | |
| LinkButton | 29 | 49 | |
| Alert | 32 | 96 | |
| Badge | 26 | 50 | |
| ErrorState 35 / 46, LoadingState 41 / 45, EmptyState 24 / 26 | | | |
| ChoiceList | 19 | 21 | |
| InfoRow | 6 | 25 | seller-native, shop-native |
| Divider | 9 | 15 | |
| ListRow | 4 | 14 | |
| Checkbox | 10 | 10 | |
| IconButton 7 / 8, TextLink 6 / 11, SectionHeader 2 / 6, Money 2 / 3, Logo 6 / 9 | | | |
| 13 icons (`icons.tsx`) | 1 to 8 files each | | |
| Account screens: ChangePasswordForm 4, DeleteAccountScreen 3, DeleteAccountScreenBody 1, AccountDeletedNotice 4, ForgotPasswordForm 2, NotificationChoicesForm 2 | | | |
| Auth: SignInScreen 2, SignInForm 2, SignUpForm 2, NoAccessScreen 3, SignOutButton 6 / 7, AppProviders 4 | | | |
| BarcodeScanner | 4 | 4 | warehouse-native only |
| ScreenErrorBoundary | 7 references | | exported as each app's `ErrorBoundary` |

### App-local components that duplicate a shared one (measured by reading exports)

- `apps/seller-native/src/components/parts.tsx` redefines `Stat`, `StatGrid`,
  `OrderStatusBadge`, `ShipmentStatusBadge`, `ListingChanges`
  (all exist in packages/ui or next-kit for the web). Imported by 8 files.
- `apps/shop-native/src/components/product.tsx` redefines `ProductImage`,
  `Stars`, `ProductCard`, `ProductGrid`. Imported by 5 files.
- Pin picker exists 3 times: `packages/next-kit/src/client/pin-picker.tsx`,
  `apps/shop-native/src/components/pin-picker.tsx`,
  `apps/seller-native/src/components/pin-picker.tsx`.
- District picker exists 2 times: next-kit and
  `apps/shop-native/src/components/district-picker.tsx`.
- Ops sub-navigation exists 3 times (`catalogue-nav.tsx`,
  `operations-nav.tsx`, `payment-nav.tsx`), one drawn as buttons.
- `apps/ops/src/components/catalogue-outcome.tsx` (outcome notice after a
  form) is imported by 14 files: a shared pattern living in one app.
- `apps/field/src/components/frame.tsx` is imported by 12 files.

### Patterns repeated in place, not a component (web apps, measured)

| Pattern | Count | Files |
|---|---:|---:|
| Bordered rounded box written in a `className` (`border` + `rounded`) | 193 (web 39, seller 43, ops 94, field 17) | 87 |
| of which exactly `rounded-lg border border-border bg-surface p-5` | 27 (+16 with `text-sm`; `p-4 text-sm` 16) | |
| `<details>` disclosure | 39 | 25 |
| `<dl>` definition list | 22 | 19 |
| `<fieldset>` | 21 | 9 |
| `text-link underline` link | 80 | 53 |
| `inline-flex min-h-11 … text-link` link | 39 (23 + 16) | |
| `min-h-11` written by hand | 92 | 47 |
| `rounded-full` pill (counts, chips) | 16 | 13 |
| `tabular-nums` | 105 | 37 |
| `shell py-8` page frame | 61 | 61 |
| grid layouts (`grid-cols`) | 124 | 61 |
| `<h1 className="text-3xl font-bold">` by hand instead of `PageHeader` | 16 (`text-3xl font-bold`) + 13 (`text-2xl font-bold`) | |
| `font-display` by hand | 49 | |
| raw palette colours (`bg-arena-100`, `bg-maiz-50`, `text-anil-500` …) instead of semantic tokens | 68 | |
| arbitrary values (`min-w-[40rem]` …) | 31 | |
| total `className=` attributes | 2,718 (web 615, seller 611, ops 1,244, field 248) | |

### Patterns repeated in place, phone apps (measured)

| Pattern | Count | Files |
|---|---:|---:|
| `StyleSheet.create` blocks | 34 | 34 |
| style keys in those blocks (estimated by a 2-space-indent search) | shop 124, seller 72, driver 37, warehouse 44 | |
| inline `style={{` | 95 (seller 55, shop 32, driver 5, warehouse 3) | |
| `borderWidth` (cards drawn by hand) | 36 | 24 |
| `borderRadius` literals or tokens in apps | 43 | 28 |
| `<Pressable` rows written by hand | 24 | 19 |
| `flexDirection: "row"` | 80 | 43 |
| numeric `fontSize:` in apps | 11 | |
| direct colour tokens (`colors.border` 39, `colors.surface` 36, `colors.brand` 23 …) | | |
| hex colours in apps or expo-kit | 0 | |

## 5. The smallest set of templates

18 templates (17 for screens, 1 for messages) cover 172 of the 177
screens cleanly; 5 screens and 1 shared view are hybrids, named below. Counts are from the tables in section 2.

| # | Template | Screens | Count |
|---|---|---|---:|
| T1 | Shop home | web `/`; shop-native `(tabs)/index` | 2 |
| T2 | Product list (filters; seller-as-person header variant; category index variant) | web `/buscar`, `/c/[slug]`, `/tienda/[slug]`; shop-native `(tabs)/buscar`, `c/[slug]`, `(tabs)/categorias` | 6 |
| T3 | Product page | web `/p/[slug]`; shop-native `p/[slug]` | 2 |
| T4 | Cart and checkout, with C's route line as the step line | web `/carrito`, `/pagar`; shop-native `(tabs)/carrito`, `pagar` | 4 |
| T5 | Shopper's order (route line for tracking, delivery code) and its list | web `/pedidos`, `/pedidos/[numero]`; shop-native `pedidos/index`, `pedidos/[numero]` | 4 |
| T6 | Dashboard of tasks (stat tiles that link, then lists) | seller `/`; ops `/`; field `/bodega`, field `/` (hybrid); seller-native `(tabs)/index`; warehouse-native `(app)/index` | 6 |
| T7 | Table with filters, optional summary row and bulk bar; card list under 640 px | seller `/productos`, `/inventario`, `/pedidos`, `/pagos`; ops `/pedidos`, `/despacho`, `/liquidaciones`, `/repartidores`, `/tarifas`, `/personal`, `/auditoria`, `/seguridad`, `/cobros`, `/cobros/reembolsos`, `/pagos-vendedores`, `/comprobantes`; seller-native `pedidos`, `productos`, `inventario`, `pagos` | 20 |
| T8 | Queue of items to decide (one card per item, reason, approve or refuse) | seller `/invitaciones`; ops `/atencion`, `/mensajes`, `/vendedores`, `/cambios-tienda`, `/catalogo`, `/catalogo/resenas`, `/catalogo/logotipos`, `/operacion/rutas`, `/cobros/revision`; seller-native `invitaciones` | 11 |
| T9 | Detail page with actions (A's order page: facts, timeline, side actions) incl. fiscal document | ops `/pedidos/[numero]`, `/pagos-vendedores/corridas/[id]`, `/comprobantes/[id]`; seller `/productos/[id]` (hybrid), `/comprobantes/[id]`; web `/comprobantes/[id]`; seller-native `oferta/[id]` | 7 |
| T10 | Long form (sections, sticky submit, review notice) | seller `/productos/nuevo`, `/registro`, `/tienda`, `/cuenta`; ops `/catalogo/productos`; shop-native `direcciones/nueva`; seller-native `editar/[id]`, `publicar`, `lugar`, `envio`, `cuenta`, `nueva-tienda`, `registro` | 13 |
| T11 | Settings and reference lists (list + add/edit inline), account hub | web `/cuenta`, `/cuenta/notificaciones`; seller `/equipo`, `/cuenta/notificaciones`; ops `/bodegas`, `/catalogo/categorias` (hybrid), `/catalogo/marcas`, `/catalogo/busqueda`, `/operacion`, `/operacion/distritos` (hybrid), `/operacion/feriados`, `/operacion/cierres`, `/operacion/ubicaciones`, `/operacion/ajustes`, `/cobros/ajustes`, `/cuenta`; field `/cuenta`; shop-native `(tabs)/cuenta`, `cuenta/notificaciones`; seller-native `equipo`, `notificaciones`; driver-native `cuenta`; warehouse-native `cuenta` | 23 |
| T12 | One-question form (incl. search then one form) | web `/zona`, `/reportar`; seller `/productos/ofrecer`; ops `/catalogo/fotos`; shop-native `zona`, `reportar`, `cuenta/contrasena`; seller-native `ofrecer`, `contrasena` | 9 |
| T13 | Sign-in and recovery | web 5 (`ingresar`, `recuperar`, `recuperar/nueva`, `verificar`, `auth/confirm`); seller 6 (+`dos-pasos`); ops 6; field 5; shop-native `ingresar`; seller-native `ingresar`; driver-native `ingresar`; warehouse-native `ingresar` | 26 |
| T14 | Notice page: confirmation, destructive confirmation, empty, error, offline, no access, permission | web 4; seller 4; ops 5; field 5; shop-native `cuenta/eliminar`, `+not-found`; seller-native `sin-acceso`, `eliminar-cuenta`; driver-native `sin-acceso`, `eliminar-cuenta`, `ubicacion` (hybrid); warehouse-native `sin-acceso`, `eliminar-cuenta` | 27 |
| T15 | Help and legal text | web `/ayuda`, `/ayuda/eliminar-cuenta`; shop-native `ayuda` | 3 |
| T16 | Route and stop (C's route line with stations; stop detail) | field `/ruta`, `/ruta/[parada]`; driver-native `(app)/index`, `parada/[id]` | 4 |
| T17 | Scanner task (code field or camera on top, the expected item, the result) | field `/bodega/paquete/[id]`, `/bodega/ubicacion`, `/bodega/ubicaciones`, `/bodega/buscar`; warehouse-native `paquete/[id]`, `recibir/[id]`, `devuelto/[id]`, `buscar`, `ubicaciones`, `ubicacion/[codigo]` | 10 |
| T18 | Message frame (e-mail, SMS, WhatsApp) | `render.ts` `renderEmail` (37 event messages), 10 account e-mails + `_layout.html`, 4 WhatsApp templates, commercial frame | 0 screens (53 messages) |

Sum of screen counts: 2+6+2+4+4+6+20+11+7+13+23+9+26+27+3+4+10 = 177 (measured from the tables in section 2).

**Screens that fit no template cleanly (6):**

1. `apps/seller/src/app/productos/[id]/page.tsx` (399 lines): a detail page
   and a long form at once, with the 604-line `photo-manager.tsx` and
   variant switches. Needs T9 and T10 combined.
2. `apps/ops/src/app/catalogo/categorias/page.tsx` (314 lines): a tree
   editor (parent, order, hide), not a flat list.
3. `apps/ops/src/app/operacion/distritos/page.tsx` (318 lines): a matrix of
   districts against zones with checkboxes and two filters.
4. `apps/field/src/app/page.tsx`: a two-card role chooser, too small for T6.
5. `apps/driver-native/src/app/(app)/ubicacion.tsx`: the explanation before
   the system location prompt; it must follow store rules, not T14's layout.
6. The fiscal document (`FiscalDocumentView`, on 3 screens in T9): its order
   and wording follow the tax format and it must print; it is a template of
   its own inside T9.

Templates that were already drawn in the first font pass: T1 `home.html`, T2
`lista.html` and `lista-filtros.html`, T3 `producto.html`, T4 `carrito.html`
and `pago.html`, T5 `pedido.html`, T6 `app-vende.html` (phone) and
`consola.html`, T16 `ruta.html` and `ruta-entregar.html`, T17
`bodega.html`. Not drawn yet: T7 (as a full table with filters and bulk
bar), T8, T9 (A's order-page layout still to be brought over), T10, T11,
T12, T13, T14, T15, T18.

## 6. What will make the rebuild hard

### Styling written in place

- Web: 2,718 `className` attributes, 193 hand-made bordered boxes in 87
  files, 92 hand-written `min-h-11`, 68 raw palette colours, 31 arbitrary
  values. The Carreta look cannot be applied by changing tokens alone;
  every page file is touched. Estimated: about 120 page and component files.
- `packages/ui` `Card` exists and is used 0 times; pages draw boxes by hand.
- Phone apps: 34 `StyleSheet.create` blocks, 95 inline `style={{`, 36
  `borderWidth`. Colours all go through `colors.*` tokens (0 hex literals),
  so a palette change is cheap; shapes and spacing are not.
- The web header (`apps/web/src/components/header.tsx`) and the footer are
  written in place, not from `AppShell`. The shop's search button and input
  are drawn by hand.

### Journeys and tests that hold on to classes, texts or sizes

- Web journeys: 27 files in `tools/e2e/journeys`, 11,266 lines, 214
  screenshots. Selectors: 437 `[name=…]`, 332 `:has-text(`, 135 `hasText`,
  109 `text=`, 318 `role=`/`aria-`, 24 `data-testid`, 22 `#id`.
  Class selectors: 10 (`main:visible .grid` 3, `ul.grid > li` 2,
  `.grid > div` 2+1, `p.text-sm` 2, `dd.text-success` 1). These break if
  grids or text classes change.
- Size checks: 32 `scrollWidth` checks (no sideways scroll), 5
  `boundingBox()` (44 px targets on `select[name="kind"]`,
  `label[for="aviso-whatsapp"]`, a "← Productos" link, two others),
  3 `getComputedStyle` visibility checks. Layout changes must keep them true.
- Text: 576 text-based selectors (332 + 135 + 109) tie journeys to the
  exact Spanish words; the English version (later) and any wording change
  in the rebuild must update them.
- Phone journeys: 14 files in `tools/native-e2e/journeys`, 5,685 lines,
  run against the Expo web export (`serve.mjs`). 111 `getByTestId`, 59
  `getByText`, 24 `getByRole`, 13 `scrollWidth`, 11 `boundingBox`. The apps
  carry 503 `testID=`; keep them on the rebuilt elements.
- Web apps carry 19 `data-testid=` (journeys use 24 selector references).

### Web and phone versions of the same screen differ

- Shopper: the web has a seller's shop page (`/tienda/[slug]`) and an
  invoice page; shop-native has neither. Shop-native has a Categorías tab
  with no web page. Addresses are a page of their own on the phone
  (`direcciones/nueva`) and part of `/cuenta` on the web.
- Seller: 8 web sections against 5 tabs plus an account icon; Tienda and
  Equipo move. The phone redefines Stat, status badges and ListingChanges
  in `parts.tsx`; the web takes them from packages.
- Field web vs driver-native and warehouse-native: the web reads codes typed
  or from a hand scanner, the phone also uses the camera; the driver phone
  app keeps an offline queue, the web does not.
- Product card, stars, product image, pin picker and district picker are
  written twice (web package and shop-native), the pin picker three times.
  Each Carreta change must be made in each copy.

### Fonts

- Web: `packages/next-kit/src/fonts.ts` loads Inter and Bricolage Grotesque
  with `next/font/local` from `packages/next-kit/fonts/*.woff2`; `base.css`
  maps `--font-sans` and `--font-display`; `h1`–`h3` take the display face
  in `base.css`, and 49 hand-written `font-display` classes elsewhere.
  `packages/brand/src/tokens.css` (generated from `tokens.ts`) names the
  same two families. Swapping to Epilogue 600–800 and Fira Sans is one
  file plus the tokens, but prices are drawn with `font-semibold
  tabular-nums` (105 places) and only become Epilogue if each place is
  changed or a `Price`/`Money` component is used (today `Price` has 3 uses
  against 190 `formatPrice()` calls).
- Phones: fonts are embedded in the binary by the `expo-font` config plugin
  (`packages/expo-kit/src/config.ts` lines 75–113), from
  `@expo-google-fonts/inter` and `@expo-google-fonts/bricolage-grotesque`
  `.ttf` files; `fonts.ts` returns true without loading. The web export
  loads the same files at run time (`fonts.web.ts`). The chosen files in
  `fonts-B2/F2/fonts` are `.woff2` only; the phones need `.ttf` or `.otf`
  of Epilogue 600/700/800 and Fira Sans 400–700 (the F2 Epilogue files
  also carry a U+202F thin-space fix that must be redone in the phone
  files). 145 places in the phone apps name `fontFamily.display` or a
  display text variant.

### The tester build of the shopper app

- Shopper build 0.1.0 (version code 4) from commit `3f251c3` is in Google
  Play internal testing and was sent to App Store Connect (STATUS.md lines
  290–297, 755–765; task list item 27). It cannot change.
- New fonts are native assets: they reach phones only through a new store
  build (estimated; `runtimeVersion` follows the app version and an update
  channel exists, so a JavaScript-only update could restyle 0.1.0 but
  could not bring the embedded Fira Sans and Epilogue).
- The rebuilt shopper app must keep calling the database functions the way
  `3f251c3` does, because STATUS.md (line 1214) relies on that build still
  working against the hosted preview.

### Dark mode

- None today. `packages/expo-kit/src/config.ts` line 234 sets
  `userInterfaceStyle: "light"` for all four phone apps; `tokens.css` has
  0 `dark` rules; e-mails set `color-scheme: light`. If dark mode comes, it
  goes in `packages/brand/src/tokens.ts` (generating `tokens.css`),
  `packages/expo-kit/src/theme/tokens.ts`, the config line, and the 68 raw
  palette classes in the web apps, which bypass semantic tokens.

### Other risks

- Category bar links are 40 px (`min-h-10`, header.tsx); footer links have
  no minimum height; `buttonClass` size `sm` is 36 px on a mouse
  (`min-h-9 … pointer-coarse:min-h-11`, primitives.tsx line 45). The
  critics' open findings on B (focus rings 1.00:1 on the route header,
  1.51:1 on the delivery strip, 2.08:1 on the console side bar; overflow at
  200 % text) must be solved in the templates, not per page.
- `DataTable` forces `min-w-[40rem]` and scrolls inside its frame: at
  390 px and at 200 % text, the 17 tables scroll sideways in their box.
  T7 needs the card list under 640 px.
- Long single files: web `pedidos/[numero]` 602 lines, shop-native
  `pedidos/[numero]` 604, seller `photo-manager.tsx` 604, ops `pedidos/[numero]`
  476, ops `comprobantes` 468, seller-native `editar/[id]` 456. These mix
  data, states and layout; splitting them is part of the rebuild.
- The e-mail frame uses inline styles and a system font stack (render.ts
  line 136); webfonts do not load in most mail programs, so Carreta's titles
  fall back there.
- Privacy states inside templates: the delivery code is shown in web
  `pedidos/[numero]` and shop-native `pedidos/[numero]` only; driver
  screens (`field ruta/[parada]`, `driver-native parada/[id]`) hold the
  field where the driver types it. T5 and T16 must not share the code box.
- The ops navigation holds 19 destinations for an administrator plus 19 in
  three sub-navigations; the chosen side bar must hold 38 links in two
  levels.
