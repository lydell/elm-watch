import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Increase the default timeout for each test from 5 seconds to 30 seconds.
    // The slowest tests take 2-4 seconds alone, but up to 10 seconds when
    // running all tests in parallel.
    testTimeout: 30000,
    // The tests are CPU bound (lots of `elm make`). Vitest’s default (number
    // of cores minus one) oversubscribes the CPU, making every test slower
    // and the whole run slower too: On a 14-core machine (10 performance
    // cores), 13 workers took ~49 s, while 8–10 workers took ~34–38 s.
    // On CI, use Vitest’s default, since CI runners only have a few cores.
    ...(process.env["CI"] === undefined ? { maxWorkers: 9 } : {}),
    environmentOptions: {
      jsdom: {
        url: "http://localhost",
      },
    },
    include: ["tests/*.test.ts"],
    // There are no coverage thresholds. Requiring 100 % coverage led to
    // complex, brittle tests and lots of ignore comments. Run `node --run coverage`
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
