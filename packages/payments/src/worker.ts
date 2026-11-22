/**
 * One run of the payments worker: say what it holds, take what is due, do
 * each task at the gateway, report each outcome. The database decides what
 * is due and what an outcome means; this loop only calls the gateway.
 *
 *   create        create the attempt at the gateway (hosted page, or SINPE intent)
 *   cancel        stop an attempt whose order no longer waits for it
 *   check         ask about an attempt no notification has settled (reconciliation)
 *   refund        send a refund, once
 *   refund_check  a send whose answer was lost: does the gateway hold it?
 *   refund_poll   a refund sent long ago and not confirmed: ask
 *
 * Every call to the gateway that creates something is made at most once per
 * task: a lost answer is reported as "unknown", never retried here.
 */

import { keysReady, type PaymentsConfig, webhookReady } from "./config.ts";
import {
  type Clock,
  GatewayError,
  type GatewayPayment,
  type Logger,
  type NormalisedEvent,
  type PaymentGateway,
  type PaymentsQueue,
  type PaymentTask,
} from "./types.ts";

export interface RunDeps {
  config: PaymentsConfig;
  gateway: PaymentGateway;
  queue: PaymentsQueue;
  clock: Clock;
  logger: Logger;
  workerId: string;
}

export interface RunStats {
  active: boolean;
  tasks: number;
  done: number;
  failed: number;
}

const LEASE_SECONDS = 60;
const BATCH = 10;

export function returnUrls(config: PaymentsConfig, orderNumber: string, to: "web" | "app") {
  const order = encodeURIComponent(orderNumber);
  if (to === "app") {
    return {
      returnUrl: `${config.links.appScheme}://pedidos/${order}?pago=retorno`,
      cancelUrl: `${config.links.appScheme}://pedidos/${order}?pago=cancelado`,
    };
  }
  return {
    returnUrl: `${config.links.shop}/pedidos/${order}/pago/retorno`,
    cancelUrl: `${config.links.shop}/pedidos/${order}/pago/retorno?cancelado=1`,
  };
}

/** What a gateway's answer about a payment means, as an event the database applies. */
export function pollEvent(
  config: PaymentsConfig,
  attemptId: string,
  payment: GatewayPayment,
): NormalisedEvent {
  const type: NormalisedEvent["type"] =
    payment.status === "succeeded"
      ? "payment.succeeded"
      : payment.status === "processing"
        ? "payment.processing"
        : payment.status === "failed"
          ? "payment.failed"
          : payment.status === "cancelled"
            ? "payment.cancelled"
            : payment.status === "expired"
              ? "payment.expired"
              : "payment.open";
  return {
    provider: payment.gateway,
    // The same answer twice is one event; a new status or update is another.
    event_id: `poll:${attemptId}:${payment.status}:${payment.updatedAt ?? "-"}`,
    source: "poll",
    environment: config.environment,
    type,
    provider_type: `poll.${payment.status}`,
    occurred_at: payment.updatedAt,
    attempt_id: attemptId,
    payment: {
      reference: payment.reference,
      session_reference: payment.sessionReference,
      status: payment.status,
      amount_minor: payment.amountMinor,
      currency: payment.currency,
      updated_at: payment.updatedAt,
      failure_code: payment.failure?.code ?? null,
      fee_minor: payment.feeMinor,
      metadata: payment.metadata,
    },
  };
}

async function runTask(deps: RunDeps, task: PaymentTask): Promise<void> {
  const { config, gateway, queue, workerId } = deps;
  switch (task.kind) {
    case "create": {
      const urls = returnUrls(config, task.order_number, task.return_to);
      try {
        const payment = await gateway.createPayment({
          attemptId: task.attempt_id,
          paymentId: task.payment_id,
          orderId: task.order_id,
          orderNumber: task.order_number,
          amountMinor: task.amount_minor,
          currency: "CRC",
          method: task.method,
          customer: { name: task.customer?.name ?? null, email: task.customer?.email ?? null },
          sinpe:
            task.method === "sinpe_movil" && task.payer
              ? {
                  payer: { kind: task.payer.kind, number: task.payer.number },
                  phoneE164: task.payer.phone,
                }
              : undefined,
          ...urls,
          expiresAt: new Date(task.expires_at),
        });
        await queue.report(workerId, {
          kind: "created",
          attempt_id: task.attempt_id,
          outcome: "created",
          session_reference: payment.sessionReference,
          intent_reference: payment.reference,
          checkout_url: payment.nextAction.kind === "redirect" ? payment.nextAction.url : null,
          sinpe_destination:
            payment.nextAction.kind === "sinpe_transfer"
              ? payment.nextAction.destinationPhoneE164
              : null,
          status: payment.status === "processing" ? "processing" : "open",
        });
      } catch (error) {
        if (!(error instanceof GatewayError)) throw error;
        if (error.partial?.reference && error.kind === "unknown") {
          // The intent exists; whether the last step went through, a check will tell.
          await queue.report(workerId, {
            kind: "created",
            attempt_id: task.attempt_id,
            outcome: "created",
            intent_reference: error.partial.reference,
            status: "processing",
          });
          return;
        }
        await queue.report(workerId, {
          kind: "created",
          attempt_id: task.attempt_id,
          outcome: error.kind,
          retryable: error.retryable,
          code: error.code,
        });
      }
      return;
    }

    case "cancel": {
      try {
        await gateway.cancelPayment({
          reference: task.intent_reference,
          sessionReference: task.session_reference,
        });
        await queue.report(workerId, { kind: "cancelled", attempt_id: task.attempt_id, ok: true });
      } catch (error) {
        if (!(error instanceof GatewayError)) throw error;
        await queue.report(workerId, {
          kind: "cancelled",
          attempt_id: task.attempt_id,
          ok: false,
          code: error.code,
        });
      }
      return;
    }

    case "check": {
      try {
        const payment = await gateway.getPayment({
          reference: task.intent_reference,
          sessionReference: task.session_reference,
        });
        await queue.event(pollEvent(config, task.attempt_id, payment));
      } catch (error) {
        if (!(error instanceof GatewayError)) throw error;
        await queue.report(workerId, {
          kind: "release_attempt",
          attempt_id: task.attempt_id,
          retry_after_seconds: 120,
        });
      }
      return;
    }

    case "refund": {
      if (!task.payment_reference) {
        await queue.report(workerId, {
          kind: "refund_sent",
          gateway_refund_id: task.gateway_refund_id,
          outcome: "refused",
          code: "no_payment_reference",
        });
        return;
      }
      try {
        const refund = await gateway.refund({
          refundId: task.gateway_refund_id,
          reference: task.payment_reference,
          amountMinor: task.amount_minor,
          reason: task.reason,
          note: task.order_number ? `Devolución pedido ${task.order_number}` : undefined,
        });
        await queue.report(workerId, {
          kind: "refund_sent",
          gateway_refund_id: task.gateway_refund_id,
          outcome: "accepted",
          provider_refund_reference: refund.reference,
          status: refund.status,
          code: refund.failure?.code ?? null,
        });
      } catch (error) {
        if (!(error instanceof GatewayError)) throw error;
        await queue.report(workerId, {
          kind: "refund_sent",
          gateway_refund_id: task.gateway_refund_id,
          outcome: error.kind === "refused" && !error.retryable ? "refused" : "unknown",
          code: error.code,
        });
      }
      return;
    }

    case "refund_check": {
      try {
        const payment = await gateway.getPayment({ reference: task.payment_reference });
        await queue.report(workerId, {
          kind: "refund_checked",
          gateway_refund_id: task.gateway_refund_id,
          provider_refunded_minor: payment.refundedMinor,
        });
      } catch (error) {
        if (!(error instanceof GatewayError)) throw error;
        await queue.report(workerId, {
          kind: "release_refund",
          gateway_refund_id: task.gateway_refund_id,
          retry_after_seconds: 120,
        });
      }
      return;
    }

    case "refund_poll": {
      if (!task.provider_refund_reference) {
        await queue.report(workerId, {
          kind: "release_refund",
          gateway_refund_id: task.gateway_refund_id,
          retry_after_seconds: 600,
        });
        return;
      }
      try {
        const refund = await gateway.getRefund(task.provider_refund_reference);
        const outcome = await queue.event({
          provider: gateway.id,
          event_id: `poll:refund:${refund.reference}:${refund.status}:${refund.updatedAt ?? "-"}`,
          source: "poll",
          environment: config.environment,
          type:
            refund.status === "succeeded"
              ? "refund.succeeded"
              : refund.status === "failed"
                ? "refund.failed"
                : "refund.created",
          provider_type: `poll.refund.${refund.status}`,
          occurred_at: refund.updatedAt,
          refund: {
            reference: refund.reference,
            payment_reference: refund.paymentReference ?? task.payment_reference,
            status: refund.status,
            amount_minor: refund.amountMinor,
            currency: refund.currency,
            updated_at: refund.updatedAt,
            failure_code: refund.failure?.code ?? null,
          },
        });
        if (outcome === "duplicate" || refund.status === "pending") {
          await queue.report(workerId, {
            kind: "release_refund",
            gateway_refund_id: task.gateway_refund_id,
            retry_after_seconds: 600,
          });
        }
      } catch (error) {
        if (!(error instanceof GatewayError)) throw error;
        await queue.report(workerId, {
          kind: "release_refund",
          gateway_refund_id: task.gateway_refund_id,
          retry_after_seconds: 300,
        });
      }
      return;
    }
  }
}

export async function runPaymentsOnce(
  deps: RunDeps,
  options: { budgetMs?: number } = {},
): Promise<RunStats> {
  const { config, queue, logger, workerId } = deps;
  const started = deps.clock.now().getTime();
  const hello = await queue.hello({
    provider: deps.gateway.id,
    environment: config.environment,
    account: config.onvo.accountId,
    keysReady: keysReady(config),
    webhookReady: webhookReady(config),
  });
  const stats: RunStats = { active: hello.active, tasks: 0, done: 0, failed: 0 };
  if (!hello.active || !keysReady(config)) return stats;

  const budget = options.budgetMs ?? 50_000;
  while (deps.clock.now().getTime() - started < budget) {
    const tasks = await queue.claim(workerId, BATCH, LEASE_SECONDS);
    if (tasks.length === 0) break;
    for (const task of tasks) {
      stats.tasks++;
      try {
        await runTask(deps, task);
        stats.done++;
      } catch (error) {
        // An error reaching the database: the lease runs out and the task is
        // looked at again (never repeated blindly).
        stats.failed++;
        logger.error("task failed", { kind: task.kind, error: String(error).slice(0, 200) });
      }
    }
    if (tasks.length < BATCH) break;
  }
  return stats;
}
