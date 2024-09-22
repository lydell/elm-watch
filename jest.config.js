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

const ignoreCoverage = {
  branches: 0,
  functions: 0,
  lines: 0,
  statements: 0,
};

module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Increase the default timeout for each test from 5 seconds to 30 seconds.
  testTimeout: 30000,
  collectCoverageFrom: ["src/**/*.ts"],
  coverageThreshold: {
    global: process.platform === "win32" ? windowsCoverage : requireCoverage,
    // Jest reports 0% coverage for this file, while in reality it should be 100%.
    "./src/PostprocessWorker.ts": ignoreCoverage,
  },
};
