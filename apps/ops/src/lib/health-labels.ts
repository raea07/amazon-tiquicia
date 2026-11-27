import { apps } from "@yuntera/brand";
import type {
  HealthJob,
  HealthLine,
  HealthState,
  StoreApp,
  StorePlatform,
  StoreTrack,
  SystemHealth,
} from "@yuntera/db";
import { formatDate, formatDateTime, type Tone } from "@yuntera/ui";
import type { Route } from "next";
import { plural } from "@/lib/operations-labels";

/**
 * The words of the system health page (Salud del sistema). The database
 * decides each line's state and gives its counts and limits
 * (20261121084800_system_health.sql); this file only says them. No line
 * names a person: counts, order numbers and route codes only.
 */

/** Said in words next to the colour, so the state is never colour alone. */
export const STATE_LABEL: Record<HealthState, { label: string; tone: Tone }> = {
  ok: { label: "Bien", tone: "success" },
  attention: { label: "Revisar", tone: "warning" },
  problem: { label: "Problema", tone: "danger" },
  unknown: { label: "Sin datos", tone: "neutral" },
};

export interface HealthSentence {
  title: string;
  text: string;
  /** Where it is fixed, when there is such a page. */
  href: Route | null;
  linkLabel: string | null;
  /** Orders the line is about, each to its page. */
  orders: string[];
}

const at = (value: string | null) => (value ? formatDateTime(value) : "");
const day = (value: string | null) =>
  value ? formatDate(value, { day: "numeric", month: "long", year: "numeric" }) : "";
const part = (line: HealthLine, name: string) => line.parts[name] ?? 0;
const hours = (minutes: number | null) =>
  minutes && minutes % 60 === 0 ? plural(minutes / 60, "hora", "horas") : `${minutes} minutos`;

const CHANNEL: Record<string, string> = {
  email: "El correo",
  whatsapp: "WhatsApp",
  sms: "Los mensajes de texto",
  push: "Las notificaciones de las aplicaciones",
};

// Not the same words as the lines above them ("Envío de avisos", "Procesador
// de pagos"): a job and the check of what it moves are different things.
export const JOB_LABEL: Record<string, string> = {
  "notify-sweep": "Revisión periódica de avisos",
  "invoice-sweep": "Revisión periódica de comprobantes",
  "payments-sweep": "Revisión periódica de pagos",
  "expire-unpaid-orders": "Vencimiento de pedidos sin pagar",
  "auth-attempts-cleanup": "Limpieza de intentos de ingreso",
  "refresh-product-signals": "Ventas recientes de los productos",
  "cron-history-cleanup": "Limpieza del historial de tareas",
};

function every(seconds: number): string {
  if (seconds < 60) return `cada ${seconds} segundos`;
  if (seconds === 60) return "cada minuto";
  if (seconds < 3600) return `cada ${seconds / 60} minutos`;
  if (seconds === 3600) return "cada hora";
  if (seconds === 86_400) return "una vez al día";
  if (seconds === 604_800) return "una vez por semana";
  return `cada ${Math.round(seconds / 3600)} horas`;
}

/** One scheduled job, in a sentence. */
export function jobSentence(job: HealthJob): string {
  const name = `${JOB_LABEL[job.name] ?? job.name} (${every(job.every_seconds)})`;
  switch (job.reason) {
    case "on_time":
      return job.last_status === "running"
        ? `${name}: está corriendo desde ${at(job.last_run_at)}.`
        : `${name}: corrió a tiempo por última vez el ${at(job.last_run_at)}.`;
    case "late":
      return `${name}: no corre desde el ${at(job.last_run_at)}.`;
    case "failed":
      return `${name}: falló la última vez, el ${at(job.last_run_at)}.`;
    case "inactive":
      return `${name}: está apagada en el programador.`;
    case "not_scheduled":
      return `${name}: no está programada.`;
    case "never_ran":
      return `${name}: todavía no ha corrido.`;
    case "no_history":
      return `${name}: sin historial en esta base de datos.`;
    default:
      return `${name}: esta consola no sabe leer su estado. Actualice la consola.`;
  }
}

/** Why the jobs have no history here: never read as "all ran on time". */
export function noHistory(jobs: NonNullable<SystemHealth["jobs"]>): string | null {
  if (jobs.history === "available") return null;
  switch (jobs.reason) {
    case "not_installed":
      return "Esta base de datos no tiene el programador de tareas, así que no guarda cuándo corrió cada una (es lo normal en una copia local). Eso no quiere decir que corrieran a tiempo.";
    case "not_logged":
      return "El programador de tareas no está guardando el historial de corridas. Sin él no se puede saber si corrieron a tiempo.";
    case "no_access":
      return "La base de datos no permite leer el historial de tareas. Sin él no se puede saber si corrieron a tiempo.";
    default:
      return "No se pudo leer el historial de tareas. Sin él no se puede saber si corrieron a tiempo.";
  }
}

/** A line, in words: what happened and where to fix it. */
export function healthSentence(line: HealthLine): HealthSentence {
  const ok = line.state === "ok";
  const none = { href: null, linkLabel: null, orders: [] };
  switch (line.key) {
    case "messages_stopped":
      return {
        title: "Avisos detenidos",
        text: ok
          ? "Ninguno: todo lo que se planeó enviar salió o se descartó por una buena razón."
          : `${plural(line.count, "aviso no llegó", "avisos no llegaron")} a la persona (${[
              part(line, "dead") > 0
                ? `${part(line, "dead")} no se ${part(line, "dead") === 1 ? "pudo" : "pudieron"} enviar`
                : null,
              part(line, "failed") > 0
                ? `de ${part(line, "failed")} el proveedor informó que no se ${part(line, "failed") === 1 ? "entregó" : "entregaron"}`
                : null,
            ]
              .filter(Boolean)
              .join(
                "; ",
              )}). Revise el motivo y ${line.count === 1 ? "vuelva a enviarlo" : "vuelva a enviarlos"}.`,
        href: ok ? null : "/mensajes",
        linkLabel: ok ? null : "Ver los mensajes detenidos",
        orders: [],
      };
    case "messages_late": {
      if (ok) {
        return {
          title: "Envío de avisos",
          text: `Al día: ningún aviso espera más de ${line.minutes} minutos para salir.`,
          ...none,
        };
      }
      const said: string[] = [];
      if (line.refs.length > 0) {
        said.push(
          `${line.refs.map((channel) => CHANNEL[channel] ?? channel).join(" y ")} en pausa hasta el ${at(line.until)}: el proveedor rechazó las credenciales o la configuración.`,
        );
      }
      if (part(line, "waiting") > 0) {
        said.push(
          `${plural(part(line, "waiting"), "aviso espera", "avisos esperan")} para salir desde hace más de ${line.minutes} minutos.`,
        );
      }
      if (part(line, "unplanned") > 0) {
        said.push(
          `${plural(part(line, "unplanned"), "evento espera", "eventos esperan")} desde hace más de ${line.minutes} minutos para convertirse en avisos.`,
        );
      }
      if (line.since) said.push(`Lo más antiguo es del ${at(line.since)}.`);
      return {
        title: "Envío de avisos",
        text: `${said.join(" ")} Revise que el servicio que envía los avisos esté funcionando.`,
        href: "/mensajes",
        linkLabel: "Ver los mensajes",
        orders: [],
      };
    }
    case "events_failed":
      return {
        title: "Eventos sin avisos",
        text: ok
          ? "Ninguno: cada pedido, pago y entrega produjo sus avisos."
          : `${plural(line.count, "evento no produjo", "eventos no produjeron")} avisos después de varios intentos: alguien no fue avisado. Avise a quien mantiene el sistema.`,
        ...none,
      };
    case "cases_late": {
      // The same late cases as Hoy and the clocks of /casos: 084800 reads the
      // support desk's own due times. The targets stay in the database.
      const title = "Casos atrasados";
      if (ok) {
        return {
          title,
          text: "Ninguno: cada caso abierto está dentro de su plazo.",
          ...none,
        };
      }
      const late = part(line, "past_resolution");
      return {
        title,
        text: [
          `${plural(line.count, "caso está atrasado", "casos están atrasados")}${line.since ? `; el más antiguo, desde el ${at(line.since)}` : ""}.`,
          late > 0
            ? `${late === 1 ? "De ellos, 1 pasó" : `De ellos, ${late} pasaron`} el plazo para resolverse.`
            : null,
          line.count === 1 ? "Atiéndalo en Casos." : "Atiéndalos en Casos, el más antiguo primero.",
        ]
          .filter(Boolean)
          .join(" "),
        href: "/casos",
        linkLabel: "Ver los casos",
        orders: line.refs,
      };
    }
    case "invoices": {
      if (ok) {
        return {
          title: "Comprobantes electrónicos",
          text: "Ninguno rechazado, atrasado ni sin enviar.",
          ...none,
        };
      }
      const said = [
        part(line, "rejected") > 0
          ? plural(part(line, "rejected"), "rechazado por Hacienda", "rechazados por Hacienda")
          : null,
        part(line, "waiting") > 0
          ? `${plural(part(line, "waiting"), "espera", "esperan")} la respuesta de Hacienda hace más de ${hours(line.minutes)}`
          : null,
        part(line, "unsent") > 0 ? plural(part(line, "unsent"), "sin enviar", "sin enviar") : null,
        part(line, "failed_events") > 0
          ? plural(
              part(line, "failed_events"),
              "pago o reembolso sin su comprobante",
              "pagos o reembolsos sin su comprobante",
            )
          : null,
      ].filter(Boolean);
      return {
        title: "Comprobantes electrónicos",
        text: [
          said.length > 0 ? `${said.join(", ")}.` : null,
          line.until ? `El envío a Hacienda está en pausa hasta el ${at(line.until)}.` : null,
          "Revise cada uno y reemplácelo o vuelva a enviarlo.",
        ]
          .filter(Boolean)
          .join(" "),
        href: "/comprobantes",
        linkLabel: "Ver los comprobantes",
        orders: [],
      };
    }
    case "invoice_certificate": {
      const title = "Firma de comprobantes";
      const link = {
        href: "/comprobantes" as Route,
        linkLabel: "Ver los comprobantes",
        orders: [],
      };
      if (line.state === "unknown") {
        return {
          title,
          text: "El servicio de comprobantes todavía no ha informado sobre el certificado de firma. Informa cada vez que corre.",
          ...none,
        };
      }
      if (part(line, "worker_error") > 0 || !line.until) {
        return {
          title,
          text: `El servicio de comprobantes no pudo leer el certificado de firma en su último informe (${at(line.since)}). Mientras tanto no se firman comprobantes. Revise el certificado y su clave en la configuración del servicio.`,
          ...link,
        };
      }
      if (line.state === "problem") {
        return {
          title,
          text: `El certificado de firma venció el ${day(line.until)}. No se pueden firmar comprobantes hasta instalar uno nuevo.`,
          ...link,
        };
      }
      if (line.state === "attention") {
        return {
          title,
          text: `El certificado de firma vence el ${day(line.until)}, en menos de ${part(line, "attention_days")} días. Pida uno nuevo antes de esa fecha.`,
          ...link,
        };
      }
      return {
        title,
        text: `El certificado de firma vence el ${day(line.until)}.`,
        ...none,
      };
    }
    case "refunds_failed":
      return {
        title: "Reembolsos por la pasarela",
        text: ok
          ? "Ninguno fallido."
          : `${plural(line.count, "reembolso fallido", "reembolsos fallidos")}: la pasarela no los aceptó y el cliente todavía no recibe su dinero. Reinténtelos o páguelos por transferencia.`,
        href: ok ? null : "/cobros/reembolsos",
        linkLabel: ok ? null : "Ver los reembolsos",
        orders: [],
      };
    case "payments_failed": {
      const declined = part(line, "declined");
      const errors = part(line, "errors");
      const said = [
        declined === 0
          ? "Ningún pago rechazado por el banco o la tarjeta en la última hora."
          : `${plural(declined, "pago rechazado", "pagos rechazados")} por el banco o la tarjeta en la última hora.`,
      ];
      if (line.state === "attention") {
        said.push(
          `Desde ${part(line, "attention_from")} conviene revisar si la pasarela está rechazando cobros buenos.`,
        );
      }
      if (errors > 0) {
        said.push(
          `Además, ${plural(errors, "intento no se pudo", "intentos no se pudieron")} crear en la pasarela: el cliente no pudo pagar.`,
        );
      }
      return {
        title: "Pagos fallidos",
        text: said.join(" "),
        href: ok ? null : "/cobros",
        linkLabel: ok ? null : "Ver los cobros",
        orders: [],
      };
    }
    case "payments_worker":
      return {
        title: "Procesador de pagos",
        text: ok
          ? `Al día: nada espera más de ${line.minutes} minutos.`
          : `${[
              part(line, "attempts") > 0 ? plural(part(line, "attempts"), "cobro", "cobros") : null,
              part(line, "refunds") > 0
                ? plural(part(line, "refunds"), "reembolso", "reembolsos")
                : null,
            ]
              .filter(Boolean)
              .join(
                " y ",
              )} ${line.count === 1 ? "espera" : "esperan"} al procesador de pagos desde el ${at(line.since)}. Revise que el servicio de pagos esté funcionando.`,
        href: ok ? null : "/cobros",
        linkLabel: ok ? null : "Ver los cobros",
        orders: [],
      };
    case "jobs":
      return {
        title: "Tareas programadas",
        text:
          line.state === "ok"
            ? "Todas corrieron a tiempo."
            : line.state === "unknown"
              ? "No se puede saber si corrieron a tiempo: vea el detalle abajo."
              : `${plural(line.count, "tarea tiene", "tareas tienen")} problemas: ${line.refs.map((name) => JOB_LABEL[name] ?? name).join(", ")}. Avise a quien mantiene el sistema.`,
        ...none,
      };
    case "orders_unpaid_overdue":
      return {
        title: "Pedidos sin pagar vencidos",
        text: ok
          ? "Ninguno: los pedidos sin pagar se cancelan a tiempo."
          : `${plural(line.count, "pedido sin pagar sigue", "pedidos sin pagar siguen")} apartando mercadería más de ${line.minutes} minutos después de hecho. La tarea que los vence no está corriendo.`,
        href: ok ? null : ("/pedidos?estado=pending_payment" as Route),
        linkLabel: ok ? null : "Ver los pedidos sin pagar",
        orders: line.refs,
      };
    case "orders_not_released":
      return {
        title: "Pedidos pagados sin pasar a bodega",
        text: ok
          ? "Ninguno: cada pedido pagado llegó a la lista de la bodega."
          : `${plural(line.count, "pedido pagado no llegó", "pedidos pagados no llegaron")} a la lista de la bodega después de ${line.minutes} minutos. Nadie los está preparando. Avise a quien mantiene el sistema.`,
        ...none,
        orders: line.refs,
      };
    case "routes_open": {
      // The same rule and words as Rutas detenidas (STUCK_REASON).
      const why = [
        part(line, "past_date") > 0 ? `${part(line, "past_date")}: su día ya pasó` : null,
        part(line, "cancelled_parcel") > 0
          ? `${part(line, "cancelled_parcel")}: lleva un paquete cancelado o devuelto`
          : null,
        part(line, "no_open_stops") > 0
          ? `${part(line, "no_open_stops")}: no le quedan paradas pendientes`
          : null,
      ].filter(Boolean);
      return {
        title: "Rutas detenidas",
        text: ok
          ? "Ninguna ruta está detenida."
          : `${plural(line.count, "ruta no puede", "rutas no pueden")} terminar: ${line.refs.join(", ")}${why.length > 0 ? ` (${why.join("; ")})` : ""}. Ciérrelas o arregle sus paradas.`,
        href: ok ? null : "/operacion/rutas",
        linkLabel: ok ? null : "Ver las rutas detenidas",
        orders: [],
      };
    }
    case "sign_ins_failed":
      // Only the websites count attempts (packages/next-kit's sign-in guard);
      // the phone apps sign in without it, so they are not in this number.
      return {
        title: "Intentos de ingreso fallidos en los sitios web",
        text:
          line.state === "attention"
            ? `${line.count} en la última hora. Son muchos: puede ser alguien probando contraseñas. El límite por persona y por dirección ya los frena. No incluye las aplicaciones de teléfono.`
            : `${line.count} en la última hora. No incluye las aplicaciones de teléfono.`,
        ...none,
      };
    default:
      return {
        title: "Comprobación nueva",
        text: "La base de datos tiene una comprobación que esta versión de la consola no sabe mostrar. Actualice la consola para verla en palabras.",
        ...none,
      };
  }
}

export const STORE_APP_LABEL: Record<StoreApp, string> = {
  shop: apps.shop.name,
  seller: apps.seller.name,
  driver: apps.driver.name,
  warehouse: apps.warehouse.name,
};
export const STORE_PLATFORM_LABEL: Record<StorePlatform, string> = {
  ios: "iPhone",
  android: "Android",
};
export const STORE_TRACK_LABEL: Record<StoreTrack, string> = {
  internal: "Prueba interna",
  public: "Pública en la tienda",
};
