async function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

module.exports = async ([code]) => {
  // This helps with test flakiness.
  await wait(50);
  return code;
};
