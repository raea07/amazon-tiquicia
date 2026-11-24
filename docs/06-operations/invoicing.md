# Electronic invoices (Hacienda v4.4)

What Yuntera issues, when and to whom; what finance does when Hacienda
rejects a document or does not answer; and everything the owner must set up
before the first real document. The research behind every rule is
[`docs/research/hacienda-factura-electronica-v44.md`](../research/hacienda-factura-electronica-v44.md)
(read its corrections at the end). This is engineering, not tax advice: the
accountant's questions at the end are open.

**State today.** Built and tested locally against a fake of Hacienda
(`tools/dev-hacienda`). Never run against Hacienda's sandbox or production:
the company is not registered, and there are no credentials or
cryptographic key. Nothing is deployed.

## What is issued, when, to whom

| When                                                      | Document                                                                                                   | To                                                                                           | Amounts                                                                                                                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A payment is captured and the order paid for delivery     | Tiquete electrónico (04); factura electrónica (01) if the shopper asked for one at checkout                | The shopper (a tiquete names nobody)                                                         | The delivery fee, IVA included: net = fee ÷ 1.13 at five decimals, IVA 13 %                                                                                          |
| A payment is captured                                     | Factura electrónica (01), one per seller of the order                                                      | The seller (legal name, identification, contact e-mail from its fiscal details)              | Commission, warehouse fee and payment fee from the order's fee statement, 13 % IVA on top                                                                            |
| A paid order is cancelled (the capture is reversed)       | Nota de crédito (03) for each document of the order, in full, code 01                                      | Same receiver as the original                                                                | The original's lines                                                                                                                                                 |
| Goods are returned or a parcel comes back and is refunded | Nota de crédito (03) to each seller, code 06                                                               | The seller                                                                                   | The commission given back on the returned units, as the ledger booked it; payment and warehouse fees and the delivery fee are not refunded, so their documents stand |
| Hacienda rejected a document and finance replaces it      | A new document of the same type, with a new number, referencing the rejected one (TipoDocIR 10, Codigo 16) | Same receiver (a seller's details re-read; a shopper's factura can be reissued as a tiquete) | The same amounts                                                                                                                                                     |

Sellers issue their own documents for the goods with their own systems (or
Hacienda's free TICO Factura), as the research note recommends: nothing here
signs or sends anything in a seller's name. The shopper's order page says so.

Every document is made exactly once from the event that causes it (an
`invoice` job of the outbox), numbered from a counter locked in the same
transaction (one counter per document type; no gaps, never reused), signed
once by the worker, stored, and only then sent. The receiver can download it
at once, before Hacienda answers (RCE art. 2.11, 18).

Some rules of the planning that matter to finance:

- Each document of a paid order is made on its own: a shop with incomplete
  fiscal details holds back only its own fee factura, never the shopper's
  document or the other shops' facturas.
- An `invoice` job never gives up. A job that fails is tried again on every
  run (every 30 seconds on Supabase), after the jobs that have not failed,
  until the cause is fixed; the console lists it with the order and the shop.
- A refund's credit notes wait until every earlier event of the same order
  has made its documents, so a refunded order always has its documents
  credited, whatever order the events were planned in.
- Free delivery: Yuntera charges the shopper nothing, so it issues the
  shopper nothing. The checkout does not offer a factura then, and anything
  typed for one is discarded when the payment is captured.
- A factura request typed at checkout is kept while its order can still be
  paid (cash on delivery is paid at the door, days later). It is forgotten
  two days after it was typed if no order was placed with it, or as soon as
  its order is cancelled without a payment.
- What a shopper types (the name, the e-mail) is cleaned and checked at
  checkout with the same rules the XML writer applies (characters XML cannot
  carry removed, the annex's e-mail structure), so a document numbered from
  it can always be written. The XML is validated against the official XSDs
  only in the unit tests (`packages/invoicing/src/schema.test.ts`); at run
  time the worker applies its own checks (lengths, patterns, codes, every
  amount recomputed) before signing, and Hacienda's validator is the final
  word.

### Where things live

| What                                                                       | Where                                                                                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Document rows (numbers, clave, snapshots, transmission)                    | `public.electronic_invoices`, reachable only through functions                                                                        |
| Signed XML (`{clave}.xml`) and Hacienda's answer (`{clave}_respuesta.xml`) | `private.electronic_invoice_files`, unchangeable once written                                                                         |
| Numbering                                                                  | `private.fiscal_counters`                                                                                                             |
| Settings                                                                   | `app_settings` keys `invoicing_issuer` and `invoicing_policy`                                                                         |
| XML, signature, API client, worker loop                                    | `packages/invoicing`                                                                                                                  |
| Edge Functions                                                             | `supabase/functions/invoice-worker`, `supabase/functions/hacienda-callback`                                                           |
| Screens                                                                    | Console `/comprobantes`; seller centre `/pagos` (facturas section) and `/comprobantes/<id>`; shop order page and `/comprobantes/<id>` |

The files stay in the database, not in Storage: a signed document is about
8 KB and an answer about 3 KB before PostgreSQL compresses them; keeping
them in the same transaction as the document's state, under the database's
backups and an immutability trigger, is simpler and safer at the pilot's
volume. At around a thousand documents a day for ten years that is still a
few gigabytes; move them to a private bucket if the table becomes the
largest cost.

## Daily work for finance (console → Comprobantes)

- **Rechazados por Hacienda.** Read Hacienda's reason. Fix the cause first
  (most often the platform's activity code or registration, or a shop's
  legal name or identification: correct the shop's fiscal details through a
  shop-change request). Then press **Emitir reemplazo**; the console opens
  the new document, with its number. A rejected document
  has no validity and is never corrected or credited (RCE art. 10, 19). For a
  shopper's factura whose identification Hacienda does not recognise, use
  **Reemplazar por un tiquete sin receptor**. A credit note that depends on a
  rejected document waits until it is replaced, then goes out by itself.
- **Sin respuesta después de 3 horas.** Hacienda has up to three hours to
  answer (RES27 art. 11). Without its acceptance the receiver cannot use the
  IVA as a credit nor deduct the expense; for a fee factura that hurts the
  seller. The worker keeps asking every hour. If it lasts, look the clave up
  in Hacienda's portal and tell the seller.
- **Sin enviar.** When Hacienda cannot be reached, documents are kept and
  sent when it is back, retrying with back-off up to once an hour (RCE
  art. 21: no paper voucher, no deadline stated). A document held by the
  worker's own checks (an amount that does not add up, a field it cannot
  write) is a bug: report it. If the cause was outside the document (a
  setting), press **Enviar ahora** once it is fixed. If the cause is in the
  document itself, press **Emitir reemplazo** (or, for a shopper's factura,
  **Reemplazar por un tiquete sin receptor**): it was never signed nor sent,
  so a new document with the next number replaces it without referencing
  it, and the held one is set aside with its number unused (recorded in the
  audit log; see the accountant's question 14). **Enviar ahora** does not
  take a document from a worker that is sending it, and lifts the pause
  banner only when retrying the document that caused the pause. A pause
  banner means Hacienda refused the credentials or the address: fix the
  configuration, then press **Enviar ahora** on that document.
- **Pagos sin todos sus comprobantes.** Each order (or refund) whose
  documents could not all be made yet, with the shop and the reason, almost
  always a shop's legal name or identification. Correct the shop's fiscal
  details through a shop-change request; the documents are issued by
  themselves within a minute.
- **Por día.** Documents against paid orders, to notice a gap.
- **La llave vence pronto.** The worker reports the certificate's expiry;
  renew the key before it lapses (validity is read from the certificate:
  sources disagree on 2 or 4 years).

Contingency in the narrow legal sense (Yuntera's own system unusable, paper
vouchers, situation `2`, references `08`/`05`) is a manual procedure the
accountant must define; the code only supports situation `1`.

## Before going live

In this order. Every step is for the owner; none has been done.

1. **Registration.** The legal entity registered with Hacienda in TRIBU-CR as
   taxpayer and "emisor receptor electrónico", with its economic activities
   (CIIU 4, six characters in the XML). Ask the previous invoicing tool, if
   any, for its last consecutive numbers: numbering must continue
   (set them in `private.fiscal_counters` before the first document).
2. **Issuer settings.** In the database, `app_settings.invoicing_issuer`: legal
   name, commercial name, identification type and number, the registered
   activity code, province / cantón / district codes and exact address,
   invoicing e-mail(s), establishment and terminal (`001` / `00001` unless the
   accountant says otherwise), `provider_id` (own development: the company's
   own identification), and finally `ready: true`. Until then nothing is
   numbered and paid orders wait in order.
3. **Policy settings.** `app_settings.invoicing_policy`, with the
   accountant: who issues the delivery fee's document (`platform`, or
   `seller_third_party` to issue nothing for it), the CABYS codes of the four
   services (placeholders today: delivery `6803000000000`, commission
   `6254400000000`, warehouse `6729000000000`, payment `7119002009900`), how
   fees netted from a payout are coded (today `99` "Compensación contra la
   liquidación de ventas", sale condition `01`), the credit-note codes (`01`
   for a cancellation, `06` for a return), the answer window and the
   retention period.
4. **Sandbox credentials and key.** In TRIBU-CR, for the **test**
   environment: the API user and password (they arrive in the company's
   electronic mailbox) and a cryptographic key (.p12 with its PIN). Convert
   the key once, on a trusted machine, to an encrypted PKCS#8 PEM with the
   same PIN, and the certificate to PEM:

   ```bash
   openssl pkcs12 -legacy -in llave.p12 -nocerts -nodes \
     | openssl pkcs8 -topk8 -v2 aes-256-cbc -v2prf hmacWithSHA256 -out llave.pem   # asks for the PIN twice
   openssl pkcs12 -legacy -in llave.p12 -clcerts -nokeys -out certificado.pem
   ```

   (`-legacy` is for keys from before July 2026; newer keys may open without
   it.) Delete the plain intermediate output; never commit any of these files.

5. **Secrets** (Supabase dashboard → Edge Functions → Secrets, never the
   repository): `INVOICE_SECRET_KEY` (a secret key used by this worker alone),
   `INVOICE_WORKER_TOKEN` and `HACIENDA_CALLBACK_TOKEN` (long random strings),
   `HACIENDA_USERNAME`, `HACIENDA_PASSWORD`, `INVOICE_SIGNING_KEY` (the
   encrypted PEM), `INVOICE_SIGNING_PIN`, `INVOICE_SIGNING_CERT`. In Vault:
   `invoice_worker_token` (the same token) next to the existing `project_url`.
6. **Non-secret settings and deploy**, with
   [`supabase/scripts/deploy-invoicing.sh`](../../supabase/scripts/deploy-invoicing.sh)
   (`check`, `config`, `deploy`; not run so far): `INVOICE_ENV=stag`,
   `INVOICE_API_URL`, `HACIENDA_CALLBACK_URL=https://<ref>.supabase.co/functions/v1/hacienda-callback`.
   The token URL, client id (`api-stag`) and API base default to the
   research note's values; the sandbox base is the one observed answering
   (`https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1/`), not
   the annex's, and must be confirmed with the credentials.
7. **Sandbox certification.** Issue real test documents of each type and
   check, in this order: a tiquete accepted; a factura to a test receiver;
   a credit note referencing each; a deliberate rejection replaced. Confirm
   the unverified points listed below (signature acceptance above all). If
   the signature is refused, try `INVOICE_CERT_DIGEST=sha1` (the annex's own
   example digests the certificate with SHA-1).
8. **Production.** A production key, user and password (separate from the
   test ones), `INVOICE_ENV=prod`, deploy again. From then on documents are
   legal ones.

### Not verified, and only provable with Hacienda's sandbox

- That Hacienda's validator accepts the signature (XAdES-EPES built with
  WebCrypto; reference 1 uses the XPath transform of the annex example; the
  certificate digest is SHA-256 by default). Tests verify the structure, both
  digests and the RSA value with an independent canonicalizer and Node's
  crypto, nothing more.
- The sandbox API host, the accepted spelling of `fecha` (we send the same
  string as `FechaEmision`, `-06:00`), success always being `201`, the
  rate limits, the decimal tolerance (`net + tax` may read one hundred-thousandth
  above the gross, e.g. `100.00001`), whether a rejected document's number is
  considered used, and whether a document refused at reception (400) should
  be referenced by its replacement (we do not reference it).
- Hacienda's answers are parsed for `Mensaje` and `DetalleMensaje` only; its
  XAdES-XL signature is not verified (the callback is only a hint; the
  worker always asks Hacienda itself).

### Not built

- The seller's own documents for the goods are not recorded on the order (the
  note's section 8.4: the seller reports its clave and XML). Shoppers are
  told that each seller invoices the goods.
- Fee facturas per settlement period (the setting exists; only `per_order`
  is implemented). Debit notes, receiver messages for suppliers' invoices,
  the REP, exemptions, purchase and export invoices.
- E-mailing the documents (they are made available on the order page and
  the statements); a PDF (the readable page can be printed); the QR code
  (suspended by Hacienda).
- Checking a shopper's identification against Hacienda's register before
  issuing (`/fe/ae`): only its shape is checked; Hacienda checks the rest.
- Deleting documents after the retention period.

## Questions for the accountant (open)

From the research note, section 10, unresolved:

1. Which payment-method code should sellers put on their documents when
   Yuntera collects: `05`, `07`, or the shopper's actual method?
2. Is the delivery fee a separate Yuntera service to the shopper (own
   tiquete, 13 %), or should it travel on the seller's document as a "cobro
   de un tercero"? (Setting `delivery_fee_issuer`; default `platform`.)
3. Fee invoices to sellers: per order or per settlement period? Which sale
   condition and payment method when fees are netted from the payout?
   (Default per order, `01` and `99`.)
4. Which CABYS codes and which registered economic activity for delivery,
   commission, warehouse and payment fees?
5. Refunds: reference code `01` or `06`; who issues what when an order with
   several sellers is partly returned; are commissions reversed by credit
   note? (Default: `01` for a cancellation, `06` for the commission on a return.)
6. May a tiquete be replaced by a factura after the fact, and how?
7. Régimen Simplificado sellers: can they sell through an online marketplace
   at all, and what must the order show the shopper?
8. Platform report (MH-DGT-RES-0025-2024): opt into the under-EUR-1-million
   exclusion or report from the first year? Confirm the data set and the
   current filing window.
9. Retention period to adopt (5 years or longer). (Default setting: 10.)
10. Direct integration or a provider, considering who will answer Hacienda's
    rejections day to day.
11. Whether Yuntera may later issue on sellers' behalf and what registering
    as a "proveedor de sistemas" involves.
12. Whether a platform report was already due for 2025, and whether the
    exclusion notice must be filed before each reporting year.
13. Under RCE art. 2.13, may a business buyer issue a factura electrónica de
    compra for goods bought from any simplified-regime seller, or only from
    those not registered as "no confirmante"?
14. A document numbered but never sent (held by the platform's own checks
    and replaced with the next number) leaves its number unused, and the
    rules ask for numbering "sin saltos". Is the audit trail enough, or must
    such a number be reported or handled another way? (No code path should
    produce one: what is typed is checked at input with the writer's rules.)
