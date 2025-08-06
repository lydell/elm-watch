import { defineConfig } from "vite";

const requireCoverage = {
  branches: 100,
  functions: 100,
  lines: 100,
  statements: 100,
};

// Some things like symlinks can’t be tested on Windows.
const windowsCoverage = {
  branches: 97,
  functions: 97,
  lines: 97,
  statements: 97,
};

export default defineConfig({
  test: {
    // Increase the default timeout for each test from 5 seconds to 30 seconds.
    testTimeout: 30000,
    environmentOptions: {
      jsdom: {
        url: "http://localhost",
      },
    },
    include: ["tests/*.test.ts"],
    coverage: {
      include: ["src/**/*.ts"],
      exclude: [
        // Vitest reports 0 % coverage for this file, while in reality it should be 100 %.
        "src/PostprocessWorker.ts",
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
