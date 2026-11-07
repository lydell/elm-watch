import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Increase the default timeout for each test from 5 seconds to 10 seconds.
    // The slowest tests take a few seconds when running all tests in parallel.
    testTimeout: 10000,
    environmentOptions: {
      jsdom: {
        url: "http://localhost",
      },
    },
    include: ["tests/*.test.ts"],
    // There are no coverage thresholds. Requiring 100 % coverage led to
    // complex, brittle tests and lots of ignore comments. Run `npm run coverage`
    // and look at the report to find untested code paths worth testing.
    coverage: {
      include: ["src/**/*.ts"],
      exclude: [
        // There is no need for tests for this file – it’s basically just re-exports.
        // It needs to be tested manually against the projects that use it anyway.
        "src/elm-watch-lib.ts",
        // The CLI entrypoint. The tests call `elmWatchCli` directly instead.
        "src/bin.ts",
      ],
    },
    setupFiles: ["tests/setupTests.ts"],
  },
});
