/**
 * WEB-7: the deployment and local scripts refuse what would load demo data
 * into a hosted project or wipe a database that is not on this machine. Each
 * case stops before any request is made (no network, no database).
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const script = (name: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync("bash", [join(root, "supabase/scripts", name), ...args], {
    encoding: "utf8",
    // An unreachable API: if a guard failed, the request could not go anywhere.
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: "", HTTPS_PROXY: "http://127.0.0.1:9", ...env },
    timeout: 20_000,
  });

describe("WEB-7: demo data reaches a hosted project only through the guarded seed", () => {
  it("remote-db.sh sql refuses the seed", () => {
    const run = script("remote-db.sh", ["sql", "some-project", join(root, "supabase/seed.sql")]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("remote-db.sh seed");
  });

  it("remote-db.sh sql refuses a copy of the seed under another name", () => {
    const copy = join(mkdtempSync(join(tmpdir(), "yuntera-")), "datos.sql");
    copyFileSync(join(root, "supabase/seed.sql"), copy);
    const run = script("remote-db.sh", ["sql", "some-project", copy]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("creates demo accounts");
  });

  it("remote-db.sh sql refuses the local shim and the suites", () => {
    for (const file of ["supabase/scripts/local-shim.sql", "supabase/tests/110_lockdown.sql"]) {
      const run = script("remote-db.sh", ["sql", "some-project", join(root, file)]);
      expect(run.status, file).toBe(1);
      expect(run.stderr, file).toMatch(/^Refusing/m);
    }
  });

  it("the seed's guard is marked so the contract tests can run it on its own", () => {
    // packages/db/src/contract.web-followups.test.ts runs this block against a
    // database with the local shim's schema hidden and expects the refusal.
    const seed = readFileSync(join(root, "supabase/seed.sql"), "utf8");
    const guard = seed.slice(
      seed.indexOf("-- seed-guard:begin"),
      seed.indexOf("-- seed-guard:end"),
    );
    expect(guard).toContain("nspname = 'dev_standin'");
    expect(seed.indexOf("-- seed-guard:begin")).toBeLessThan(seed.indexOf("pg_temp.seed_user"));
  });

  it("auth-config.sh applies the preview settings only to a project named twice", () => {
    const run = script("auth-config.sh", ["apply", "some-project", "preview"]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("YUNTERA_PREVIEW_CONFIRM=some-project");
  });

  it("local-db.sh reset refuses a database server that is not this machine", () => {
    const run = script("local-db.sh", ["reset"], {
      PG_ADMIN_URL: "postgres://postgres:secret@db.abcdefghij.supabase.co:5432/postgres",
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("is not this machine");
  });

  it("WEB-7: local-db.sh reset refuses a remote host it cannot read from the URL's host part", () => {
    // Review of 22 November: these passed the old guard, and psql went on to
    // connect to the remote server to drop the database.
    for (const [url, message] of [
      [
        "postgres:///postgres?host=192.0.2.1&connect_timeout=2&user=postgres",
        "is not this machine",
      ],
      ["postgres:///postgres?hostaddr=192.0.2.1", "is not this machine"],
      ["host=db.abcdefghij.supabase.co user=postgres", "must be a postgres:// URL"],
    ] as const) {
      const run = script("local-db.sh", ["reset"], { PG_ADMIN_URL: url, PG_DB_NAME: "zz_never" });
      expect(run.status, url).toBe(1);
      expect(run.stderr, url).toContain(message);
      expect(run.stderr, url).not.toContain("connection to server");
    }
    // No host in the URL: psql would use PGHOST, so that is checked too.
    const run = script("local-db.sh", ["reset"], {
      PG_ADMIN_URL: "postgres:///postgres",
      PG_DB_NAME: "zz_never",
      PGHOST: "192.0.2.1",
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("is not this machine");
  });
});
