# WhatsApp templates, ready to submit

Each `.json` file here is one Spanish **utility** template for the owner's own
WhatsApp Business Account, written to be entered in Bird's template editor
(**WhatsApp > Templates**) or sent to its template API. **Nothing has been
submitted.** Meta reviews each language separately; approval is not
guaranteed and can take from minutes to days.

- `slug` is fixed after the first submission; lowercase letters, digits and
  underscores. It is the same name the worker sends (`template.slug`).
- `variables` are named, each with the sample value Meta asks for. The
  worker sends exactly these names (`template.parameters`); a unit test
  (`src/whatsapp.test.ts`) fails if the two drift.
- `button.url` ends in `{{button_url}}`: the worker sends only the suffix
  (the order number), never a full URL.
- `ttl_seconds` is set where a late message would mislead ("va en camino"):
  without it a utility template lives 30 days at Meta.
- Language: `es`. Which Spanish codes Bird's editor offers was not confirmed;
  if it offers `es_CR` or `es_LA`, use it and set `BIRD_WHATSAPP_LANGUAGE`.

No template carries the delivery code, an address, an identification number
or payment details, and none is promotional: an offer or upsell would make
Meta re-categorise it as marketing (more expensive, and it would need the
commercial consent).
