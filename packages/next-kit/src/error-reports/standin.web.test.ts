import { it } from "vitest";
import { serverScenarios } from "./standin-scenarios";

// The stand-in tracker test for this website's server (see standin-scenarios.ts).
it("the server's reports reach the stand-in tracker with no personal data", async () => {
  await serverScenarios("web");
}, 30_000);
