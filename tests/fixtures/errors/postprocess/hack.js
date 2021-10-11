// In Jest tests, `import()` is unfortunately transpiled to `require`, which
// works differently. This hacks that difference away, in a way that should be
// easy to remove in the future when testing real `import()` is possible.
process.stdin.pipe(process.stdout);
module.exports = (f) => ({
  default: f,
});
