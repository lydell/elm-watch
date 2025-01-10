// This file is used during testing only.
// In production we load the compiled version of PostprocessWorker.ts directly.
import { register } from "tsx/esm/api";
const unregister = register();
await import("./PostprocessWorker.ts");
unregister();
