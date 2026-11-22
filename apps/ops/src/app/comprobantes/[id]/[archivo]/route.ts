import { invoiceFileResponse } from "@yuntera/next-kit/server";

/** The signed XML (`xml`) or Hacienda's answer (`respuesta`) of any document, for finance. */
export async function GET(
  _request: Request,
  context: RouteContext<"/comprobantes/[id]/[archivo]">,
) {
  const { id, archivo } = await context.params;
  return invoiceFileResponse(id, archivo, `/comprobantes/${id}`);
}
