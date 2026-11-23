// The app's logo actions say what the seller centre says, and are offered when it offers them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  LOGO_NOTHING_TO_REMOVE,
  LOGO_REMOVED,
  LOGO_WITHDRAWN,
  logoActions,
  REMOVE_LOGO_CONFIRM,
  REMOVE_LOGO_CONFIRM_NEEDED,
  REMOVE_LOGO_LABEL,
  removedText,
  WITHDRAW_LOGO_LABEL,
} from "./logo-actions";

const centre = ["app/logo-actions.ts", "components/logo-manager.tsx", "app/tienda/page.tsx"]
  .map((path) => readFileSync(join(__dirname, "../../../seller/src", path), "utf8"))
  .join("\n")
  .replace(/\s+/g, " ");

describe("logo actions in the seller app", () => {
  it("uses the seller centre's words", () => {
    for (const words of [
      WITHDRAW_LOGO_LABEL,
      LOGO_WITHDRAWN,
      REMOVE_LOGO_LABEL,
      REMOVE_LOGO_CONFIRM,
      REMOVE_LOGO_CONFIRM_NEEDED,
      LOGO_REMOVED,
      LOGO_NOTHING_TO_REMOVE,
    ]) {
      assert.ok(centre.includes(words), `not in the seller centre: ${words}`);
    }
  });

  it("offers withdrawing only for a logo waiting for review, removing only when one is shown", () => {
    const waiting = { state: "pending" };
    assert.deepEqual(logoActions({ can_edit: true, logo: null, logo_waiting: waiting }), {
      withdraw: true,
      remove: false,
    });
    assert.deepEqual(logoActions({ can_edit: true, logo: { path: "x" }, logo_waiting: null }), {
      withdraw: false,
      remove: true,
    });
    assert.deepEqual(
      logoActions({ can_edit: true, logo: { path: "x" }, logo_waiting: { state: "approved" } }),
      { withdraw: false, remove: true },
    );
    // A member who is not the owner or an administrator gets neither.
    assert.deepEqual(logoActions({ can_edit: false, logo: { path: "x" }, logo_waiting: waiting }), {
      withdraw: false,
      remove: false,
    });
    assert.ok(centre.includes('front.logo_waiting?.state === "pending" ? <WithdrawLogoForm />'));
    assert.ok(centre.includes("front.logo ? <RemoveLogoForm />"));
  });

  it("says whether there was a logo to remove", () => {
    assert.equal(removedText(true), LOGO_REMOVED);
    assert.equal(removedText(false), LOGO_NOTHING_TO_REMOVE);
  });
});
