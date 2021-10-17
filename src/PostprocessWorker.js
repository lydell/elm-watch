// This file is used during testing and when executing using `ts-node` only.
// In production we load the compiled version of PostprocessWorker.ts directly.
require("ts-node/register/transpile-only");
require("./PostprocessWorker.ts");
