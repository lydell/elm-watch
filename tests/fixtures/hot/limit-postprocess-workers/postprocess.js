const fs = require("fs");
const path = require("path");

const lock = path.join(__dirname, "lock");

async function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

module.exports = async ([code]) => {
  if (fs.existsSync(lock)) {
    fs.unlinkSync(lock);
  } else {
    fs.writeFileSync(lock, "");
    while (fs.existsSync(lock)) {
      await wait(100);
    }
  }
  return code;
};
