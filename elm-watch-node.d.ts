export type Postprocess = (options: {
  code: string;
  targetName: string;
  compilationMode: "debug" | "standard" | "optimize";
  runMode: "hot" | "make";
  argv: Array<string>;
}) => string | Promise<string>;
