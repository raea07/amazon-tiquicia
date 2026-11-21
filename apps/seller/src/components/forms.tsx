"use client";

import { parsePhone } from "@yuntera/core";
import type { District, SellerListing, SellerLocations, SellerParcel } from "@yuntera/db";
import {
  type ActionState,
  DistrictPicker,
  FormMessage,
  PinPicker,
  SubmitButton,
} from "@yuntera/next-kit/client";
import { SelectField, TextAreaField, TextField } from "@yuntera/ui";
import { useActionState, useState } from "react";
import {
  createInbound,
  markPacked,
  registerShop,
  saveLocation,
  setStock,
  updateOffer,
} from "@/app/actions";

const initial: ActionState = {};

/** Céntimos as the plain number a person would type back: 1990000 → "19900". */
const plainColones = (amountMinor: number) =>
  amountMinor % 100 === 0
    ? String(amountMinor / 100)
    : (amountMinor / 100).toFixed(2).replace(".", ",");

// ── Registering a shop ──────────────────────────────────────────────────────

export function RegisterShopForm({ defaultEmail }: { defaultEmail: string | null }) {
  const [state, action] = useActionState(registerShop, initial);
  const [phone, setPhone] = useState(state.values?.contactPhone ?? "");
  const parsedPhone = phone.trim() ? parsePhone(phone) : null;

  return (
    <form action={action} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-4">
        <legend className="font-display text-lg font-bold">Su tienda</legend>
        <TextField
          label="Nombre de la tienda"
          name="tradeName"
          defaultValue={state.values?.tradeName}
          hint="Es el nombre que ven los compradores, por ejemplo “Cafetal Los Santos”."
          maxLength={80}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="font-display text-lg font-bold">Quién vende</legend>
        <p className="text-sm text-ink-muted">
          Estos datos deben coincidir con su inscripción en Hacienda. Los usamos para verificar su
          identidad y para los informes que la ley nos pide; los compradores no los ven.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Tipo de identificación"
            name="idType"
            defaultValue={state.values?.idType ?? "fisica"}
          >
            <option value="fisica">Cédula física</option>
            <option value="juridica">Cédula jurídica</option>
            <option value="dimex">DIMEX</option>
            <option value="nite">NITE</option>
          </SelectField>
          <TextField
            label="Número de identificación"
            name="idNumber"
            inputMode="numeric"
            defaultValue={state.values?.idNumber}
            placeholder="1-0234-0567"
          />
        </div>
        <TextField
          label="Nombre o razón social"
          name="legalName"
          defaultValue={state.values?.legalName}
          hint="Tal como aparece en su cédula o en el Registro Nacional."
        />
        <TextAreaField
          label="Dirección fiscal"
          name="fiscalAddress"
          rows={2}
          defaultValue={state.values?.fiscalAddress}
          placeholder="San José, Montes de Oca, San Pedro, de la Fuente de la Hispanidad 300 m sur"
        />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="font-display text-lg font-bold">Contacto</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Correo de contacto"
            name="contactEmail"
            type="email"
            inputMode="email"
            defaultValue={state.values?.contactEmail ?? defaultEmail ?? ""}
          />
          <TextField
            label="Teléfono"
            name="contactPhone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="8888-1234"
            hint={parsedPhone ? `Lo guardamos como ${parsedPhone.formatted}.` : undefined}
          />
        </div>
      </fieldset>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="declara"
          required
          className="mt-0.5 size-5 accent-(--color-brand)"
        />
        <span>
          Declaro que estos datos son verdaderos y que estoy inscrito como contribuyente ante el
          Ministerio de Hacienda.
        </span>
      </label>

      <FormMessage state={state} />
      <div>
        <SubmitButton size="lg" pendingLabel="Enviando su solicitud…">
          Enviar solicitud
        </SubmitButton>
      </div>
    </form>
  );
}

// ── Listings ────────────────────────────────────────────────────────────────

/** Price, sale state and handling time of one offer, edited in place. */
export function OfferForm({ listing }: { listing: SellerListing }) {
  const [state, action] = useActionState(updateOffer, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="offerId" value={listing.offer_id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Precio (₡, IVA incluido)"
          name="price"
          inputMode="decimal"
          defaultValue={state.values?.price ?? plainColones(listing.price_minor)}
        />
        <TextField
          label="Precio regular"
          name="listPrice"
          optional
          inputMode="decimal"
          defaultValue={
            state.values?.listPrice ??
            (listing.list_price_minor ? plainColones(listing.list_price_minor) : "")
          }
          hint="Solo si hay una rebaja real."
        />
        <SelectField
          label="Venta"
          name="status"
          defaultValue={
            state.values?.status ?? (listing.offer_status === "paused" ? "paused" : "active")
          }
        >
          <option value="active">A la venta</option>
          <option value="paused">En pausa</option>
        </SelectField>
        {listing.fulfillment === "seller" ? (
          <TextField
            label="Días para alistarlo"
            name="handlingDays"
            type="number"
            min={0}
            max={10}
            defaultValue={state.values?.handlingDays ?? String(listing.handling_days)}
          />
        ) : null}
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton size="sm" variant="secondary" pendingLabel="Guardando…">
          Guardar
        </SubmitButton>
      </div>
    </form>
  );
}

// ── Inventory ───────────────────────────────────────────────────────────────

export function StockForm({
  warehouseId,
  skuId,
  onHand,
  label,
}: {
  warehouseId: string;
  skuId: string;
  onHand: number;
  /** Read by screen readers so each row's field is told apart. */
  label: string;
}) {
  const [state, action] = useActionState(setStock, initial);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="warehouseId" value={warehouseId} />
      <input type="hidden" name="skuId" value={skuId} />
      <div className="flex items-end gap-2">
        <TextField
          label="Unidades que tiene"
          aria-label={`Unidades de ${label}`}
          name="quantity"
          type="number"
          min={0}
          max={100000}
          defaultValue={state.values?.quantity ?? String(onHand)}
          className="w-36"
        />
        <SubmitButton size="sm" variant="secondary" pendingLabel="…">
          Guardar
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function LocationForm({ districts }: { districts: District[] }) {
  const [state, action] = useActionState(saveLocation, initial);
  if (state.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="flex flex-col gap-5">
      <TextField
        label="Nombre del lugar"
        name="name"
        defaultValue={state.values?.name}
        placeholder="Local Heredia"
        maxLength={80}
      />
      <DistrictPicker districts={districts} />
      <TextAreaField
        label="Señas"
        name="address"
        rows={2}
        defaultValue={state.values?.address}
        placeholder="Heredia centro, 100 metros este del Mercado, local con rótulo verde"
        hint="Como se las daría a un mensajero. Incluya el horario si no es todo el día."
      />
      <PinPicker
        legend="Punto exacto de recolección"
        explanation="Es adonde llega nuestro repartidor a recoger sus paquetes."
        emptyHint="Si no está en el lugar, ábralo en Google Maps y copie el código Plus que aparece."
      />
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Guardando…">Guardar ubicación</SubmitButton>
      </div>
    </form>
  );
}

export function InboundForm({
  warehouses,
  products,
  minDate,
}: {
  warehouses: SellerLocations["platform"];
  products: Array<{ skuId: string; title: string; skuCode: string }>;
  minDate: string;
}) {
  const [state, action] = useActionState(createInbound, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Bodega de destino" name="warehouseId">
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name}
            </option>
          ))}
        </SelectField>
        <TextField label="¿Cuándo llega?" name="expectedOn" type="date" optional min={minDate} />
      </div>
      <fieldset>
        <legend className="text-sm font-semibold">Unidades que envía</legend>
        <ul className="mt-2 flex flex-col gap-2">
          {products.map((product) => (
            <li key={product.skuId} className="flex items-center justify-between gap-3">
              <label htmlFor={`qty-${product.skuId}`} className="text-sm">
                {product.title}
                <span className="block text-xs text-ink-muted">{product.skuCode}</span>
              </label>
              <input
                id={`qty-${product.skuId}`}
                name={`qty:${product.skuId}`}
                type="number"
                min={0}
                max={100000}
                placeholder="0"
                className="min-h-11 w-24 rounded-md border border-border-strong bg-surface px-3 text-right tabular-nums"
              />
            </li>
          ))}
        </ul>
      </fieldset>
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Registrando…">Registrar envío</SubmitButton>
      </div>
    </form>
  );
}

// ── Orders ──────────────────────────────────────────────────────────────────

export function PackForm({ parcel }: { parcel: SellerParcel }) {
  const [state, action] = useActionState(markPacked, initial);
  if (state.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="shipmentId" value={parcel.shipment_id} />
      <div className="flex flex-wrap items-end gap-3">
        <TextField
          label="Peso del paquete (gramos)"
          name="weightGrams"
          type="number"
          min={1}
          max={30000}
          defaultValue={state.values?.weightGrams}
          className="w-52"
        />
        <TextField
          label="Bultos"
          name="packageCount"
          type="number"
          min={1}
          max={20}
          defaultValue={state.values?.packageCount ?? "1"}
          className="w-24"
        />
        <SubmitButton pendingLabel="Guardando…">Ya está empacado</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
