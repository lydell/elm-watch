if (process.argv[3] === "optimize") {
  process.exit(1);
} else {
  process.stdin.pipe(process.stdout);
}
