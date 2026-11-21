/**
 * Order risk scoring.
 *
 * A transparent, rule-based score that decides how much friction an order gets
 * before it is accepted. Rules are additive and each one records why it fired,
 * so a reviewer (and, on request, the customer) can be told what happened.
 *
 * What is deliberately NOT an input: the delivery district, the customer's
 * name, nationality, or identification type. Scoring by neighbourhood is
 * redlining — it punishes people for where they live — and Costa Rican
 * data-protection law restricts automated decisions built on such attributes.
 * Risk is judged on behaviour: account history, velocity, payment outcomes.
 *
 * Rules are a starting point. Once there is labelled fraud data, a model can
 * replace the weights behind the same `assessOrderRisk` contract.
 */

import type { PaymentMethod } from "./fees";

export interface RiskSignals {
  orderTotalMinor: number;
  paymentMethod: PaymentMethod;
  accountAgeHours: number;
  phoneVerified: boolean;
  emailVerified: boolean;
  /** Orders this account has had delivered successfully. */
  deliveredOrders: number;
  /** Refused or failed cash-on-delivery attempts on this account. */
  refusedCodOrders: number;
  ordersLastHour: number;
  ordersLast24h: number;
  failedPaymentsLast24h: number;
  /** Other accounts that used the same payment instrument fingerprint. */
  accountsSharingPaymentInstrument: number;
  /** Other accounts created from the same device in the last 30 days. */
  accountsSharingDevice30d: number;
  /** Chargebacks or confirmed fraud reports on this account. */
  priorChargebacks: number;
  /** Median value of this account's past orders, if any. */
  medianOrderMinor: number | null;
  /** True when the shipping address was added within the last hour. */
  addressAddedRecently: boolean;
}

export type RiskDecision = "approve" | "step_up" | "review" | "decline";

export interface RiskRuleHit {
  rule: string;
  points: number;
  reason: string;
}

export interface RiskAssessment {
  score: number;
  decision: RiskDecision;
  hits: RiskRuleHit[];
  /** Concrete restrictions to apply for a `step_up` decision. */
  requirements: Array<"verify_phone" | "prepay_only" | "three_d_secure">;
}

export interface RiskConfig {
  /** Cash-on-delivery orders above this need a verified, proven account. */
  codHighValueMinor: number;
  highValueMinor: number;
  thresholds: { stepUp: number; review: number; decline: number };
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  codHighValueMinor: 7_500_000, // ₡75 000
  highValueMinor: 25_000_000, // ₡250 000
  thresholds: { stepUp: 30, review: 60, decline: 85 },
};

type Rule = (s: RiskSignals, c: RiskConfig) => RiskRuleHit | null;

const rules: Rule[] = [
  (s) =>
    s.priorChargebacks > 0
      ? {
          rule: "prior_chargeback",
          points: 50,
          reason: "La cuenta tiene contracargos o fraude confirmado.",
        }
      : null,
  (s) =>
    s.accountsSharingPaymentInstrument >= 3
      ? {
          rule: "shared_instrument",
          points: 35,
          reason: "El mismo medio de pago se usó en tres o más cuentas.",
        }
      : null,
  (s) =>
    s.accountsSharingDevice30d >= 4
      ? {
          rule: "device_farm",
          points: 30,
          reason: "Se crearon varias cuentas desde el mismo dispositivo.",
        }
      : null,
  (s) =>
    s.failedPaymentsLast24h >= 3
      ? {
          rule: "card_testing",
          points: 30,
          reason: "Tres o más pagos fallidos en 24 horas.",
        }
      : null,
  (s) =>
    s.ordersLastHour >= 4
      ? { rule: "velocity_hour", points: 25, reason: "Cuatro o más pedidos en una hora." }
      : null,
  (s) =>
    s.ordersLast24h >= 10
      ? { rule: "velocity_day", points: 15, reason: "Diez o más pedidos en 24 horas." }
      : null,
  (s, c) =>
    s.paymentMethod === "cash_on_delivery" &&
    s.orderTotalMinor >= c.codHighValueMinor &&
    s.deliveredOrders === 0
      ? {
          rule: "cod_high_value_first_order",
          points: 35,
          reason: "Primer pedido contra entrega de monto alto.",
        }
      : null,
  (s) =>
    s.paymentMethod === "cash_on_delivery" && s.refusedCodOrders >= 2
      ? {
          rule: "cod_refusals",
          points: 40,
          reason: "Dos o más pedidos contra entrega rechazados.",
        }
      : null,
  (s, c) =>
    s.accountAgeHours < 1 && s.orderTotalMinor >= c.highValueMinor
      ? {
          rule: "new_account_high_value",
          points: 30,
          reason: "Cuenta creada hace menos de una hora con pedido de monto alto.",
        }
      : null,
  (s) =>
    !s.phoneVerified
      ? { rule: "phone_unverified", points: 15, reason: "Teléfono sin verificar." }
      : null,
  (s) =>
    !s.emailVerified
      ? { rule: "email_unverified", points: 5, reason: "Correo sin verificar." }
      : null,
  (s) =>
    s.medianOrderMinor !== null &&
    s.medianOrderMinor > 0 &&
    s.orderTotalMinor > s.medianOrderMinor * 8
      ? {
          rule: "unusual_basket",
          points: 15,
          reason: "El monto es más de ocho veces el pedido habitual de la cuenta.",
        }
      : null,
  (s) =>
    s.addressAddedRecently && s.deliveredOrders > 0 && s.paymentMethod === "card"
      ? {
          rule: "new_address_on_established_account",
          points: 10,
          reason: "Dirección nueva en una cuenta existente, pagando con tarjeta.",
        }
      : null,
  // Earned trust lowers the score; it can never excuse a chargeback history.
  (s) =>
    s.deliveredOrders >= 5 && s.priorChargebacks === 0
      ? {
          rule: "established_customer",
          points: -20,
          reason: "Cliente con historial de entregas exitosas.",
        }
      : null,
];

export function assessOrderRisk(
  signals: RiskSignals,
  config: RiskConfig = DEFAULT_RISK_CONFIG,
): RiskAssessment {
  const hits = rules
    .map((rule) => rule(signals, config))
    .filter((h): h is RiskRuleHit => h !== null);
  const score = Math.min(
    100,
    Math.max(
      0,
      hits.reduce((total, h) => total + h.points, 0),
    ),
  );

  const t = config.thresholds;
  const decision: RiskDecision =
    score >= t.decline
      ? "decline"
      : score >= t.review
        ? "review"
        : score >= t.stepUp
          ? "step_up"
          : "approve";

  const requirements: RiskAssessment["requirements"] = [];
  if (decision === "step_up") {
    if (!signals.phoneVerified) requirements.push("verify_phone");
    if (signals.paymentMethod === "cash_on_delivery") requirements.push("prepay_only");
    if (signals.paymentMethod === "card") requirements.push("three_d_secure");
    // A step-up must always ask for something, or it is just an approval.
    if (requirements.length === 0) requirements.push("verify_phone");
  }

  return { score, decision, hits, requirements };
}
