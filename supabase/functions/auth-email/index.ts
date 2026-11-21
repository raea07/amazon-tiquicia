// Edge Function: Supabase Auth's Send Email Hook. Renders the account e-mail
// (confirmation, password reset, e-mail change, security notices) and sends it
// through Bird at once. The hook's signature (SEND_EMAIL_HOOK_SECRETS) is the
// authentication: deployed with verify_jwt = false.

import {
  configFromEnv,
  createAuthEmailHandler,
} from "../../../packages/notifications/src/index.ts";

Deno.serve(createAuthEmailHandler(configFromEnv((name) => Deno.env.get(name))));
