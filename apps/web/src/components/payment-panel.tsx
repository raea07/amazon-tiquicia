import type { OrderPayment } from "@yuntera/db";
import { Alert, Badge, buttonClass, formatDateTime, formatPrice } from "@yuntera/ui";
import type { Route } from "next";
import { AutoRefresh, StartCardPaymentForm, StartSinpeForm } from "./payment-forms";

/** What the gateway's decline code means for the shopper. Never the code itself. */
const DECLINE: Record<string, string> = {
  declined: "Su banco no aprobó el pago.",
  authentication_failed: "No se completó la verificación que pidió su banco.",
  insufficient_funds: "La tarjeta no tiene fondos suficientes.",
  expired_card: "La tarjeta está vencida.",
};

/** +50670196686 → 7019-6686 */
const localPhone = (e164: string | null | undefined) =>
  e164 ? `${e164.slice(-8, -4)}-${e164.slice(-4)}` : "";

/**
 * The payment of an order that goes through the gateway (test and live):
 * one clear next step for each stage, so the shopper always knows whether
 * they have paid. Sandbox and hand-confirmed transfers keep the page's own
 * instructions.
 */
export function PaymentPanel({ payment }: { payment: OrderPayment }) {
  const amount = formatPrice(payment.amount_minor);
  const until = `Guardamos sus productos hasta el ${formatDateTime(payment.expires_at)}; si no recibimos el pago, el pedido se cancela solo y no se le cobra nada.`;
  const card = payment.method === "card";
  const attempt = payment.attempt;

  const frame = (tone: "pay" | "wait" | "problem", body: React.ReactNode) => (
    <section
      aria-labelledby="pago"
      className={`rounded-lg border p-5 ${tone === "problem" ? "border-danger bg-surface" : "border-maiz-300 bg-maiz-50"}`}
    >
      {body}
    </section>
  );

  const start = card ? (
    <>
      <p className="mt-2 text-sm">
        Pague con su tarjeta de crédito o débito en la página segura de ONVO, nuestro procesador de
        pagos. Su banco puede pedirle una confirmación adicional. Nosotros nunca vemos los datos de
        su tarjeta.
      </p>
      <div className="mt-4">
        <StartCardPaymentForm
          orderId={payment.order_id}
          orderNumber={payment.order_number}
          label={`Pagar ${amount} con tarjeta`}
        />
      </div>
    </>
  ) : (
    <>
      <p className="mt-2 text-sm">
        Le pedimos la identificación y el celular de quien paga: ONVO, nuestro procesador de pagos,
        acepta solo una transferencia que salga de esa cuenta y por el monto exacto. Así su pago se
        confirma solo, sin que nadie tenga que revisarlo.
      </p>
      <div className="mt-4">
        <StartSinpeForm
          orderId={payment.order_id}
          orderNumber={payment.order_number}
          submit="Ver los datos para transferir"
        />
      </div>
    </>
  );

  switch (payment.stage) {
    case "start":
      return frame(
        "pay",
        <>
          <h2 id="pago" className="text-lg font-bold">
            Falta el pago de {amount}
          </h2>
          {start}
          <p className="mt-3 text-sm text-ink-muted">{until}</p>
        </>,
      );

    case "preparing":
      return frame(
        "wait",
        <>
          <h2 id="pago" className="text-lg font-bold">
            Estamos preparando su pago
          </h2>
          <p className="mt-2 text-sm">Tarda unos segundos. Todavía no se le ha cobrado nada.</p>
          <div className="mt-2">
            <AutoRefresh seconds={2} forMinutes={2} />
          </div>
        </>,
      );

    case "pay":
      return frame(
        "pay",
        <>
          <h2 id="pago" className="text-lg font-bold">
            Falta el pago de {amount}
          </h2>
          <p className="mt-2 text-sm">
            Su página de pago está lista. Allí escribe los datos de la tarjeta; su banco puede
            pedirle una confirmación adicional.
          </p>
          {attempt?.checkout_url ? (
            <a
              href={attempt.checkout_url as Route}
              className={buttonClass({ size: "lg", className: "mt-4" })}
              data-testid="go-to-gateway"
            >
              Ir a pagar {amount}
            </a>
          ) : null}
          <p className="mt-3 text-sm text-ink-muted">{until}</p>
        </>,
      );

    case "confirming":
      return frame(
        "wait",
        <>
          <h2 id="pago" className="text-lg font-bold">
            Estamos confirmando su pago
          </h2>
          <p className="mt-2 text-sm">
            Volvió de la página de pago y estamos esperando la confirmación del procesador. Suele
            tardar unos segundos. <strong>No vuelva a pagar.</strong>
          </p>
          <div className="mt-2">
            <AutoRefresh seconds={2} forMinutes={5} />
          </div>
          {card && attempt?.checkout_url ? (
            <p className="mt-3 text-sm">
              ¿Cerró la página antes de terminar?{" "}
              <a href={attempt.checkout_url as Route} className="text-link underline">
                Volver a la página de pago
              </a>
            </p>
          ) : null}
        </>,
      );

    case "transfer":
      return frame(
        "wait",
        <>
          <h2 id="pago" className="text-lg font-bold">
            Haga la transferencia por SINPE Móvil
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
            <li>Abra la aplicación de su banco, desde la cuenta del celular que nos indicó.</li>
            <li>
              Envíe exactamente <strong data-testid="sinpe-amount">{amount}</strong> por SINPE Móvil
              al número{" "}
              <strong className="tabular-nums" data-testid="sinpe-number">
                {localPhone(attempt?.sinpe_destination)}
              </strong>
              .
            </li>
            <li>
              Su banco mostrará como destinatario a <strong>ONVO</strong>, nuestro procesador de
              pagos, no a Yuntera. Es correcto.
            </li>
            <li>
              En el detalle puede escribir «{attempt?.suggested_description}». No es obligatorio.
            </li>
          </ol>
          <p className="mt-3 text-sm">
            Cuando llegue, el pedido se confirma solo y le avisamos. Si el monto no es exacto o sale
            de otra cuenta, el banco rechaza la transferencia y el dinero no sale de su cuenta.
          </p>
          <div className="mt-2">
            <AutoRefresh seconds={3} forMinutes={30} />
          </div>
          <p className="mt-2 text-sm text-ink-muted">{until}</p>
        </>,
      );

    case "failed":
    case "error":
      return frame(
        "problem",
        <>
          <h2 id="pago" className="text-lg font-bold">
            {payment.stage === "failed" ? "El pago no se completó" : "No pudimos preparar el pago"}
          </h2>
          <Alert tone="danger" className="mt-3">
            {payment.stage === "failed"
              ? `${DECLINE[attempt?.failure_code ?? ""] ?? "El pago no se aprobó."} No se le cobró nada.`
              : "Hubo un problema al conectar con el procesador de pagos. No se le cobró nada."}
          </Alert>
          {payment.can_start ? (
            <>
              <p className="mt-3 text-sm">
                Puede intentarlo de nuevo{card ? " con la misma u otra tarjeta" : ""}. Le quedan{" "}
                {payment.attempts_left} intentos.
              </p>
              <div className="mt-3">
                {card ? (
                  <StartCardPaymentForm
                    orderId={payment.order_id}
                    orderNumber={payment.order_number}
                    label={`Intentar de nuevo: pagar ${amount}`}
                  />
                ) : (
                  <StartSinpeForm
                    orderId={payment.order_id}
                    orderNumber={payment.order_number}
                    submit="Intentar de nuevo"
                  />
                )}
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm">
              Ya no se puede reintentar en este pedido. Si quiere sus productos, haga el pedido de
              nuevo con otro medio de pago.
            </p>
          )}
          <p className="mt-3 text-sm text-ink-muted">{until}</p>
        </>,
      );

    case "review":
      return frame(
        "wait",
        <>
          <h2 id="pago" className="text-lg font-bold">
            Estamos revisando su pago
          </h2>
          <p className="mt-2 text-sm">
            Recibimos un pago que no coincide con este pedido (por ejemplo, otro monto). Nuestro
            equipo de finanzas lo está revisando y le escribirá. <strong>No vuelva a pagar.</strong>
          </p>
        </>,
      );

    default:
      return null;
  }
}

const REFUND_STATE = {
  done: { label: "Completado", tone: "success" },
  onItsWay: { label: "En camino", tone: "info" },
  problem: { label: "En revisión", tone: "warning" },
} as const;

/** Refunds of the order: on their way until the gateway (or finance) confirms each. */
export function RefundList({ payment }: { payment: OrderPayment }) {
  if (payment.refunds.length === 0) return null;
  return (
    <section
      aria-labelledby="reembolsos"
      className="rounded-lg border border-border bg-surface p-5"
    >
      <h2 id="reembolsos" className="text-lg font-bold">
        Reembolsos
      </h2>
      <ul className="mt-3 flex flex-col gap-3 text-sm">
        {payment.refunds.map((refund) => {
          const state =
            refund.status === "succeeded"
              ? REFUND_STATE.done
              : refund.status === "failed"
                ? REFUND_STATE.problem
                : REFUND_STATE.onItsWay;
          return (
            <li key={refund.id} className="flex flex-col gap-1" data-testid="refund">
              <span className="flex flex-wrap items-center gap-2">
                <strong className="tabular-nums">{formatPrice(refund.amount_minor)}</strong>
                <Badge tone={state.tone}>{state.label}</Badge>
              </span>
              <span className="text-ink-muted">
                {refund.status === "succeeded"
                  ? `Completado el ${formatDateTime(refund.completed_at ?? refund.requested_at)}: ${
                      refund.channel === "transfer"
                        ? "se lo transferimos a la cuenta que nos indicó."
                        : refund.channel === "gateway"
                          ? "volvió al mismo medio con el que pagó; su banco puede tardar unos días en mostrarlo."
                          : "en modo de prueba, sin dinero real."
                    }`
                  : refund.status === "failed"
                    ? "Su banco no aceptó el reembolso por el medio original. Nuestro equipo de finanzas lo está resolviendo y le escribirá; no tiene que hacer nada."
                    : refund.channel === "transfer"
                      ? `Solicitado el ${formatDateTime(refund.requested_at)}: le haremos una transferencia y le escribiremos para pedirle la cuenta.`
                      : `Solicitado el ${formatDateTime(refund.requested_at)}: va de vuelta al mismo medio con el que pagó; le avisamos cuando se complete.`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
