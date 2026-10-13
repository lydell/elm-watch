import crossSpawn from "cross-spawn";
import path from "path";

const isInstall = process.argv.some((arg) =>
  arg.includes("ElmWatchNonExistentFile"),
);

if (isInstall) {
  const child = crossSpawn("elm", process.argv.slice(2), {
    env: {
      ...process.env,
      PATH: process.env.PATH.split(path.delimiter)
        .filter((part) => !part.includes("bad-bin"))
        .join(path.delimiter),
    },
    stdio: "inherit",
  });

  child.on("exit", (exitCode) => {
    process.exit(exitCode);
  });
}

export default !isInstall;
