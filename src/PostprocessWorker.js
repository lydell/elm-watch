// This file is used during testing and when executing using `node -r esbuild-register` only.
// In production we load the compiled version of PostprocessWorker.ts directly.
require("esbuild-register/dist/node").register();
require("./PostprocessWorker.ts");
