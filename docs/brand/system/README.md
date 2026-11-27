# The Carreta design system

This folder is the design system of all eight Yuntera apps, as it was drawn,
measured and independently checked on 27 November 2026. It is the source for
the rebuild of the apps and for the brand book.

Start with [`SISTEMA.md`](SISTEMA.md). It holds every rule, the tokens, the
components, the 19 screen templates, the words for each status, the plan for
English and the build order with one owner per file.

| Path                              | What it is                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `SISTEMA.md`                      | The specification. Its token, migration and status tables are generated.                 |
| `index.html` and the other pages  | 46 reference pages, one or more per template. Open them in a browser; they work offline. |
| `carreta.css`                     | The one stylesheet of the reference pages. Generated; do not edit by hand.               |
| `tokens.json`                     | Every token value, light and dark.                                                       |
| `migration.json`                  | Today's names mapped to the new ones, the ratchet patterns, the words for each status.   |
| `fonts/`                          | Epilogue and Fira Sans as built for the web and for the phone apps, with their licences. |
| `assets/logo`, `assets/app-icons` | Lockups with the text in outlines, and the app icons.                                    |
| `src/`                            | The generators and the measuring scripts. `SISTEMA.md` section 0 lists the commands.     |
| `inventory.md`                    | The 177 screen files sorted by template, counted on 24 November 2026.                    |

What is not here:

- The screenshots (`shots/`, 53 MB). `node src/shots.js` writes them again;
  git leaves that folder out.
- The first drafts the system started from. They are not needed to rebuild it.

What was not checked: the fonts on a real phone, screen readers on a phone,
real mail programs and English screens. `SISTEMA.md` section 18 has the full
list.

The lint and format checks of the repository leave this folder alone, because
most of it is generated.
