"use client";

import type { District } from "@yuntera/db";
import { SelectField } from "@yuntera/ui";
import { useMemo, useState } from "react";

/**
 * Provincia → cantón → distrito, the way every Costa Rican form asks for a
 * location. The chosen district's 5-digit postal code is submitted as
 * `postalCode`. Districts we do not deliver to yet are still listed (so people
 * can find theirs) and marked.
 */
export function DistrictPicker({
  districts,
  defaultPostalCode,
}: {
  districts: District[];
  defaultPostalCode?: string;
}) {
  const initial = districts.find((d) => d.postal_code === defaultPostalCode);
  const [province, setProvince] = useState(initial ? String(initial.province_code) : "");
  const [canton, setCanton] = useState(initial?.canton_code ?? "");
  const [postalCode, setPostalCode] = useState(initial?.postal_code ?? "");

  const provinces = useMemo(
    () => [...new Map(districts.map((d) => [d.province_code, d.province])).entries()],
    [districts],
  );
  const cantons = useMemo(
    () => [
      ...new Map(
        districts
          .filter((d) => String(d.province_code) === province)
          .map((d) => [d.canton_code, d.canton]),
      ).entries(),
    ],
    [districts, province],
  );
  const options = useMemo(
    () => districts.filter((d) => d.canton_code === canton),
    [districts, canton],
  );
  const selected = districts.find((d) => d.postal_code === postalCode);

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <SelectField
        label="Provincia"
        value={province}
        onChange={(event) => {
          setProvince(event.target.value);
          setCanton("");
          setPostalCode("");
        }}
      >
        <option value="">Elija…</option>
        {provinces.map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </SelectField>

      <SelectField
        label="Cantón"
        value={canton}
        disabled={!province}
        onChange={(event) => {
          setCanton(event.target.value);
          setPostalCode("");
        }}
      >
        <option value="">Elija…</option>
        {cantons.map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </SelectField>

      <SelectField
        label="Distrito"
        name="postalCode"
        value={postalCode}
        disabled={!canton}
        onChange={(event) => setPostalCode(event.target.value)}
        hint={
          selected
            ? selected.zone_active
              ? `Código postal ${selected.postal_code}. Sí entregamos aquí.`
              : `Código postal ${selected.postal_code}. Todavía no entregamos en esta zona.`
            : undefined
        }
      >
        <option value="">Elija…</option>
        {options.map((d) => (
          <option key={d.postal_code} value={d.postal_code}>
            {d.district}
            {d.zone_active ? "" : " (aún no llegamos)"}
          </option>
        ))}
      </SelectField>
    </div>
  );
}
