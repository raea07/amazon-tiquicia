import { endSentence } from "@yuntera/core";
import type { StoreBuild, SystemHealth } from "@yuntera/db";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { buildCommit, fetchAppVersion } from "@yuntera/next-kit/version";
import { Alert, Badge, formatDate, formatDateTime, Skeleton, touchLinkClass } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { removeStoreBuild } from "@/app/health-actions";
import { CatalogueForm, CatalogueOutcome } from "@/components/catalogue-outcome";
import { StoreBuildForm } from "@/components/store-build-form";
import {
  healthSentence,
  jobSentence,
  noHistory,
  STATE_LABEL,
  STORE_APP_LABEL,
  STORE_PLATFORM_LABEL,
  STORE_TRACK_LABEL,
} from "@/lib/health-labels";
import { plural } from "@/lib/operations-labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Salud del sistema" };

export default function SystemHealthPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Salud del sistema">
        Lo que puede estar fallando sin que nadie lo note todavía. Cada línea dice qué pasa y dónde
        se arregla. Usted ve las comprobaciones de su función.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Health />
        </Suspense>
      </div>
    </div>
  );
}

async function Health() {
  const staff = await requireStaff("/salud", ["support", "ops", "finance"]);
  const health = await (await sessionApi()).opsSystemHealth();
  const needing = health.lines.filter(
    (line) => line.state === "problem" || line.state === "attention",
  );
  const unknown = health.lines.filter((line) => line.state === "unknown");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        {needing.length === 0 ? (
          <Alert tone="success" title="Todo en orden en lo que se puede comprobar">
            {unknown.length > 0
              ? `${plural(unknown.length, "comprobación no tiene", "comprobaciones no tienen")} datos todavía: se dice abajo cuáles.`
              : "Ninguna comprobación encontró un problema."}
          </Alert>
        ) : (
          <Alert
            tone="danger"
            title={`${plural(needing.length, "comprobación necesita", "comprobaciones necesitan")} atención`}
          >
            {needing.length === 1
              ? "Aparece primero en la lista, con el lugar donde se arregla."
              : "Aparecen primero en la lista, con el lugar donde se arreglan."}
          </Alert>
        )}
        <p className="text-sm text-ink-muted">
          Comprobado el {endSentence(formatDateTime(health.checked_at))}{" "}
          <Link href="/salud" className={touchLinkClass()}>
            Comprobar de nuevo
          </Link>
        </p>
      </div>

      <section aria-labelledby="comprobaciones">
        <h2 id="comprobaciones" className="text-xl font-bold">
          Comprobaciones
        </h2>
        <ul className="mt-3 flex flex-col gap-2">
          {[...needing, ...unknown, ...health.lines.filter((line) => line.state === "ok")].map(
            (line) => {
              const said = healthSentence(line);
              const state = STATE_LABEL[line.state];
              return (
                <li
                  key={line.key}
                  data-health={line.key}
                  data-state={line.state}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={state.tone}>{state.label}</Badge>
                    <h3 className="text-base font-bold">{said.title}</h3>
                  </div>
                  <p>{said.text}</p>
                  {said.orders.length > 0 ? (
                    <p className="flex flex-wrap gap-x-4">
                      {said.orders.map((number) => (
                        <Link
                          key={number}
                          href={`/pedidos/${number}` as Route}
                          className={touchLinkClass()}
                        >
                          Pedido {number}
                        </Link>
                      ))}
                    </p>
                  ) : null}
                  {said.href ? (
                    <p>
                      <Link href={said.href} className={touchLinkClass()}>
                        {said.linkLabel}
                      </Link>
                    </p>
                  ) : null}
                </li>
              );
            },
          )}
        </ul>
        {health.lines.length === 0 ? (
          <p className="mt-3 text-ink-muted">Su función no tiene comprobaciones en esta página.</p>
        ) : null}
      </section>

      {health.jobs ? <Jobs jobs={health.jobs} /> : null}

      {staff.staff_role === "admin" ? (
        <Suspense fallback={<Skeleton className="h-64" />}>
          <Versions />
        </Suspense>
      ) : null}
    </div>
  );
}

function Jobs({ jobs }: { jobs: NonNullable<SystemHealth["jobs"]> }) {
  const missing = noHistory(jobs);
  return (
    <section aria-labelledby="tareas">
      <h2 id="tareas" className="text-xl font-bold">
        Tareas programadas
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-muted">
        Trabajos que la base de datos corre sola, cada cierto tiempo. Si una deja de correr, nadie
        recibe un aviso: por eso se revisan aquí.
      </p>
      {missing ? (
        <Alert tone="info" title="Sin historial de tareas" className="mt-3">
          {missing}
        </Alert>
      ) : null}
      <ul className="mt-3 flex flex-col gap-2" data-jobs={jobs.history}>
        {jobs.items.map((job) => {
          const state = STATE_LABEL[job.state];
          return (
            <li
              key={job.name}
              data-job={job.name}
              data-state={job.state}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3 text-sm"
            >
              <Badge tone={state.tone}>{state.label}</Badge>
              <span>{jobSentence(job)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const WEB_APPS = [
  { id: "web", name: "Tienda", url: () => process.env.NEXT_PUBLIC_SHOP_URL },
  {
    id: "seller",
    name: "Centro de vendedores",
    url: () => process.env.YUNTERA_SELLER_URL,
  },
  {
    id: "field",
    name: "Ruta y bodega (web)",
    url: () => process.env.YUNTERA_FIELD_URL,
  },
] as const;

async function Versions() {
  const [versions, ...others] = await Promise.all([
    (await sessionApi()).opsVersions(),
    ...WEB_APPS.map((app) => fetchAppVersion(app.url(), process.env)),
  ]);
  const own = buildCommit(process.env);
  const web = [
    {
      id: "ops",
      name: "Consola (esta)",
      version: own ? { state: "known" as const, commit: own } : { state: "unknown" as const },
    },
    ...WEB_APPS.map((app, i) => ({
      id: app.id,
      name: app.name,
      version: others[i] ?? { state: "unknown" as const },
    })),
  ];
  const latest = new Map<string, StoreBuild>();
  for (const build of versions.store_builds) {
    const key = `${build.app}/${build.platform}`;
    const seen = latest.get(key);
    if (!seen || build.released_on > seen.released_on) latest.set(key, build);
  }

  return (
    <CatalogueOutcome>
      <section aria-labelledby="versiones" className="flex flex-col gap-6">
        <div>
          <h2 id="versiones" className="text-xl font-bold">
            Versiones
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Qué versión corre cada parte. Sirve para saber si un arreglo ya llegó y para describir
            un problema encontrado.
          </p>
        </div>

        <div>
          <h3 className="text-base font-bold">Sitios web</h3>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {web.map((app) => (
              <li
                key={app.id}
                data-version={app.id}
                className="flex flex-wrap gap-x-2 rounded-lg border border-border bg-surface p-3"
              >
                <span className="font-semibold">{app.name}:</span>
                <span className="break-all">
                  {app.version.state === "known"
                    ? `versión ${app.version.commit.slice(0, 7)}`
                    : app.version.state === "not_configured"
                      ? "falta configurar su dirección en la consola."
                      : app.version.state === "unreachable"
                        ? "no respondió. Revise que el sitio esté en línea."
                        : "el despliegue no indicó de qué versión es."}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-base font-bold">Base de datos</h3>
          <p
            className="mt-2 rounded-lg border border-border bg-surface p-3 text-sm"
            data-version="database"
          >
            {versions.migration
              ? `Último cambio aplicado: ${versions.migration.version}${versions.migration.name ? ` (${versions.migration.name})` : ""}, ${plural(versions.migration.count, "cambio", "cambios")} en total.`
              : "Esta base de datos no registra los cambios aplicados, así que no se puede decir cuál es el último."}
          </p>
        </div>

        <div>
          <h3 className="text-base font-bold">Aplicaciones en las tiendas</h3>
          {latest.size === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">
              Todavía no se registró ninguna versión. Regístrela abajo cada vez que una salga a
              prueba o al público.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2 text-sm">
              {[...latest.values()].map((build) => (
                <li
                  key={build.id}
                  data-store-build={`${build.app}/${build.platform}`}
                  className="rounded-lg border border-border bg-surface p-3"
                >
                  <span className="font-semibold">
                    {STORE_APP_LABEL[build.app]} para {STORE_PLATFORM_LABEL[build.platform]}:
                  </span>{" "}
                  versión {build.version} ({build.build_number}),{" "}
                  {STORE_TRACK_LABEL[build.track].toLowerCase()} desde el{" "}
                  {formatDate(build.released_on, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                  .
                  <RemoveBuild build={build} />
                </li>
              ))}
            </ul>
          )}
          {versions.store_builds.length > latest.size ? (
            <details className="mt-2 text-sm">
              <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
                Ver las versiones anteriores
              </summary>
              <ul className="mt-1 flex flex-col gap-1">
                {versions.store_builds
                  .filter((build) => latest.get(`${build.app}/${build.platform}`)?.id !== build.id)
                  .map((build) => (
                    <li key={build.id} data-store-build-old={`${build.app}/${build.platform}`}>
                      {STORE_APP_LABEL[build.app]}, {STORE_PLATFORM_LABEL[build.platform]}:{" "}
                      {build.version} ({build.build_number}),{" "}
                      {STORE_TRACK_LABEL[build.track].toLowerCase()},{" "}
                      {formatDate(build.released_on, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      <RemoveBuild build={build} />
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
        </div>

        <div className="max-w-xl">
          <h3 className="text-base font-bold">Registrar una versión de una aplicación</h3>
          <p className="mt-1 text-sm text-ink-muted">
            Copie los datos de la consola de la tienda (App Store Connect o Google Play Console). Si
            la misma versión ya está registrada, se actualizan el día y dónde está. Si registró una
            con un error, quítela en la lista de arriba.
          </p>
          <div className="mt-3 rounded-lg border border-border bg-surface p-5">
            <StoreBuildForm today={todayInCostaRica()} />
          </div>
        </div>
      </section>
    </CatalogueOutcome>
  );
}

/** Removes a build typed wrong, behind a second step so it is not done by a slip. */
function RemoveBuild({ build }: { build: StoreBuild }) {
  return (
    <details className="mt-1">
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
        Quitar esta versión
      </summary>
      <div className="mt-2">
        <CatalogueForm
          action={removeStoreBuild}
          submit={`Quitar ${build.version} (${build.build_number})`}
          variant="danger"
          size="sm"
        >
          <input type="hidden" name="id" value={build.id} />
          <p className="text-ink-muted">
            Úselo cuando la versión se registró con un error. Deja de aparecer aquí y queda en el
            registro de auditoría. Si era correcta, regístrela de nuevo.
          </p>
        </CatalogueForm>
      </div>
    </details>
  );
}

function todayInCostaRica(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
  }).format(new Date());
}
