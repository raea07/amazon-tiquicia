"use server";

/**
 * The free complaint form (docs/06-operations/customer-service.md,
 * "Complaints"): linked from the footer of every page and from each order.
 * It calls file_complaint, which needs an account, checks that the order is
 * the shopper's own, counts the same open complaint once and caps open
 * complaints per account; these checks only give a good message first.
 * Once filed, the shopper reads the reference and the dates by which the
 * acknowledgement and the written answer are promised (my_complaint_receipt).
 */

import { checkComplaint, complaintFiledText } from "@yuntera/core";
import { type ActionState, attempt, typed } from "@yuntera/next-kit/server";
import { formatDate } from "@yuntera/ui";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getViewer, signInUrl } from "@/lib/session";
import { sessionApi } from "@/lib/supabase";

export async function fileComplaint(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "category", "description", "orderNumber");
  const checked = checkComplaint({
    category: values.category,
    description: values.description ?? "",
    orderNumber: values.orderNumber,
  });
  if ("error" in checked) return { error: checked.error, values };
  if (!(await getViewer())) {
    redirect(
      signInUrl(
        checked.input.orderNumber ? `/reclamo?pedido=${checked.input.orderNumber}` : "/reclamo",
      ),
    );
  }

  const state = await attempt(async () => {
    const api = await sessionApi();
    const complaintId = await api.fileComplaint(checked.input);
    const receipt = await api.myComplaintReceipt(complaintId);
    return complaintFiledText({
      reference: receipt.reference,
      acknowledgeBy: formatDate(receipt.acknowledge_by),
      answerBy: formatDate(receipt.answer_by),
    });
  }, values);
  // The order's page and the account list the new case.
  if (state.ok) refresh();
  return state;
}
