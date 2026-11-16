import { describe, expect, test } from "vitest";

import {
  editorUrl,
  findPreset,
  isEditorUrl,
  validateEditorUrlTemplate,
} from "../src/Editor.ts";

// A preset ID or a URL template.
function parse(string: string): string {
  return findPreset(string)?.template ?? string;
}

const location = {
  file: "/Users/you/project/src/Main.elm",
  line: 10,
  column: 3,
};

describe("editorUrl", () => {
  test("presets", () => {
    expect(editorUrl(parse("vscode"), location)).toMatchInlineSnapshot(
      `"vscode://file/Users/you/project/src/Main.elm:10:3"`,
    );
    expect(editorUrl(parse("webstorm"), location)).toMatchInlineSnapshot(
      `"webstorm://open?file=/Users/you/project/src/Main.elm&line=10&column=2"`,
    );
  });

  test("all placeholders", () => {
    expect(
      editorUrl(
        parse("x://{file}?a={line}&b={column}&c={line0}&d={column0}&e={nope}"),
        location,
      ),
    ).toMatchInlineSnapshot(
      `"x:///Users/you/project/src/Main.elm?a=10&b=3&c=9&d=2&e={nope}"`,
    );
  });

  test("0-based numbers don’t go below 0", () => {
    expect(
      editorUrl(parse("x://{file}:{line0}:{column0}"), {
        ...location,
        line: 0,
        column: 0,
      }),
    ).toMatchInlineSnapshot(`"x:///Users/you/project/src/Main.elm:0:0"`);
  });

  test("Windows paths", () => {
    expect(
      editorUrl(parse("vscode"), {
        ...location,
        file: "C:\\Users\\you\\project\\src\\Main.elm",
      }),
    ).toMatchInlineSnapshot(
      `"vscode://file/C:/Users/you/project/src/Main.elm:10:3"`,
    );
  });

  test("special characters are encoded", () => {
    expect(
      editorUrl(parse("idea"), {
        ...location,
        file: "/Users/you/my project/a&b=c?d#e%f+g/Ä.elm",
      }),
    ).toMatchInlineSnapshot(
      `"idea://open?file=/Users/you/my%20project/a%26b%3Dc%3Fd%23e%25f%2Bg/%C3%84.elm&line=10&column=2"`,
    );
  });
});

describe("validateEditorUrlTemplate", () => {
  test.each([
    "myeditor://open?file={file}",
    "pycharm://open?file={file}&line={line}&column={column0}",
    "x-bbedit://open?url=file://{file}&line={line}",
  ])("valid: %s", (template) => {
    expect(validateEditorUrlTemplate(template)).toBeUndefined();
  });

  test("invalid", () => {
    expect(
      [
        "",
        "{file}",
        "https://example.com/{file}",
        "JavaScript:alert({file})",
        "data:text/html,{file}",
        "file://{file}",
        "myeditor://open?file={file} --evil",
        "myeditor://open",
      ]
        .map(
          (template) =>
            `${JSON.stringify(template)}: ${validateEditorUrlTemplate(template) ?? "(valid)"}`,
        )
        .join("\n"),
    ).toMatchInlineSnapshot(`
      """: The URL must start with a scheme, like myeditor://
      "{file}": The URL must start with a scheme, like myeditor://
      "https://example.com/{file}": https: URLs are not supported. Only URLs for opening apps, like myeditor://
      "JavaScript:alert({file})": javascript: URLs are not supported. Only URLs for opening apps, like myeditor://
      "data:text/html,{file}": data: URLs are not supported. Only URLs for opening apps, like myeditor://
      "file://{file}": file: URLs are not supported. Only URLs for opening apps, like myeditor://
      "myeditor://open?file={file} --evil": The URL must not contain whitespace.
      "myeditor://open": The URL must contain {file}."
    `);
  });
});

describe("isEditorUrl", () => {
  test.each([
    "myeditor://open?file={file}",
    "pycharm://open",
    "x-bbedit://open?url=file://{file}",
    "http://example.com",
    "myeditor://open?file={file} --with-space",
  ])("URL: %s", (string) => {
    expect(isEditorUrl(string)).toBe(true);
  });

  test.each([
    'code --goto "$file:$line:$column"',
    "C://Program Files/editor.exe %file%",
    "C:\\Program Files\\editor.exe %file%",
    "/usr/bin/myeditor $file",
    "myeditor:{file}",
    "",
  ])("command: %s", (string) => {
    expect(isEditorUrl(string)).toBe(false);
  });
});

describe("findPreset", () => {
  test("unknown preset ID", () => {
    expect(findPreset("emacs")).toBeUndefined();
  });
});
