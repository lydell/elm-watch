// This file is used during testing and when executing using `ts-eager` only.
// In production we load the compiled version of PostprocessWorker.ts directly.
require("ts-eager/register");
require("./PostprocessWorker.ts");
