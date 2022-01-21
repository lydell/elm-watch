async function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

module.exports = async ([code, targetName]) => {
  if (targetName === "Main4") {
    // This helps with test flakiness.
    await wait(100);
    return code;
  }
  return code;
};
