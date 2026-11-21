/**
 * Development-only routes, for the browser journeys. Nothing like this exists
 * on Supabase.
 *
 *   GET  /dev/mail?to=<address>[&kind=<template>]  the latest e-mail "sent" to an address
 *   POST /dev/settings  {"confirm_email":"on", …}  switch Auth settings (see auth/settings.ts)
 */

import { SETTING_KEYS, type SettingKey, saveSetting } from "../auth/settings.ts";
import { HttpError, pool, type Routes, readJson, send } from "../context.ts";

export const devRoutes: Routes = async ({ req, res, url, route }) => {
  if (route === "GET /dev/mail") {
    const to = (url.searchParams.get("to") ?? "").toLowerCase();
    const kind = url.searchParams.get("kind");
    const { rows } = await pool.query(
      `select id, sent_at, to_address as to, kind, subject, body, token, token_hash, link
       from dev_standin.mailbox where to_address = $1 and ($2::text is null or kind = $2)
       order by id desc limit 1`,
      [to, kind],
    );
    if (!rows[0]) throw new HttpError(404, { message: "No e-mail for that address" });
    send(res, 200, rows[0]);
    return true;
  }

  if (route === "POST /dev/settings") {
    const body = await readJson(req);
    for (const [key, value] of Object.entries(body)) {
      if (!SETTING_KEYS.includes(key as SettingKey)) {
        throw new HttpError(400, { message: `Unknown setting ${key}` });
      }
      await saveSetting(key as SettingKey, String(value));
    }
    send(res, 204);
    return true;
  }

  return false;
};
