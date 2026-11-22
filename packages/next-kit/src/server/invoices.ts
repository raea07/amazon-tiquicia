import "server-only";
import { ApiError } from "@yuntera/db";
import { signInPath } from "../paths";
import { getViewer } from "./session";
import { sessionApi } from "./supabase";

const NEVER_CACHED = { "Cache-Control": "private, no-store, max-age=0" };

const text = (status: number, message: string) =>
  new Response(message, {
    status,
    headers: { ...NEVER_CACHED, "Content-Type": "text/plain; charset=utf-8" },
  });

/**
 * A file of an electronic invoice, for download: the signed XML ("xml") or
 * Hacienda's answer ("respuesta"). The database decides who may read it (the
 * shopper, the shop's team or finance, for their own documents only); this
 * only turns the answer into a download that no cache keeps.
 */
export async function invoiceFileResponse(
  id: string,
  file: string,
  returnTo: string,
): Promise<Response> {
  if (!(await getViewer())) {
    return new Response(null, {
      status: 307,
      headers: { ...NEVER_CACHED, Location: signInPath(returnTo) },
    });
  }
  const kind = file === "xml" ? "xml" : file === "respuesta" ? "response" : null;
  if (!kind || !/^[0-9a-f-]{36}$/i.test(id)) return text(404, "No encontramos ese archivo.");
  try {
    const found = await (await sessionApi()).invoiceFile(id, kind);
    return new Response(found.content, {
      headers: {
        ...NEVER_CACHED,
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${found.file_name}"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === "invoice_not_found") {
      return text(404, error.userMessage("es-CR"));
    }
    if (error instanceof ApiError && error.code === "invoice_file_not_ready") {
      return text(409, error.userMessage("es-CR"));
    }
    console.error(error);
    return text(500, "No pudimos preparar el archivo. Inténtelo de nuevo en un momento.");
  }
}
