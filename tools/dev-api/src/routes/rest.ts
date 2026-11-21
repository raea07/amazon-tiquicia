/** Database function calls: `POST /rest/v1/rpc/<function>`. */

import { authenticate, HttpError, pool, type Routes, readJson, send } from "../context.ts";
import { callRpc } from "../rpc.ts";

export const restRoutes: Routes = async ({ req, res, url }) => {
  const rpc = /^\/rest\/v1\/rpc\/([^/]+)$/.exec(url.pathname);
  if (rpc?.[1] && req.method === "POST") {
    const claims = await authenticate(req);
    const result = await callRpc(pool, rpc[1], await readJson(req), claims);
    if (result.ok) send(res, result.data === null ? 204 : 200, result.data ?? undefined);
    else send(res, result.status, result.error);
    return true;
  }
  if (url.pathname.startsWith("/rest/v1/")) {
    // The apps reach the database only through functions, so table endpoints
    // are deliberately not provided here.
    throw new HttpError(404, {
      code: "PGRST205",
      message: "This local stand-in serves /rest/v1/rpc/* only; apps call database functions.",
    });
  }
  return false;
};
