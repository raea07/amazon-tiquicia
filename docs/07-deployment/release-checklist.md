# Release checklist

Three short lists, one per kind of release. Each is done by one person, in
order, and ends with the same check. The longer reasons live in
[operations](operations.md#migrations-policy), the
[first-deploy runbook](runbook-first-deploy.md) and
[store testing](store-testing.md). The paths to walk on a phone are in
[phone-test-plan.md](phone-test-plan.md).

"The preview" is the hosted preview project. Until production exists, every
release goes there only.

## A web deploy (shop, seller centre, console, field app)

1. If the change needs a database migration, release the migration first
   (next list) and wait until it is done.
2. Run `pnpm lint && pnpm typecheck && pnpm test` on the commit to deploy.
3. Run the journeys that touch what changed: `tools/dev/stack.sh up <lane>`,
   then `tools/dev/stack.sh e2e <lane> <journey…>`, then
   `tools/dev/stack.sh down <lane>`.
4. If a setting is new, add it in Vercel to each app that reads it, before the
   deploy. Never put a secret in a `NEXT_PUBLIC_` setting.
5. If the console is deployed for the first time with Versiones, set
   `YUNTERA_SELLER_URL` and `YUNTERA_FIELD_URL` on the console project (the
   seller centre's and the field app's addresses). Vercel gives each app its
   own commit (`VERCEL_GIT_COMMIT_SHA`) by itself.
6. Deploy the four apps from the same commit.
7. Open the shop, the seller centre, the console and the field app once each.
8. In the console, open **Salud del sistema → Versiones**: each web app shows
   the commit just deployed.
9. Check that Salud del sistema shows no problem.

## A database migration

1. The migration is a new file; no file that was ever applied is edited.
2. Run `pnpm db:local:reset && pnpm db:local:test` and the contract tests
   (`DATABASE_URL=… pnpm --filter @yuntera/db test`) in a lane.
3. Run the journeys that touch the changed functions in a lane.
4. If a function the store build of the shopper app calls changed, check its
   answer still parses with that build's schemas (new optional fields only).
5. Take a fresh export of the database (operations.md, "Backups").
6. Run `supabase/scripts/remote-db.sh status <project-ref>`: only the new
   files are pending.
7. Run `supabase/scripts/remote-db.sh push <project-ref>`.
8. Run `supabase/scripts/remote-db.sh test <project-ref>`.
9. In the console, open **Salud del sistema → Versiones**: the database's
   last change is the new file.
10. Check that Salud del sistema shows no problem.

## A phone build

1. Run the native journeys of the app: `tools/dev/stack.sh native <lane> <app>`,
   then `tools/dev/stack.sh native-e2e <lane> <journey…>`.
2. Note the commit; the build is made from it and from nothing else.
3. Raise the build number in the app's configuration only if the build tool
   does not raise it by itself.
4. Make the build and send it to internal testing (store-testing.md).
5. Install it on one iPhone and one Android phone.
6. Walk the app's paths in [phone-test-plan.md](phone-test-plan.md) on each
   phone. If one fails, report it with the "Problema encontrado" form and
   stop: the build does not go further.
7. In the console, open **Salud del sistema → Versiones** and record the build:
   app, platform, version, build number, day, "Prueba interna". If you typed
   one wrong, remove it with "Quitar esta versión" and record it again.
8. When the build goes public, record it again with "Pública en la tienda".
9. Check that Salud del sistema shows no problem.
