import type { ListingContent, ListingEditField } from "@yuntera/db";
import type { ReactNode } from "react";

/**
 * A proposed change to a published listing, old and new side by side.
 *
 * The seller sees it while their change waits, and catalogue staff see it when
 * they decide. Only the fields that differ are shown; each side is labelled in
 * words, so nobody has to rely on colour to tell which is which.
 */

const FIELDS: ReadonlyArray<{ field: ListingEditField; label: string }> = [
  { field: "title", label: "Título" },
  { field: "category_slug", label: "Categoría" },
  { field: "bullet_points", label: "Características" },
  { field: "description", label: "Descripción" },
  { field: "weight_grams", label: "Peso del paquete" },
  { field: "length_cm", label: "Largo del paquete" },
  { field: "width_cm", label: "Ancho del paquete" },
  { field: "height_cm", label: "Alto del paquete" },
];

const number = (value: number) => value.toLocaleString("es-CR", { maximumFractionDigits: 1 });

function show(content: ListingContent, field: ListingEditField): ReactNode {
  switch (field) {
    case "title":
      return content.title;
    case "category_slug":
      return content.category_name;
    case "description":
      return content.description ? (
        <span className="whitespace-pre-line">{content.description}</span>
      ) : (
        <span className="text-ink-muted">Sin descripción</span>
      );
    case "bullet_points":
      return content.bullet_points.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5">
          {content.bullet_points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      ) : (
        <span className="text-ink-muted">Sin características</span>
      );
    case "weight_grams":
      return `${number(content.weight_grams)} g`;
    default:
      return `${number(content[field])} cm`;
  }
}

/** The fields whose value differs between two versions of a listing. */
export function changedListingFields(
  before: ListingContent,
  after: ListingContent,
): ListingEditField[] {
  return FIELDS.map(({ field }) => field).filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
}

export function ListingChanges({
  before,
  after,
  changed = changedListingFields(before, after),
  beforeLabel = "Publicado ahora",
  afterLabel = "Propuesto",
}: {
  before: ListingContent;
  after: ListingContent;
  /** Which fields to show. Worked out from the two versions when left out. */
  changed?: readonly ListingEditField[];
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const rows = FIELDS.filter(({ field }) => changed.includes(field));
  if (rows.length === 0) {
    return <p className="text-sm text-ink-muted">La propuesta ya coincide con lo publicado.</p>;
  }
  return (
    <dl className="flex flex-col gap-4 text-sm">
      {rows.map(({ field, label }) => (
        <div key={field}>
          <dt className="font-semibold">{label}</dt>
          <dd className="mt-1.5 grid gap-2 sm:grid-cols-2">
            <div className="min-w-0 break-words rounded-md border border-border bg-surface-muted p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {beforeLabel}
              </p>
              {show(before, field)}
            </div>
            <div className="min-w-0 break-words rounded-md border border-brand bg-brand-soft p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-link">
                {afterLabel}
              </p>
              {show(after, field)}
            </div>
          </dd>
        </div>
      ))}
    </dl>
  );
}
