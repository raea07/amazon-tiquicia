import { defineConfig } from "vitest/config";

// The contract files share one seeded database, and the operations races
// (src/contract.operations-races.test.ts) commit, for a moment, a shop with
// its delivery zones switched off. One file at a time, so no other file ever
// runs against that moment. Without DATABASE_URL every contract file skips
// itself, so the unit tests stay fast either way.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
