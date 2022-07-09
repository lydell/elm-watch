const globals = require("globals");
const { builtinModules } = require("module");

const error = "error";
const warn = process.argv.includes("--report-unused-disable-directives")
  ? "error"
  : "warn";

module.exports = {
  root: true,
  plugins: ["@typescript-eslint", "simple-import-sort", "jest"],
  reportUnusedDisableDirectives: true,
  env: {
    es2020: true,
    node: true,
  },
  rules: {
    "arrow-body-style": warn,
    "default-case-last": warn,
    "for-direction": error,
    "no-caller": error,
    "no-case-declarations": error,
    "no-compare-neg-zero": error,
    "no-console": warn,
    "no-constant-binary-expression": error,
    "no-constant-condition": error,
    "no-debugger": warn,
    "no-dupe-else-if": error,
    "no-duplicate-case": error,
    "no-empty-character-class": warn,
    "no-empty-pattern": warn,
    "no-empty": warn,
    "no-eval": error,
    "no-invalid-regexp": error,
    "no-labels": error,
    "no-misleading-character-class": error,
    "no-nonoctal-decimal-escape": error,
    "no-octal-escape": error,
    "no-param-reassign": error,
    "no-promise-executor-return": error,
    "no-prototype-builtins": error,
    "no-regex-spaces": error,
    "no-restricted-syntax": [
      error,
      {
        selector: "SequenceExpression",
        message:
          "The comma operator is confusing and a common mistake. Don’t use it!",
      },
      {
        selector: `CallExpression[callee.property.name="then"] > :nth-child(2)`,
        message:
          "Use .then(onSuccess).catch(onError) instead of .then(onSuccess, onError)",
      },
    ],
    "no-self-compare": error,
    "no-sparse-arrays": error,
    "no-template-curly-in-string": error,
    "no-unmodified-loop-condition": error,
    "no-unneeded-ternary": warn,
    "no-unsafe-finally": error,
    "no-useless-backreference": error,
    "no-useless-catch": error,
    "no-useless-computed-key": warn,
    "no-useless-concat": warn,
    "no-useless-escape": error,
    "no-useless-rename": warn,
    "no-var": error,
    "object-shorthand": warn,
    "prefer-arrow-callback": warn,
    "prefer-const": warn,
    "prefer-destructuring": [warn, { object: true, array: false }],
    "prefer-exponentiation-operator": warn,
    "prefer-numeric-literals": warn,
    "prefer-object-spread": warn,
    "prefer-promise-reject-errors": error,
    "prefer-regex-literals": warn,
    "prefer-rest-params": warn,
    "prefer-spread": warn,
    "prefer-template": warn,
    "simple-import-sort/exports": warn,
    "simple-import-sort/imports": warn,
    "use-isnan": error,
    curly: warn,
    eqeqeq: warn,
    yoda: warn,
  },
  overrides: [
    {
      files: "*.ts",
      parser: "@typescript-eslint/parser",
      parserOptions: {
        sourceType: "module",
        tsconfigRootDir: __dirname,
        project: ["./tsconfig.json"],
      },
      rules: {
        "@typescript-eslint/adjacent-overload-signatures": warn,
        "@typescript-eslint/array-type": [warn, { default: "generic" }],
        "@typescript-eslint/await-thenable": error,
        "@typescript-eslint/ban-ts-comment": error,
        "@typescript-eslint/ban-types": error,
        "@typescript-eslint/consistent-generic-constructors": warn,
        "@typescript-eslint/consistent-type-assertions": [
          error,
          {
            assertionStyle: "as",
            objectLiteralTypeAssertions: "never",
          },
        ],
        "@typescript-eslint/consistent-type-definitions": [warn, "type"],
        "@typescript-eslint/default-param-last": warn,
        "@typescript-eslint/dot-notation": warn,
        "@typescript-eslint/explicit-function-return-type": [
          warn,
          { allowExpressions: true },
        ],
        "@typescript-eslint/lines-between-class-members": warn,
        "@typescript-eslint/method-signature-style": warn,
        "@typescript-eslint/no-array-constructor": warn,
        "@typescript-eslint/no-base-to-string": error,
        "@typescript-eslint/no-confusing-void-expression": error,
        "@typescript-eslint/no-dupe-class-members": error,
        "@typescript-eslint/no-empty-function": warn,
        "@typescript-eslint/no-empty-interface": warn,
        "@typescript-eslint/no-explicit-any": warn,
        "@typescript-eslint/no-floating-promises": error,
        "@typescript-eslint/no-for-in-array": warn,
        "@typescript-eslint/no-implied-eval": error,
        "@typescript-eslint/no-inferrable-types": [
          warn,
          { ignoreParameters: true },
        ],
        "@typescript-eslint/no-invalid-this": error,
        "@typescript-eslint/no-invalid-void-type": error,
        "@typescript-eslint/no-loss-of-precision": error,
        "@typescript-eslint/no-misused-promises": error,
        "@typescript-eslint/no-namespace": error,
        "@typescript-eslint/no-non-null-assertion": error,
        "@typescript-eslint/no-redundant-type-constituents": error,
        "@typescript-eslint/no-require-imports": error,
        "@typescript-eslint/no-shadow": error,
        "@typescript-eslint/no-this-alias": warn,
        "@typescript-eslint/no-throw-literal": error,
        "@typescript-eslint/no-unnecessary-boolean-literal-compare": warn,
        "@typescript-eslint/no-unnecessary-type-arguments": warn,
        "@typescript-eslint/no-unnecessary-type-assertion": warn,
        "@typescript-eslint/no-unnecessary-type-constraint": error,
        "@typescript-eslint/no-unsafe-argument": error,
        "@typescript-eslint/no-unsafe-assignment": error,
        "@typescript-eslint/no-unsafe-call": error,
        "@typescript-eslint/no-unsafe-member-access": error,
        "@typescript-eslint/no-unsafe-return": error,
        "@typescript-eslint/no-unused-expressions": error,
        "@typescript-eslint/no-unused-vars": [
          error,
          { args: "all", argsIgnorePattern: "^_", caughtErrors: "all" },
        ],
        "@typescript-eslint/no-useless-empty-export": warn,
        "@typescript-eslint/no-var-requires": error,
        "@typescript-eslint/prefer-as-const": warn,
        "@typescript-eslint/prefer-for-of": warn,
        "@typescript-eslint/prefer-function-type": warn,
        "@typescript-eslint/prefer-includes": warn,
        "@typescript-eslint/prefer-nullish-coalescing": warn,
        "@typescript-eslint/prefer-optional-chain": warn,
        "@typescript-eslint/prefer-reduce-type-parameter": warn,
        "@typescript-eslint/prefer-regexp-exec": warn,
        "@typescript-eslint/prefer-string-starts-ends-with": warn,
        "@typescript-eslint/promise-function-async": [
          error,
          { checkArrowFunctions: false },
        ],
        "@typescript-eslint/require-await": error,
        "@typescript-eslint/restrict-plus-operands": error,
        "@typescript-eslint/restrict-template-expressions": error,
        "@typescript-eslint/return-await": error,
        "@typescript-eslint/sort-type-union-intersection-members": warn,
        "@typescript-eslint/strict-boolean-expressions": [
          error,
          {
            allowString: false,
            allowNumber: false,
            allowNullableObject: false,
          },
        ],
        "@typescript-eslint/switch-exhaustiveness-check": error,
        "@typescript-eslint/triple-slash-reference": warn,
        "@typescript-eslint/unbound-method": error,
        "@typescript-eslint/unified-signatures": warn,
      },
    },
    {
      files: ["src/**/*.ts", "scripts/**/*.ts"],
      rules: {
        "no-restricted-globals": [
          error,
          ...new Set(
            [
              ...Object.keys(globals.browser),
              ...Object.keys(globals.jest),
            ].filter(
              (name) =>
                !Object.prototype.hasOwnProperty.call(globals.node, name)
            )
          ),
        ],
      },
    },
    {
      files: "client/**/*.ts",
      rules: {
        "no-restricted-imports": [error, ...builtinModules],
        "no-restricted-globals": [
          error,
          ...new Set(
            [...Object.keys(globals.node), ...Object.keys(globals.jest)].filter(
              (name) =>
                !Object.prototype.hasOwnProperty.call(globals.browser, name)
            )
          ),
        ],
      },
    },
    {
      files: "tests/**/*.ts",
      extends: ["plugin:jest/recommended", "plugin:jest/style"],
      rules: {
        "jest/no-standalone-expect": [
          "error",
          { additionalTestBlockFunctions: ["testExceptWindows"] },
        ],
      },
    },
    {
      files: "example/**/*.js",
      parserOptions: {
        sourceType: "module",
      },
      rules: {
        "no-console": "off",
      },
    },
  ],
};
