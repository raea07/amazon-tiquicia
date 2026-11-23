import { ApiError, type DistrictMoveImpact, type OpsCantonDistricts } from "@yuntera/db";
import { messageOf, sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Alert, Badge, buttonClass, SelectField, Skeleton } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { moveDistricts } from "@/app/operations-actions";
import { CatalogueForm, CatalogueOutcome } from "@/components/catalogue-outcome";
import { OperationsNav } from "@/components/operations-nav";
import { plural } from "@/lib/operations-labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Distritos" };

export default function DistrictsPage({ searchParams }: PageProps<"/operacion/distritos">) {
  return (
    <div className="shell py-8">
      <CatalogueOutcome>
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Districts searchParams={searchParams} />
        </Suspense>
      </CatalogueOutcome>
    </div>
  );
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const many = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value : value ? [value] : []).filter((code) => /^[1-7]\d{4}$/.test(code));
const NOT_SERVED = "none";

async function Districts({
  searchParams,
}: Pick<PageProps<"/operacion/distritos">, "searchParams">) {
  const staff = await requireStaff("/operacion/distritos", ["ops"]);
  const params = await searchParams;
  const cantonCode = (one(params.canton) ?? "").replace(/\D/g, "").slice(0, 3);
  const chosen = many(params.distrito).slice(0, 60);
  const target = (one(params.destino) ?? "").slice(0, 30);
  // "Revisar el cambio" was pressed (the canton form alone does not send it).
  const reviewing = one(params.revisar) === "1";

  const api = await sessionApi();
  const [cantons, zones] = await Promise.all([api.opsDistrictCantons(), api.opsDeliveryZones()]);
  let canton: OpsCantonDistricts | null = null;
  let problem: string | null = null;
  if (cantonCode) {
    try {
      canton = await api.opsCantonDistricts(cantonCode);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      problem = messageOf(error);
    }
  }
  let preview: DistrictMoveImpact | null = null;
  if (canton && chosen.length > 0 && target) {
    try {
      preview = await api.opsDistrictMovePreview(chosen, target === NOT_SERVED ? null : target);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      problem = messageOf(error);
    }
  }
  if (canton && reviewing && !problem && (chosen.length === 0 || !target)) {
    problem =
      chosen.length === 0 && !target
        ? "Elija al menos un distrito y a qué zona pasan, y vuelva a revisar el cambio."
        : chosen.length === 0
          ? "Elija al menos un distrito y vuelva a revisar el cambio."
          : "Elija a qué zona pasan los distritos elegidos, o «No se entrega por ahora», y vuelva a revisar el cambio.";
  }
  const provinces = [...new Set(cantons.map((c) => c.province))];

  return (
    <>
      <OperationsNav current="/operacion/distritos" admin={staff.staff_role === "admin"} />
      <PageHeader title="Distritos">
        Los distritos del país no se crean ni se renombran aquí. Lo que se decide es a qué zona de
        entrega pertenece cada uno, o si por ahora no se entrega. Antes de confirmar se ve cuántas
        direcciones guardadas y pedidos abiertos toca el cambio.
      </PageHeader>

      <form method="get" className="mt-6 flex max-w-xl flex-wrap items-end gap-3">
        <SelectField
          label="Cantón"
          name="canton"
          defaultValue={canton?.code ?? ""}
          className="min-w-0 flex-1"
        >
          <option value="" disabled>
            Elija…
          </option>
          {provinces.map((province) => (
            <optgroup key={province} label={province}>
              {cantons
                .filter((c) => c.province === province)
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({c.served_count} de {c.district_count} con entrega)
                  </option>
                ))}
            </optgroup>
          ))}
        </SelectField>
        <button type="submit" className={buttonClass({ variant: "secondary" })}>
          Ver sus distritos
        </button>
      </form>

      {problem ? (
        <Alert tone="warning" className="mt-6 max-w-xl">
          {problem}
        </Alert>
      ) : null}

      {preview && canton ? (
        <Preview preview={preview} canton={canton.code} chosen={chosen} target={target} />
      ) : null}

      {canton ? (
        <section aria-labelledby="distritos" className="mt-8">
          <h2 id="distritos" className="text-xl font-bold">
            {canton.name}, {canton.province} ({plural(canton.districts.length, "distrito", "distritos")})
          </h2>
          <form method="get" className="mt-3 flex flex-col gap-4">
            <input type="hidden" name="canton" value={canton.code} />
            <input type="hidden" name="revisar" value="1" />
            <fieldset>
              <legend className="text-sm font-semibold">
                Elija los distritos que cambian (puede elegir todos los del cantón)
              </legend>
              <ul className="mt-2 grid gap-2 md:grid-cols-2">
                {canton.districts.map((district) => (
                  <li key={district.postal_code} data-district={district.postal_code}>
                    <label className="flex min-h-11 items-start gap-3 rounded-md border border-border bg-surface p-3 text-sm">
                      <input
                        type="checkbox"
                        name="distrito"
                        value={district.postal_code}
                        defaultChecked={chosen.includes(district.postal_code)}
                        className="mt-0.5 size-5 accent-(--color-brand)"
                      />
                      <span className="min-w-0">
                        <span className="block font-semibold">
                          {district.name}{" "}
                          <span className="font-normal text-ink-muted">
                            · {district.postal_code}
                          </span>
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-2">
                          {district.served ? (
                            <Badge tone={district.zone_active ? "success" : "warning"}>
                              {district.zone_name}
                              {district.zone_active ? "" : " (apagada)"}
                            </Badge>
                          ) : (
                            <Badge tone="warning">No se entrega</Badge>
                          )}
                          <span className="text-ink-muted">
                            {plural(district.saved_address_count, "dirección", "direcciones")} ·{" "}
                            {plural(
                              district.open_order_count,
                              "pedido abierto",
                              "pedidos abiertos",
                            )}
                          </span>
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            <div className="flex max-w-xl flex-wrap items-end gap-3">
              <SelectField
                label="Pasan a"
                name="destino"
                defaultValue={target}
                className="min-w-0 flex-1"
              >
                <option value="" disabled>
                  Elija…
                </option>
                {zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                    {zone.active ? "" : " (apagada)"}
                  </option>
                ))}
                <option value={NOT_SERVED}>No se entrega por ahora</option>
              </SelectField>
              <button type="submit" className={buttonClass({ variant: "secondary" })}>
                Revisar el cambio
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}

function Preview({
  preview,
  canton,
  chosen,
  target,
}: {
  preview: DistrictMoveImpact;
  canton: string;
  chosen: string[];
  target: string;
}) {
  const where = preview.target ? `a «${preview.target.name}»` : "a «No se entrega»";
  return (
    <section
      aria-labelledby="revisar"
      className="mt-6 max-w-2xl rounded-lg border-2 border-brand bg-surface p-5 text-sm"
    >
      <h2 id="revisar" className="text-lg font-bold">
        Antes de confirmar
      </h2>
      {preview.changing_count > 0 && preview.nothing_served_after ? (
        <p className="mt-2 font-semibold text-danger">
          Con este cambio ninguna zona encendida tendría distritos con entrega y nadie podría hacer
          pedidos, así que no se puede hacer. Deje al menos un distrito con entrega en una zona
          encendida.{" "}
          <Link
            href={`/operacion/distritos?canton=${canton}` as Route}
            className="text-link underline"
          >
            Volver a elegir
          </Link>
        </p>
      ) : preview.changing_count === 0 ? (
        <p className="mt-2">
          Los distritos elegidos ya están así. No hay nada que cambiar.{" "}
          <Link
            href={`/operacion/distritos?canton=${canton}` as Route}
            className="text-link underline"
          >
            Volver a elegir
          </Link>
        </p>
      ) : (
        <>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              {preview.changing_count}{" "}
              {preview.changing_count === 1 ? "distrito pasa" : "distritos pasan"} {where}
              {preview.district_count > preview.changing_count
                ? ` (${preview.district_count - preview.changing_count} ya estaban así)`
                : ""}
              .
            </li>
            <li>
              Direcciones guardadas: {preview.saved_address_count}.{" "}
              {preview.target
                ? preview.target.active
                  ? "Sus próximos pedidos usan el envío y la fecha de la nueva zona."
                  : "La nueva zona está apagada, así que no se podrán elegir al pagar hasta encenderla."
                : "Siguen guardadas, pero no se pueden elegir al pagar mientras no se entregue ahí."}
            </li>
            <li>
              Pedidos abiertos: {preview.open_order_count}. No cambian: se entregan como se
              prometió.
            </li>
            {preview.zones_left_empty.map((zone) => (
              <li key={zone.id} className="font-semibold text-warning">
                La zona «{zone.name}» queda sin distritos: nadie podrá pedir a ella.
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-start gap-3">
            <CatalogueForm
              action={moveDistricts}
              submit="Confirmar el cambio"
              variant={preview.target ? "primary" : "danger"}
              pendingLabel="Guardando…"
            >
              <input type="hidden" name="canton" value={canton} />
              <input type="hidden" name="zoneId" value={target} />
              {chosen.map((code) => (
                <input key={code} type="hidden" name="postalCode" value={code} />
              ))}
            </CatalogueForm>
            <Link
              href={`/operacion/distritos?canton=${canton}` as Route}
              className={buttonClass({ variant: "ghost" })}
            >
              Cancelar
            </Link>
          </div>
          <p className="mt-3 text-ink-muted">
            Para deshacerlo, elija los mismos distritos y la zona en la que estaban.
          </p>
        </>
      )}
    </section>
  );
}
