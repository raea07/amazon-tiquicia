# Official schemas

The XML schemas the documents are validated against in the tests
(`src/schema.test.ts`). They are Hacienda's own files, unchanged, kept here so
the tests run without a network. Downloaded on 22 November 2026 with `curl`
(default user agent; Hacienda answers 400 to a browser's) from the URLs below.
The SHA-256 of each file equals the one recorded in
`docs/research/hacienda-factura-electronica-v44.md` (section 1, fetched on
21 November 2026), so these are the April 2026 builds the note describes.

| File                                                      | Source                                                            | Last-Modified (server)        | SHA-256                                                            |
| --------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------ |
| `v4.4/factura/FacturaElectronica_V4.4.xsd`                | `https://www.hacienda.go.cr/docs/FacturaElectronica_V4.4.xsd`     | Wed, 22 Apr 2026 21:01:06 GMT | `926ba81325bc21102755bd8e4e570a63caaca086e680a877c3a6d15d6ee8a62f` |
| `v4.4/tiquete/TiqueteElectronico_V4.4.xsd`                | `https://www.hacienda.go.cr/docs/TiqueteElectronico_V4.4.xsd`     | Wed, 22 Apr 2026 17:11:58 GMT | `d7783baf818f316596d0b58b17481be689595982a248d98102d707f72967ae6e` |
| `v4.4/nota-credito/NotaCreditoElectronica_V4.4.xsd`       | `https://www.hacienda.go.cr/docs/NotaCreditoElectronica_V4.4.xsd` | Wed, 22 Apr 2026 17:15:30 GMT | `b7ed3347c5599e78e5683d9ae83842695ab9497e173df9cd3be8d77c0851f556` |
| `v4.4/nota-debito/NotaDebitoElectronica_V4.4.xsd`         | `https://www.hacienda.go.cr/docs/NotaDebitoElectronica_V4.4.xsd`  | Wed, 22 Apr 2026 17:11:58 GMT | `3709389ccc434fb1ef4571079b1a628654fa04f07c1f3f1044b2416ba12eb7ff` |
| `v4.4/mensaje-hacienda/MensajeHacienda_V4.4.xsd`          | `https://www.hacienda.go.cr/docs/MensajeHacienda_V4.4.xsd`        | Wed, 22 Apr 2026 17:10:43 GMT | `b2606156042b7aa7b7f7f61945f0ff1323661b43b5a1489ad5eafad1c52fd25e` |
| `v4.4/mensaje-receptor/MensajeReceptor_V4.4.xsd`          | `https://www.hacienda.go.cr/docs/MensajeReceptor_V4.4.xsd`        | Wed, 22 Apr 2026 17:15:30 GMT | `b883e3a9321eadf2ccc1a9dc853d9e3bd483918dcd6e2152d902ddf2f244365f` |
| `xmldsig-core-schema.xsd` (W3C, imported by every schema) | `https://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd`      | Tue, 16 Apr 2013 12:48:49 GMT | `d102ad3df7664c307e0c2c776ba4a90513b1969974d8a940bae1a77f9f21e15d` |

Each schema imports `../../xmldsig-core-schema.xsd`, which is why the W3C file
sits two directories above them.

These are the `.xsd` files, not the `.xsd.xml` twins in the same directory,
which are the July 2025 build (research note, section 1). The debit-note and
receiver-message schemas are kept for completeness; nothing here issues them
yet.

To check that Hacienda has not published a newer build, compare the
`Last-Modified` header and the hash:

```bash
curl -sI https://www.hacienda.go.cr/docs/FacturaElectronica_V4.4.xsd | grep -i last-modified
curl -s https://www.hacienda.go.cr/docs/FacturaElectronica_V4.4.xsd | sha256sum
```
