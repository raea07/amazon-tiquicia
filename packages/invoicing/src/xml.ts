/**
 * A small XML tree and its writer. Documents are built as trees and written
 * once, so nothing a person typed can change the structure: every text and
 * attribute value goes through the escaping below, which is also the escaping
 * of canonical XML (c14n.ts), so the bytes written are the bytes signed.
 *
 * No whitespace is written between elements: a signed document must be sent
 * exactly as it was canonicalized, and whitespace text would be signed too.
 */

export interface XmlElement {
  /** Qualified name: `Clave`, `ds:Signature`. */
  name: string;
  /** In document order. Namespace declarations are attributes named `xmlns` or `xmlns:…`. */
  attrs: Array<[string, string]>;
  children: XmlNode[];
}

export type XmlNode = XmlElement | string;

/** Builds an element; `null`, `undefined` and `false` children are left out. */
export function el(
  name: string,
  attrs: Record<string, string> | Array<[string, string]> | null,
  ...children: Array<XmlNode | null | undefined | false | Array<XmlNode | null | undefined | false>>
): XmlElement {
  const flat: XmlNode[] = [];
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    flat.push(child);
  }
  return {
    name,
    attrs: attrs === null ? [] : Array.isArray(attrs) ? attrs : Object.entries(attrs),
    children: flat,
  };
}

/** An element whose only child is a text value; left out when the value is null or undefined. */
export const leaf = (name: string, value: string | number | null | undefined) =>
  value === null || value === undefined ? null : el(name, null, String(value));

export const escapeText = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#xD;");

export const escapeAttribute = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/\t/g, "&#x9;")
    .replace(/\n/g, "&#xA;")
    .replace(/\r/g, "&#xD;");

/**
 * Whether XML 1.0 can carry a code point at all: not the control characters
 * other than tab, newline and carriage return, not a lone surrogate, not
 * U+FFFE or U+FFFF.
 */
const xmlCanCarry = (code: number) =>
  code === 0x9 ||
  code === 0xa ||
  code === 0xd ||
  (code >= 0x20 && code <= 0xd7ff) ||
  (code >= 0xe000 && code <= 0xfffd) ||
  (code >= 0x10000 && code <= 0x10ffff);

const onlyXml = (value: string) =>
  Array.from(value)
    .filter((char) => xmlCanCarry(char.codePointAt(0) ?? 0))
    .join("");

/**
 * What a person typed, made safe for a one-line field of at most `max`
 * characters: characters XML cannot carry are removed, every run of
 * whitespace (newlines included) becomes one space, and the text is trimmed
 * and cut to `max` characters (counted as the schema counts them, by code
 * point). Markup characters are kept; the writer escapes them.
 */
export function cleanText(value: string, max: number): string {
  const one = onlyXml(value.normalize("NFC")).replace(/\s+/g, " ").trim();
  return Array.from(one).slice(0, max).join("").trim();
}

/** Writes the element and everything below it. */
export function serialize(node: XmlNode): string {
  if (typeof node === "string") return escapeText(node);
  let out = `<${node.name}`;
  for (const [name, value] of node.attrs) out += ` ${name}="${escapeAttribute(value)}"`;
  out += ">";
  for (const child of node.children) out += serialize(child);
  return `${out}</${node.name}>`;
}

export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

/** A whole document: the declaration, then the root element. */
export const serializeDocument = (root: XmlElement) => `${XML_DECLARATION}\n${serialize(root)}`;
