const requireCoverage = {
  branches: 100,
  functions: 100,
  lines: 100,
  statements: 100,
};

const ignoreCoverage = {
  branches: 0,
  functions: 0,
  lines: 0,
  statements: 0,
};

module.exports = {
  preset: "ts-jest",
  testEnvironment: "jest-environment-node-single-context",
  collectCoverageFrom: ["src/**/*.ts"],
  coverageThreshold: {
    global: requireCoverage,
    // Jest reports 0% coverage for this file, while in reality it should be 100%.
    "./src/PostprocessWorker.ts": ignoreCoverage,
  },
};
