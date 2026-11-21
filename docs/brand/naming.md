# Naming report

**Decision: the platform is called Yuntera.**

This records how the name was chosen and what was verified, so the decision can
be audited or reopened. Checks were run on **21 November 2026**; availability
changes daily, so re-run them before spending money on the name.

## The brief

From the owner:

1. Check that the **website (domain) and app names are available** before
   proposing anything. A name that is taken is not an option.
2. The name **may** be rooted in Costa Rica but does **not** need to be slang.

## Method

About 880 candidates were generated across several directions (heritage and
logistics words, flora and fauna, everyday Costa Rican phrases, the _-tico_
diminutive, coined blends) and filtered in four gates, cheapest first:

| Gate                   | What was checked                               | How                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. `.com`              | Exact-match domain unregistered                | Verisign RDAP (authoritative registry for `.com`): HTTP 404 = unregistered                                                                                                           |
| 2. `.cr`               | Exact-match domain undelegated                 | DNS NS lookup; `NXDOMAIN` from NIC Costa Rica's servers. Method validated against known registered names (`delfino.cr`, `automercado.cr`, `kolbi.cr` resolve; nonsense names do not) |
| 3. App stores          | No app with the name in its title or bundle id | Apple iTunes Search API for the CR, US, MX and ES storefronts; Google Play search for Costa Rica                                                                                     |
| 4. Existing businesses | No company, product or brand using the name    | Web search, Spanish and English                                                                                                                                                      |

Finalists were then confirmed purchasable through a registrar (Vercel Domains),
which also returned prices.

### What the gates eliminated

- **Every plain Spanish word.** `carreta`, `yunta`, `tramo`, `feria`, `ocupo`,
  `encargo`, `atajo`, `alisio`, `vueltica`, `toditico`, `prontico` and several
  hundred more all have their `.com` registered.
- **Earlier front-runners.** _Upe_ collides with **UPEE**, an existing Costa
  Rican discounts-and-rewards app (same pronunciation, adjacent category).
  _Pulpe_ collides with Fifco's **La Pulpe Digital**. _Carreta_ and _Chunche_
  were clear of conflicting businesses but their `.com` domains are taken.

## The decision: Yuntera

_Yunta_ is the yoked pair of oxen that pulls the Costa Rican carreta — the cart
that carried the country's coffee to port and is a national symbol of work. To
do something _en yunta_ is to pull together. **Yuntera** is a coined word built
on that root.

| Check                                     | Result                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| `yuntera.com`                             | Available — US$12.03/yr                                                           |
| `yuntera.cr`                              | Not delegated in DNS (appears unregistered) — register directly at NIC Costa Rica |
| `yuntera.app`                             | Available — US$14.99/yr                                                           |
| `yuntera.store` / `.shop` / `.co` / `.io` | Available                                                                         |
| Apple App Store (CR, US, MX, ES)          | No app named Yuntera                                                              |
| Google Play (CR)                          | No app named Yuntera                                                              |
| Web search                                | No company, brand or product named Yuntera found                                  |

Why it was chosen over the other survivors:

- **Strongest kind of trademark.** An invented word is "fanciful" in trademark
  terms, the most protectable category. Descriptive names (_Tiquería_,
  _Mercado Tico_) are the hardest to register and defend.
- **Costa Rican at the root, not slang.** It satisfies the brief without tying
  the brand to an informal register that would sit badly next to payments and
  warranties.
- **It describes the business model.** A marketplace is a yoke: seller and
  buyer, shop and courier, pulling the same load.
- **It travels.** Seven letters, three syllables, pronounced the same by a
  Spanish or English speaker (_yoon-TEH-rah_), and not limited to Costa Rica if
  the company later serves Central America.
- **It yields a clean family** — see below.

No negative meanings were found. In Peru and Chile _yunta_ is an affectionate
word for a close friend.

### App family

| Surface            | Name                | For               |
| ------------------ | ------------------- | ----------------- |
| Shopping web + app | **Yuntera**         | Shoppers          |
| Seller centre      | **Yuntera Vende**   | Sellers and PYMEs |
| Driver app         | **Yuntera Ruta**    | Delivery drivers  |
| Warehouse app      | **Yuntera Bodega**  | Warehouse staff   |
| Internal console   | **Yuntera Central** | Operations        |

## Runners-up

All four passed every gate (both domains free, no app-store or business
conflict found) and remain usable if Yuntera is rejected.

| Name            | Idea                                                                              | Why it was not first                                                                                     |
| --------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Minutico**    | "En un minutico" — speed, and the _-tico_ diminutive Costa Ricans are named after | Promises minutes; the launch service is next-day. A name that over-promises invites complaints           |
| **Tiquería**    | _Tico_ + _-ería_: "the Tico shop"                                                 | Reads close to _tiquete_ (ticket) and _taquería_; needs an accent; descriptive, so weaker as a trademark |
| **QuéOcupa**    | "¿Qué ocupa?" — what a Costa Rican shopkeeper asks                                | A phrase, awkward to extend ("QuéOcupa Vende"); outside Costa Rica _okupa_ means squatter                |
| **Cien Metros** | The unit of every Costa Rican address: "100 metros al norte"                      | Suggests a neighbourhood quick-commerce service more than a national marketplace                         |

## Renaming is cheap by design

The product name, app names, taglines and domains are read from one file,
[`packages/brand/src/brand.ts`](../../packages/brand/src/brand.ts). The logo is
one component, [`logo.tsx`](../../packages/brand/src/logo.tsx). Changing the
name is an edit to those two files; nothing else hard-codes it.

## Not done — needs the owner

These cost money, are hard to reverse, or need a legal identity, so they were
deliberately left:

1. **Register the domains.** `yuntera.com` and `yuntera.app` at any registrar;
   `yuntera.cr` at [nic.cr](https://www.nic.cr). Do this first — it is the only
   step that can be lost to someone else.
2. **Trademark search and filing** at the Registro Nacional (Registro de la
   Propiedad Intelectual), in the classes covering online retail/marketplace
   services, transport and delivery, and software. The checks above cover
   domains, app stores and visible web presence; they are **not** a trademark
   search and cannot find marks that are registered but unused online.
3. **Reserve social handles** (`@yuntera` on Instagram, Facebook, TikTok, X,
   WhatsApp Business). These could not be checked reliably from this
   environment.
4. **Reserve the app names** by creating the app records in App Store Connect
   and Google Play Console once developer accounts exist.

## Caveats on the evidence

- The `.cr` result is a DNS check, not a registry lookup: NIC Costa Rica's RDAP
  service was unreachable from the build environment. A domain can be
  registered without being delegated, so treat `.cr` as "very likely free" until
  nic.cr confirms it.
- App-store searches match published apps. A name can be reserved in a
  developer account without being published.
