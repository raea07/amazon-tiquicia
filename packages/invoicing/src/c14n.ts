/**
 * Exclusive XML canonicalization (http://www.w3.org/2001/10/xml-exc-c14n#,
 * without comments and without an inclusive prefix list) of an element of a
 * tree built by xml.ts. This is the transform the annex's signature example
 * uses for SignedInfo and both references (research note 4.1).
 *
 * The trees here never hold comments, processing instructions, entity
 * references or whitespace between elements, and all attributes are
 * unprefixed, so the general algorithm reduces to the rules below:
 *
 *   - a namespace declaration is written on an element only when the element's
 *     own prefix uses it ("visibly utilized") and the nearest written ancestor
 *     did not already write the same declaration;
 *   - namespace declarations come first, the default one before prefixed ones
 *     and those by prefix; then the attributes, sorted by name;
 *   - elements are always written with a start and an end tag;
 *   - text and attribute values are escaped exactly as xml.ts writes them.
 *
 * `exclude` leaves out a subtree: reference 1 uses it for the transform
 * `not(ancestor-or-self::ds:Signature)`.
 */

import { escapeAttribute, escapeText, type XmlElement, type XmlNode } from "./xml.ts";

type Scope = ReadonlyMap<string, string>;

const prefixOf = (name: string) => (name.includes(":") ? (name.split(":")[0] ?? "") : "");

/** The namespaces in scope at `target`, collected from the root down to it. */
export function scopeAt(root: XmlElement, target: XmlElement): Scope {
  const path: XmlElement[] = [];
  const find = (node: XmlElement): boolean => {
    path.push(node);
    if (node === target) return true;
    for (const child of node.children) if (typeof child !== "string" && find(child)) return true;
    path.pop();
    return false;
  };
  if (!find(root)) throw new Error("element is not in the tree");
  const scope = new Map<string, string>();
  for (const node of path.slice(0, -1)) declare(scope, node);
  return scope;
}

function declare(scope: Map<string, string>, node: XmlElement) {
  for (const [name, value] of node.attrs) {
    if (name === "xmlns") scope.set("", value);
    else if (name.startsWith("xmlns:")) scope.set(name.slice(6), value);
  }
}

export function canonicalize(
  node: XmlElement,
  inherited: Scope = new Map(),
  exclude?: (element: XmlElement) => boolean,
): string {
  return write(node, new Map(inherited), new Map(), exclude);
}

function write(
  node: XmlNode,
  inScope: Map<string, string>,
  rendered: Scope,
  exclude?: (element: XmlElement) => boolean,
): string {
  if (typeof node === "string") return escapeText(node);
  if (exclude?.(node)) return "";

  const scope = new Map(inScope);
  declare(scope, node);

  const prefix = prefixOf(node.name);
  const uri = scope.get(prefix) ?? "";
  const written = new Map(rendered);
  let namespaces = "";
  if (prefix === "") {
    if ((rendered.get("") ?? "") !== uri) {
      namespaces += ` xmlns="${escapeAttribute(uri)}"`;
      written.set("", uri);
    }
  } else if (rendered.get(prefix) !== uri) {
    if (!uri) throw new Error(`prefix ${prefix} is not declared`);
    namespaces += ` xmlns:${prefix}="${escapeAttribute(uri)}"`;
    written.set(prefix, uri);
  }

  const attributes = node.attrs
    .filter(([name]) => name !== "xmlns" && !name.startsWith("xmlns:"))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");

  let out = `<${node.name}${namespaces}${attributes}>`;
  for (const child of node.children) out += write(child, scope, written, exclude);
  return `${out}</${node.name}>`;
}
