import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { describe, expect, test } from "vitest";

import { DOCS_LINK_KEYS, docsLink } from "../src/DocsLinks.ts";

const ROOT = path.join(import.meta.dirname, "..");
const DOCS_DIR = path.join(ROOT, "docs", "v2");
const DOCS_URL = "https://lydell.github.io/elm-watch/v2/";

const links = new Map(
  Object.entries(
    JSON.parse(
      fs.readFileSync(
        path.join(ROOT, "docs", "_data", "v2_links.json"),
        "utf8",
      ),
    ) as Record<string, string>,
  ),
);

// Mimics kramdown’s auto-generated header IDs.
function headingIds(markdown: string): Set<string> {
  const ids = new Set<string>();
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    const match = /^#+ (.*?)(?: \{#([\w-]+)\})?$/.exec(line);
    if (inFence || match === null) {
      continue;
    }
    const [, text = "", explicitId] = match;
    if (explicitId !== undefined) {
      ids.add(explicitId);
      continue;
    }
    const base = text
      .split("`")
      .map((part, index) =>
        // Outside code: Remove link syntax and emphasis, and dashes (`--` and
        // `---` become en and em dashes, which are removed below).
        index % 2 === 1
          ? part
          : part
              .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
              .replace(/(^|\W)[*_]+|[*_]+(?=\W|$)/g, "$1")
              .replace(/-{2,3}/g, ""),
      )
      .join("")
      .replace(/^[^a-zA-Z]+/, "")
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .replace(/ /g, "-")
      .toLowerCase();
    let id = base;
    for (let i = 1; ids.has(id); i++) {
      id = `${base}-${i}`;
    }
    ids.add(id);
  }
  return ids;
}

// Returns an error message, or undefined if the docs page and anchor exist.
// `target` is relative to /v2/, like in v2_links.json.
function checkTarget(target: string): string | undefined {
  const [pagePath = "", anchor] = target.split("#");
  const page = pagePath.replace(/\/$/, "");
  const file = path.join(DOCS_DIR, `${page === "" ? "index" : page}.md`);
  if (!fs.existsSync(file)) {
    return `no such page: ${target}`;
  }
  if (
    anchor !== undefined &&
    !headingIds(fs.readFileSync(file, "utf8")).has(anchor)
  ) {
    return `no such heading: ${target}`;
  }
  return undefined;
}

// Only files that aren't ignored by git: Compiled output (such as the
// examples’ build folders) contains elm-watch’s client, including the
// `docsLink` template string.
function filesIn(dir: string, extensions: Array<string>): Array<string> {
  return childProcess
    .execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "."],
      { cwd: path.join(ROOT, dir), encoding: "utf8" },
    )
    .split("\0")
    .filter(
      (file) =>
        file !== "" && extensions.some((extension) => file.endsWith(extension)),
    )
    .map((file) => path.join(dir, file));
}

function read(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

describe("docs links", () => {
  test("docsLink() points to the link page in the docs checked here", () => {
    expect(docsLink("home")).toBe(`${DOCS_URL}link#home`);
  });

  test("every key used by elm-watch is in v2_links.json", () => {
    expect(DOCS_LINK_KEYS.filter((key) => !links.has(key))).toEqual([]);
  });

  test("every key in v2_links.json points to an existing page and heading", () => {
    expect(
      Array.from(links).flatMap(([key, target]) => {
        const error = checkTarget(target);
        return error === undefined ? [] : [`${key}: ${error}`];
      }),
    ).toEqual([]);
  });

  test("elm-watch uses docsLink() instead of linking directly to the docs", () => {
    expect(
      [...filesIn("src", [".ts"]), ...filesIn("client", [".ts", ".js"])].filter(
        (file) =>
          file !== path.join("src", "DocsLinks.ts") &&
          read(file).includes("lydell.github.io/elm-watch"),
      ),
    ).toEqual([]);
  });

  test("direct links to the docs point to existing pages and headings", () => {
    const files = [
      "README.md",
      ...filesIn("examples", [".md", ".ts", ".js", ".mjs", ".mts"]),
      ...filesIn(path.join("docs", "v2"), [".md"]),
    ];
    expect(
      files.flatMap((file) =>
        Array.from(
          read(file).matchAll(
            /https:\/\/lydell\.github\.io\/elm-watch\/v2\/([^\s)"'`<>]*)/g,
          ),
          ([url, target = ""]) => {
            if (target.startsWith("link#")) {
              return links.has(target.slice("link#".length))
                ? undefined
                : `${file}: unknown link key: ${url}`;
            }
            const error = checkTarget(target);
            return error === undefined ? undefined : `${file}: ${error}`;
          },
        ).filter((error) => error !== undefined),
      ),
    ).toEqual([]);
  });

  test("relative links between docs pages point to existing pages and headings", () => {
    expect(
      filesIn(path.join("docs", "v2"), [".md"]).flatMap((file) => {
        const page = path.basename(file, ".md");
        return Array.from(
          read(file).matchAll(/\]\(((?:\.\.\/|#)[^)\s]*)\)/g),
          ([, href = ""]) => {
            const target = href.startsWith("#")
              ? `${page === "index" ? "" : `${page}/`}${href}`
              : href.slice("../".length);
            const error = checkTarget(target);
            return error === undefined
              ? undefined
              : `${file}: ${error} (${href})`;
          },
        ).filter((error) => error !== undefined);
      }),
    ).toEqual([]);
  });
});
