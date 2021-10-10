module.exports = {
  preset: "ts-jest",
  testEnvironment: "jest-environment-node-single-context",
  collectCoverageFrom: ["src/**/*.ts"],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
};
