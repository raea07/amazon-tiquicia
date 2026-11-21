import "server-only";
import { messageFor } from "@yuntera/db";
import { Alert, buttonClass, Skeleton } from "@yuntera/ui";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { isLinkType, isTokenHash } from "../auth-rules";
import {
  ChangePasswordForm,
  ConfirmLinkForm,
  DeleteAccountForm,
  EnrolFactor,
  NewPasswordForm,
  RecoveryForm,
  RemoveFactorForm,
  SecondFactorBadge,
  SecondFactorForm,
} from "../client/account-forms";
import { safeReturnPath, signInPath } from "../paths";
import { getSecurity } from "../server/account";
import { redirectTo, requireViewer } from "../server/session";
import { sessionApi } from "../server/supabase";

/**
 * The account-security pages every app shows the same way. Each app's route
 * file renders one of these (see apps/<app>/src/app/recuperar/page.tsx and the
 * others). Anything that reads the session or the address sits inside
 * <Suspense>, as Cache Components require.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type SignOut = () => Promise<void>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The narrow card the sign-in pages use. */
function AuthCard({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="shell flex justify-center py-10">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-sm">
        <h1 className="text-2xl font-bold">{title}</h1>
        {intro ? (
          <div className="mt-1 mb-5 text-sm text-ink-muted">{intro}</div>
        ) : (
          <div className="mb-5" />
        )}
        {children}
      </div>
    </div>
  );
}

function SignOutButton({ signOut, label = "Salir" }: { signOut: SignOut; label?: string }) {
  return (
    <form action={signOut} className="mt-5 border-t border-border pt-4">
      <button type="submit" className={buttonClass({ variant: "ghost", size: "sm" })}>
        {label}
      </button>
    </form>
  );
}

// ── Password reset ──────────────────────────────────────────────────────────

export function RecoveryPage() {
  return (
    <AuthCard
      title="Restablecer su contraseña"
      intro="Escriba el correo con el que ingresa. Le enviaremos un enlace y un código para elegir una contraseña nueva."
    >
      <RecoveryForm />
      <p className="mt-5 border-t border-border pt-4 text-sm">
        ¿Se acordó?{" "}
        <Link href="/ingresar" className="font-semibold text-link underline">
          Volver a ingresar
        </Link>
      </p>
    </AuthCard>
  );
}

export function NewPasswordPage({ home = "/" }: { home?: string }) {
  return (
    <AuthCard title="Elija una contraseña nueva">
      <Suspense fallback={<Skeleton className="h-64" />}>
        <NewPassword home={home} />
      </Suspense>
    </AuthCard>
  );
}

async function NewPassword({ home }: { home: string }) {
  const security = await getSecurity();
  if (!security) {
    return (
      <Alert tone="danger" title="El enlace ya no sirve">
        <p>Venció o ya se usó. Pida un correo nuevo para restablecer su contraseña.</p>
        <p className="mt-2">
          <Link href="/recuperar" className="font-semibold underline">
            Pedir otro correo
          </Link>
        </p>
      </Alert>
    );
  }
  return (
    <NewPasswordForm
      needsCode={Boolean(security.factorId) && security.aal !== "aal2"}
      home={home}
    />
  );
}

// ── E-mail links ────────────────────────────────────────────────────────────

const LINK_COPY: Record<string, { title: string; intro: string; button: string }> = {
  recovery: {
    title: "Restablecer su contraseña",
    intro: "Pulse el botón para continuar y elegir una contraseña nueva.",
    button: "Continuar",
  },
  email_change: {
    title: "Confirmar su nuevo correo",
    intro: "Pulse el botón para empezar a usar la dirección nueva en su cuenta.",
    button: "Confirmar el cambio",
  },
  default: {
    title: "Confirmar su correo",
    intro: "Pulse el botón para confirmar su correo y entrar a su cuenta.",
    button: "Confirmar mi correo",
  },
};

/**
 * Where every e-mail link lands (`/auth/confirm?token_hash=…&type=…`). The
 * page only shows a button; the token is checked when it is pressed, on the
 * server, which then sets the session cookie. Opening the link — as mail
 * scanners do — uses nothing up.
 */
export function ConfirmLinkPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense
      fallback={
        <div className="shell flex justify-center py-10">
          <Skeleton className="h-64 w-full max-w-md" />
        </div>
      }
    >
      <ConfirmLink searchParams={searchParams} />
    </Suspense>
  );
}

async function ConfirmLink({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const tokenHash = one(query.token_hash);
  const type = one(query.type);
  const copy = (isLinkType(type) && LINK_COPY[type]) || LINK_COPY.default;
  if (!copy) return null;
  if (!isTokenHash(tokenHash) || !isLinkType(type)) {
    return (
      <AuthCard title="Este enlace no está completo">
        <Alert tone="danger">
          <p>
            Puede que se haya cortado al copiarlo. Ábralo de nuevo desde el correo, o pida uno
            nuevo.
          </p>
          <p className="mt-2">
            <Link href="/recuperar" className="font-semibold underline">
              Restablecer la contraseña
            </Link>{" "}
            ·{" "}
            <Link href="/ingresar" className="font-semibold underline">
              Ingresar
            </Link>
          </p>
        </Alert>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={copy.title} intro={copy.intro}>
      <ConfirmLinkForm tokenHash={tokenHash} type={type} button={copy.button} />
    </AuthCard>
  );
}

// ── Second factor ───────────────────────────────────────────────────────────

/** The second step after the password. Nothing else is reachable from here but signing out. */
export function VerifyPage({
  searchParams,
  signOut,
}: {
  searchParams: SearchParams;
  signOut: SignOut;
}) {
  return (
    <AuthCard
      title="Verificación en dos pasos"
      intro="Su cuenta está protegida con una aplicación de autenticación."
    >
      <Suspense fallback={<Skeleton className="h-40" />}>
        <Verify searchParams={searchParams} />
      </Suspense>
      <SignOutButton signOut={signOut} label="Salir e ingresar con otra cuenta" />
    </AuthCard>
  );
}

async function Verify({ searchParams }: { searchParams: SearchParams }) {
  const returnTo = safeReturnPath(one((await searchParams).siguiente));
  const security = await getSecurity();
  if (!security) redirectTo(signInPath(returnTo));
  if (security.aal === "aal2" || !security.factorId) redirectTo(returnTo);
  return (
    <>
      <SecondFactorForm returnTo={returnTo} />
      <p className="mt-4 text-sm text-ink-muted">
        ¿Perdió el teléfono o la aplicación? Pida a una persona administradora de Yuntera que
        reinicie su verificación; después podrá configurarla de nuevo.
      </p>
    </>
  );
}

/** Turning the second factor on, or managing it once it is on. */
export function SecondFactorPage({
  searchParams,
  signOut,
}: {
  searchParams: SearchParams;
  signOut: SignOut;
}) {
  return (
    <AuthCard
      title="Verificación en dos pasos"
      intro="Además de la contraseña, al ingresar le pediremos un código que cambia cada 30 segundos en una aplicación de su teléfono. Así, una contraseña robada no basta para entrar."
    >
      <Suspense fallback={<Skeleton className="h-64" />}>
        <SecondFactor searchParams={searchParams} />
      </Suspense>
      <SignOutButton signOut={signOut} />
    </AuthCard>
  );
}

async function SecondFactor({ searchParams }: { searchParams: SearchParams }) {
  const next = one((await searchParams).siguiente);
  const security = await getSecurity();
  if (!security) redirectTo(signInPath("/dos-pasos"));
  if (security.factorId && security.aal !== "aal2") {
    redirectTo(`/verificar?siguiente=${encodeURIComponent("/dos-pasos")}`);
  }
  if (security.factorId) {
    return (
      <div className="flex flex-col gap-4">
        <p className="flex items-center gap-2 text-sm">
          Estado: <SecondFactorBadge active />
        </p>
        <RemoveFactorForm />
        {security.mfaRequired ? (
          <p className="text-sm text-ink-muted">
            Su puesto exige la verificación: si la quita, tendrá que configurarla de nuevo antes de
            seguir usando la consola.
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {security.mfaRequired ? (
        <Alert tone="warning" title="Su puesto requiere este paso">
          Para usar la consola interna, configure ahora la verificación en dos pasos. Toma un
          minuto.
        </Alert>
      ) : null}
      <EnrolFactor returnTo={next ? safeReturnPath(next) : undefined} />
    </div>
  );
}

// ── The account page's security section ─────────────────────────────────────

/**
 * Password change, the second factor (where `secondFactor` is offered) and the
 * way to delete the account, for an app's account page.
 */
export function AccountSecuritySection({ secondFactor = false }: { secondFactor?: boolean }) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <AccountSecurity secondFactor={secondFactor} />
    </Suspense>
  );
}

async function AccountSecurity({ secondFactor }: { secondFactor: boolean }) {
  const security = secondFactor ? await getSecurity() : null;
  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="contrasena"
        className="rounded-lg border border-border bg-surface p-5"
      >
        <h2 id="contrasena" className="text-lg font-bold">
          Contraseña
        </h2>
        <p className="mt-1 mb-4 text-sm text-ink-muted">
          Al cambiarla, cerramos las demás sesiones abiertas de su cuenta.
        </p>
        <ChangePasswordForm />
      </section>

      {secondFactor ? (
        <section
          aria-labelledby="dos-pasos"
          className="rounded-lg border border-border bg-surface p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="dos-pasos" className="text-lg font-bold">
              Verificación en dos pasos
            </h2>
            <SecondFactorBadge active={Boolean(security?.factorId)} />
          </div>
          <p className="mt-1 mb-4 text-sm text-ink-muted">
            {security?.factorId
              ? "Al ingresar le pedimos un código de su aplicación de autenticación."
              : "Proteja su cuenta con un código de una aplicación de su teléfono, además de la contraseña."}
          </p>
          <Link href={"/dos-pasos" as never} className={buttonClass({ variant: "secondary" })}>
            {security?.factorId ? "Administrar la verificación" : "Activar la verificación"}
          </Link>
        </section>
      ) : null}

      <section
        aria-labelledby="eliminar"
        className="rounded-lg border border-border bg-surface p-5"
      >
        <h2 id="eliminar" className="text-lg font-bold">
          Eliminar su cuenta
        </h2>
        <p className="mt-1 mb-4 text-sm text-ink-muted">
          Borra sus datos personales de Yuntera. Antes de hacerlo le explicamos qué se borra y qué
          debemos conservar por ley.
        </p>
        <Link href="/cuenta/eliminar" className={buttonClass({ variant: "ghost" })}>
          Eliminar mi cuenta
        </Link>
      </section>
    </div>
  );
}

// ── Account deletion ────────────────────────────────────────────────────────

/** What deleting an account erases and what the law makes Yuntera keep. Also on the public page. */
export function DeletionTerms() {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div>
        <h2 className="text-base font-bold">Qué borramos</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Su nombre, teléfono y correo, y la contraseña: ya no podrá ingresar.</li>
          <li>Sus direcciones de entrega y la ubicación marcada en el mapa.</li>
          <li>Sus consentimientos y preferencias de comunicación.</li>
          <li>
            En sus pedidos anteriores, el nombre, el teléfono y las señas de entrega; la ubicación
            queda solo aproximada (cerca de un kilómetro).
          </li>
          <li>Su verificación en dos pasos y todas sus sesiones abiertas.</li>
          <li>Su nombre en las reseñas que escribió: quedan publicadas como «Cliente».</li>
        </ul>
      </div>
      <div>
        <h2 className="text-base font-bold">Qué conservamos y por qué</h2>
        <p className="mt-2">
          Los pedidos, sus pagos, los comprobantes electrónicos y los registros contables se
          conservan durante el plazo que exige la ley tributaria (cinco años para los comprobantes
          electrónicos), porque Yuntera y los vendedores deben poder demostrar cada venta ante
          Hacienda. Quedan sin su nombre ni sus datos de contacto: ya no se pueden relacionar con
          usted. Guardamos además que hubo una eliminación, con la fecha, sin datos de quién fue.
        </p>
      </div>
      <div>
        <h2 className="text-base font-bold">Después</h2>
        <p className="mt-2">
          La eliminación es inmediata y no se puede deshacer. Si más adelante quiere volver, puede
          crear una cuenta nueva con el mismo correo; empezará desde cero.
        </p>
      </div>
    </div>
  );
}

export function DeleteAccountPage() {
  return (
    <div className="shell flex justify-center py-10">
      <div className="w-full max-w-2xl rounded-lg border border-border bg-surface p-6 shadow-sm">
        <h1 className="text-2xl font-bold">Eliminar su cuenta</h1>
        <div className="mt-5">
          <Suspense fallback={<Skeleton className="h-96" />}>
            <DeleteAccount />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

async function DeleteAccount() {
  await requireViewer("/cuenta/eliminar");
  const check = await (await sessionApi()).accountDeletionCheck();
  return (
    <div className="flex flex-col gap-6">
      <DeletionTerms />
      {check.blockers.length > 0 ? (
        <Alert tone="warning" title="Todavía no podemos eliminar su cuenta">
          <ul className="list-disc space-y-1 pl-5">
            {check.blockers.map((code) => (
              <li key={code}>{messageFor(code)}</li>
            ))}
          </ul>
          <p className="mt-2">Cuando se resuelva, vuelva a esta página.</p>
        </Alert>
      ) : (
        <section aria-labelledby="confirmar" className="border-t border-border pt-5">
          <h2 id="confirmar" className="text-base font-bold">
            Confirmar
          </h2>
          <p className="mt-1 mb-4 text-sm text-ink-muted">
            {check.orders_kept > 0
              ? `Conservaremos ${check.orders_kept} ${check.orders_kept === 1 ? "pedido" : "pedidos"} sin sus datos, como se explica arriba.`
              : "No tiene pedidos que debamos conservar."}
          </p>
          <DeleteAccountForm />
        </section>
      )}
      <Link href="/cuenta" className={buttonClass({ variant: "secondary" })}>
        Volver a su cuenta sin eliminarla
      </Link>
    </div>
  );
}

/** Shown once the account is gone. Needs no session. */
export function AccountDeletedPage({ home = "/" }: { home?: string }) {
  return (
    <AuthCard title="Su cuenta fue eliminada">
      <div className="flex flex-col gap-4 text-sm">
        <p>
          Borramos sus datos personales y cerramos todas sus sesiones. Los pedidos y comprobantes
          que la ley nos obliga a guardar quedaron sin su nombre ni sus datos de contacto.
        </p>
        <p>
          Si quiere volver, puede crear una cuenta nueva con cualquier correo, también el mismo.
        </p>
        <Link href={home as never} className={buttonClass({ block: true })}>
          Ir al inicio
        </Link>
      </div>
    </AuthCard>
  );
}
