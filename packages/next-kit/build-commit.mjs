/**
 * Which commit a web app was built from: ONE value with ONE rule, used by
 * the console's Versiones panel (src/version.ts) and by the error reports'
 * release name (src/error-reports). No Node.js imports, so any code may use it.
 *
 * The rule, read once when the app is built (config.mjs inlines the answer
 * as YUNTERA_BUILD_COMMIT into the server and the browser code alike):
 *   1. YUNTERA_BUILD_COMMIT, when the deployment gives it: it wins. The
 *      runbook's `vercel deploy` passes it (docs/07-deployment/
 *      runbook-first-deploy.md), and tools/dev/stack.sh writes it for a lane.
 *      Given but not a commit, the answer is "unknown", never another value.
 *   2. Otherwise VERCEL_GIT_COMMIT_SHA, which Vercel documents as the commit
 *      a deployment was triggered by (a deployment from a Git connection).
 *   3. Otherwise unknown (null). No guess from `git`: a deployment uploaded
 *      by the CLI has no .git folder, and a local checkout may hold changes
 *      that are not in its HEAD, so a guess could name the wrong commit.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string | null} a commit of 7 to 40 hexadecimal characters, or null
 */
export function commitFrom(env) {
  const valid = (/** @type {string | undefined} */ value) => {
    const v = (value ?? "").trim().toLowerCase();
    return /^[0-9a-f]{7,40}$/.test(v) ? v : null;
  };
  const explicit = (env.YUNTERA_BUILD_COMMIT ?? "").trim();
  if (explicit) return valid(explicit);
  return valid(env.VERCEL_GIT_COMMIT_SHA);
}
