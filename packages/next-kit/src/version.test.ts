import { describe, expect, it } from "vitest";
import { LOCAL_GUARD_KEY } from "./guard";
import {
  buildCommit,
  builtCommit,
  fetchAppVersion,
  VERSION_HEADER,
  versionProof,
  versionResponse,
} from "./version";

const LOCAL = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  AUTH_GUARD_KEY: "k".repeat(40),
};
const SHA = "89f2422aa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5";

const ask = (proof?: string) =>
  new Request("http://127.0.0.1:3000/api/version", {
    headers: proof ? { [VERSION_HEADER]: proof } : {},
  });

describe("which commit an app was built from", () => {
  it("takes the lane's or the deployment's own value, in that order", () => {
    expect(buildCommit({ YUNTERA_BUILD_COMMIT: SHA, VERCEL_GIT_COMMIT_SHA: "abcdef1" })).toBe(SHA);
    expect(buildCommit({ VERCEL_GIT_COMMIT_SHA: SHA.toUpperCase() })).toBe(SHA);
    expect(buildCommit({})).toBeNull();
    // Anything that is not a commit is not shown.
    expect(buildCommit({ YUNTERA_BUILD_COMMIT: "main; rm -rf" })).toBeNull();
    // A value given at deploy time wins, even over a valid one of Vercel's:
    // given wrong, the answer is unknown, never another commit.
    expect(buildCommit({ YUNTERA_BUILD_COMMIT: "main", VERCEL_GIT_COMMIT_SHA: SHA })).toBeNull();
    expect(buildCommit({ YUNTERA_BUILD_COMMIT: "  ", VERCEL_GIT_COMMIT_SHA: SHA })).toBe(SHA);
  });

  it("answers the commit the build inlined, the same one the error reports name", async () => {
    const before = process.env.YUNTERA_BUILD_COMMIT;
    process.env.YUNTERA_BUILD_COMMIT = SHA;
    try {
      expect(builtCommit()).toBe(SHA);
      const right = versionResponse(
        "seller",
        ask(versionProof(LOCAL.AUTH_GUARD_KEY)),
        { ...LOCAL, YUNTERA_BUILD_COMMIT: "abcdef1" },
        builtCommit(),
      );
      expect(await right.json()).toEqual({ app: "seller", commit: SHA });
      process.env.YUNTERA_BUILD_COMMIT = "";
      expect(builtCommit()).toBeNull();
    } finally {
      process.env.YUNTERA_BUILD_COMMIT = before;
    }
  });

  it("is told only to a caller with the proof", async () => {
    const env = { ...LOCAL, YUNTERA_BUILD_COMMIT: SHA };
    expect(versionResponse("web", ask(), env).status).toBe(404);
    expect(versionResponse("web", ask("wrong"), env).status).toBe(404);
    const right = versionResponse("web", ask(versionProof(LOCAL.AUTH_GUARD_KEY)), env);
    expect(right.status).toBe(200);
    expect(right.headers.get("cache-control")).toBe("no-store");
    expect(await right.json()).toEqual({ app: "web", commit: SHA });
  });

  it("says nothing on a deployment without its key", () => {
    const deployed = { VERCEL: "1", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" };
    expect(versionResponse("ops", ask(versionProof(LOCAL_GUARD_KEY)), deployed).status).toBe(404);
  });

  it("asks another app, and says when it cannot", async () => {
    const answer = (status: number, body: unknown) =>
      (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await fetchAppVersion(undefined, LOCAL)).toEqual({ state: "not_configured" });
    expect(await fetchAppVersion("http://x", LOCAL, answer(200, { commit: SHA }))).toEqual({
      state: "known",
      commit: SHA,
    });
    expect(await fetchAppVersion("http://x", LOCAL, answer(200, { commit: null }))).toEqual({
      state: "unknown",
    });
    expect(await fetchAppVersion("http://x", LOCAL, answer(404, {}))).toEqual({
      state: "unreachable",
    });
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await fetchAppVersion("http://x", LOCAL, down)).toEqual({ state: "unreachable" });
  });
});
