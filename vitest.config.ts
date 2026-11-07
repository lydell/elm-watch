import { defineConfig } from "vitest/config";

// These are not goals, just a floor to notice when coverage drops. They are
// set to what the tests reached when upgrading to Vitest 5, which measures
// coverage more accurately than earlier versions (the code used to be at 100 %).
const requireCoverage = {
  branches: 94,
  functions: 98,
  lines: 98,
  statements: 98,
};

// Some things like symlinks can’t be tested on Windows.
const windowsCoverage = {
  branches: 90,
  functions: 95,
  lines: 95,
  statements: 95,
};

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
    coverage: {
      include: ["src/**/*.ts"],
      exclude: [
        // There is no need for tests for this file – it’s basically just re-exports.
        // It needs to be tested manually against the projects that use it anyway.
        "src/elm-watch-lib.ts",
      ],
      thresholds: {
        ...(process.platform === "win32" ? windowsCoverage : requireCoverage),
      },
    },
    setupFiles: ["tests/setupTests.ts"],
  },
});
