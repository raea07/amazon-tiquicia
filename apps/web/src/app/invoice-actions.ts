"use server";

/**
 * Placing an order with, optionally, a factura in the shopper's name for the
 * delivery fee. The identification is checked here with the same rules as
 * packages/core and again in the database; it is saved against the order's
 * idempotency key before the order is placed, and used when the payment is
 * confirmed. Unticked (the default), nothing is saved and the shopper gets a
 * tiquete, as the law allows for a final consumer.
 */

import { HACIENDA_ID_CODE, type IdentificationType, parseIdentification } from "@yuntera/core";
import { cleanText, HACIENDA_EMAIL } from "@yuntera/next-kit/fiscal-document";
import {
  type ActionState,
  GENERIC_ERROR,
  isRedirect,
  messageOf,
  typed,
} from "@yuntera/next-kit/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { placeOrder } from "@/app/actions";
import { getViewer, signInUrl } from "@/lib/session";
import { sessionApi } from "@/lib/supabase";

const FIELDS = [
  // Kept so a refused try comes back with the address and payment method chosen.
  "addressId",
  "paymentMethod",
  "factura",
  "facturaTipo",
  "facturaNumero",
  "facturaNombre",
  "facturaCorreo",
] as const;

const ID_KINDS = Object.keys(HACIENDA_ID_CODE) as [IdentificationType, ...IdentificationType[]];

const receiverSchema = z
  .object({
    facturaTipo: z.enum(ID_KINDS, "Elija el tipo de identificación para la factura."),
    facturaNumero: z.string().trim().min(1, "Escriba el número de identificación para la factura."),
    // Cleaned as the XML will carry it, so what passes here is what Hacienda receives.
    facturaNombre: z
      .string()
      .max(1000, "El nombre para la factura puede tener hasta 100 caracteres.")
      .transform((name) => cleanText(name, 1000))
      .pipe(
        z
          .string()
          .min(3, "Escriba el nombre o la razón social para la factura.")
          .max(100, "El nombre para la factura puede tener hasta 100 caracteres."),
      ),
    facturaCorreo: z
      .union([
        z.literal(""),
        z
          .string()
          .trim()
          .max(160, "Revise el correo para la factura; debe ser como nombre@dominio.com.")
          .regex(
            HACIENDA_EMAIL,
            "Revise el correo para la factura; debe ser como nombre@dominio.com.",
          ),
      ])
      .optional(),
  })
  .refine((v) => parseIdentification(v.facturaNumero, v.facturaTipo) !== null, {
    message:
      "Ese número no corresponde al tipo de identificación elegido. La cédula física tiene 9 dígitos (por ejemplo 1-0987-0654); la jurídica, 10 (por ejemplo 3-101-123456).",
    path: ["facturaNumero"],
  });

export async function placeOrderWithInvoice(
  previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await getViewer())) redirect(signInUrl("/pagar"));
  const values = typed(formData, ...FIELDS);
  const key = z.string().min(8).max(80).safeParse(formData.get("idempotencyKey"));
  if (!key.success) return { error: GENERIC_ERROR, values };

  try {
    const api = await sessionApi();
    if (values.factura === "on") {
      const parsed = receiverSchema.safeParse(values);
      if (!parsed.success) {
        return { error: parsed.error.issues[0]?.message ?? GENERIC_ERROR, values };
      }
      await api.setCheckoutInvoiceReceiver(key.data, {
        idType: parsed.data.facturaTipo,
        idNumber: parsed.data.facturaNumero,
        name: parsed.data.facturaNombre,
        email: parsed.data.facturaCorreo || null,
      });
    } else {
      // A factura asked for on an earlier try of this same checkout is withdrawn.
      await api.setCheckoutInvoiceReceiver(key.data, null).catch(() => null);
    }
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { error: messageOf(error), values };
  }

  // Places the order exactly as before; on success it redirects to the order page.
  const result = await placeOrder(previous, formData);
  return { ...result, values };
}
