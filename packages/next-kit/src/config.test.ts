import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { baseConfig, buildInfo, errorTrackerIngest, securityHeaders } from "../config.mjs";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const API = "https://abcdefghijklmnop.supabase.co";

function policy(options = {}): Record<string, string> {
  const csp =
    securityHeaders(options).find((h) => h.key === "Content-Security-Policy")?.value ?? "";
  return Object.fromEntries(
    csp.split("; ").map((part) => {
      const [name = "", ...rest] = part.split(" ");
      return [name, rest.join(" ")];
    }),
  );
}

describe("WEB-9: the content-security policy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lets no page script call the API: connect-src is the app itself", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", API);
    expect(policy()["connect-src"]).toBe("'self'");
    // Pictures still come from the project's public storage.
    expect(policy()["img-src"]).toContain(`${API}/storage/v1/object/`);
  });

  it("lets the seller centre upload photos to signed upload addresses only", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", API);
    expect(policy({ photoUpload: true })["connect-src"]).toBe(
      `'self' ${API}/storage/v1/object/upload/sign/`,
    );
  });

  it("adds the human check's origin only when its site key is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(policy()["frame-src"]).toBe("'none'");
    expect(policy()["script-src"]).not.toContain("challenges.cloudflare.com");
    vi.stubEnv("NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY", "0x4AAAAAAAexample");
    expect(policy()["frame-src"]).toBe("https://challenges.cloudflare.com");
    expect(policy()["script-src"]).toContain("https://challenges.cloudflare.com");
  });

  it("allows the error tracker's one ingest address only when a tracker is configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(policy()["connect-src"]).toBe("'self'");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://0123abcd@o4508.ingest.us.sentry.io/4509876");
    expect(policy()["connect-src"]).toBe(
      "'self' https://o4508.ingest.us.sentry.io/api/4509876/envelope/",
    );
    // Scripts, frames and pictures never come from the tracker: no tunnel, no widget.
    for (const directive of ["script-src", "frame-src", "img-src", "default-src"]) {
      expect(policy()[directive], directive).not.toContain("sentry");
    }
    // A DSN with a secret in it, or plain http to another machine, is not used at all.
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://key:secret@o4508.ingest.us.sentry.io/4509876");
    expect(policy()["connect-src"]).toBe("'self'");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "http://key@ingest.example.com/1");
    expect(policy()["connect-src"]).toBe("'self'");
    // The local stand-in of the error-reports journey.
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "http://lane18@127.0.0.1:54686/18");
    expect(policy()["connect-src"]).toBe("'self' http://127.0.0.1:54686/api/18/envelope/");
  });

  it("keeps a self-hosted tracker's path in the ingest address", () => {
    expect(errorTrackerIngest("https://k@errors.example.com/sentry/7")?.connectSource).toBe(
      "https://errors.example.com/sentry/api/7/envelope/",
    );
  });

  it("names the commit and the environment of the build", () => {
    expect(buildInfo({ VERCEL_GIT_COMMIT_SHA: "a".repeat(40), VERCEL_ENV: "preview" })).toEqual({
      commit: "a".repeat(40),
      environment: "preview",
    });
    expect(
      buildInfo({ VERCEL_GIT_COMMIT_SHA: "abc1234", VERCEL_ENV: "production" }).environment,
    ).toBe("production");
    expect(
      buildInfo({ VERCEL_GIT_COMMIT_SHA: "abc1234", YUNTERA_LOCAL_RUN: "1" }).environment,
    ).toBe("local");
    expect(buildInfo({ VERCEL_GIT_COMMIT_SHA: "not a commit; rm -rf" }).commit).toBe("unknown");
    // The value given at deploy time wins; nothing given is unknown, never a guess.
    expect(
      buildInfo({ YUNTERA_BUILD_COMMIT: "b".repeat(40), VERCEL_GIT_COMMIT_SHA: "a".repeat(40) })
        .commit,
    ).toBe("b".repeat(40));
    expect(buildInfo({}).commit).toBe("unknown");
    expect(baseConfig({ app: "web" }).env).toHaveProperty("YUNTERA_BUILD_COMMIT");
    expect(baseConfig({ app: "web" }).env).not.toHaveProperty("YUNTERA_COMMIT");
  });

  it("says which app it is, for the session lifetime", () => {
    expect(baseConfig({ app: "ops" }).env).toMatchObject({ YUNTERA_APP: "ops" });
    for (const app of ["web", "seller", "ops", "field"]) {
      expect(read(`../../../apps/${app}/next.config.ts`)).toContain(`app: "${app}"`);
    }
    expect(read("../../../apps/seller/next.config.ts")).toContain("photoUpload: true");
  });
});

describe("WEB-9: continuous integration", () => {
  const workflow = read("../../../.github/workflows/ci.yml");

  it("pins every action to a commit, not a tag", () => {
    const uses = [...workflow.matchAll(/uses:\s*(\S+)/g)].map((match) => match[1] ?? "");
    expect(uses.length).toBeGreaterThan(5);
    for (const action of uses) expect(action, action).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it("is read-only and gives a pull request from a fork nothing more", () => {
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(workflow).not.toMatch(/^\s*pull_request_target:/m);
    expect(workflow).not.toMatch(/secrets\./);
    expect(workflow).not.toMatch(/permissions:\s*write-all|: write/);
  });
});
