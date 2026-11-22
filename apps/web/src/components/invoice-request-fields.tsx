"use client";

import { SelectField, TextField } from "@yuntera/ui";
import { useEffect, useState } from "react";

/**
 * The optional request for a factura in the shopper's name, for the delivery
 * fee Yuntera charges. Starts unticked: without it the shopper gets a
 * tiquete, which needs no identification. Ticked, it asks for what Hacienda
 * requires of a factura's receiver.
 */
export function InvoiceRequestFields({ values }: { values?: Record<string, string> }) {
  const [wanted, setWanted] = useState(values?.factura === "on");
  // After a refused try, the form comes back with what was typed.
  useEffect(() => {
    setWanted(values?.factura === "on");
  }, [values]);

  return (
    <fieldset>
      <legend className="font-display text-xl font-bold">3. ¿Necesita factura electrónica?</legend>
      <p className="mt-1 text-sm text-ink-muted">
        Por la entrega a domicilio le enviamos un tiquete electrónico. Si necesita una factura a su
        nombre o al de su empresa (por ejemplo, para deducir el gasto), márquelo aquí. Los productos
        los factura cada vendedor.
      </p>
      <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface p-4 has-checked:border-brand has-checked:bg-brand-soft">
        <input
          // A new box whenever the form comes back, so it shows what was chosen
          // (the browser resets the form once its action finishes).
          key={JSON.stringify(values ?? {})}
          type="checkbox"
          name="factura"
          id="factura"
          defaultChecked={values?.factura === "on"}
          onChange={(event) => setWanted(event.target.checked)}
          className="size-5 accent-(--color-brand)"
        />
        <span className="text-sm font-semibold">Quiero factura electrónica a mi nombre</span>
      </label>
      {wanted ? (
        <div className="mt-3 grid gap-4 sm:grid-cols-2" key={JSON.stringify(values ?? {})}>
          <SelectField
            label="Tipo de identificación"
            name="facturaTipo"
            defaultValue={values?.facturaTipo || "fisica"}
          >
            <option value="fisica">Cédula física</option>
            <option value="juridica">Cédula jurídica</option>
            <option value="dimex">DIMEX</option>
            <option value="nite">NITE</option>
          </SelectField>
          <TextField
            label="Número de identificación"
            name="facturaNumero"
            inputMode="numeric"
            autoComplete="off"
            hint="Sin guiones o con ellos, como prefiera."
            defaultValue={values?.facturaNumero}
          />
          <TextField
            label="Nombre o razón social"
            name="facturaNombre"
            autoComplete="name"
            hint="Tal como está inscrito en Hacienda."
            defaultValue={values?.facturaNombre}
            className="sm:col-span-2"
          />
          <TextField
            label="Correo para la factura"
            name="facturaCorreo"
            type="email"
            inputMode="email"
            autoComplete="email"
            optional
            hint="Si lo deja vacío, la factura queda disponible en su pedido."
            defaultValue={values?.facturaCorreo}
            className="sm:col-span-2"
          />
        </div>
      ) : null}
    </fieldset>
  );
}
