import * as Codec from "tiny-decoders";
import { describe, expect, test } from "vitest";

import { ElmMakeError } from "../src/ElmMakeError";
import { markAsAbsolutePath } from "../src/Types";
import { stringSnapshotSerializer } from "./Helpers";

expect.addSnapshotSerializer(stringSnapshotSerializer);

function decode(jsonString: string): ElmMakeError {
  const result = Codec.JSON.parse(ElmMakeError, jsonString);
  switch (result.tag) {
    case "Valid":
      return result.value;
    case "DecoderError":
      throw new Error(Codec.format(result.error));
  }
}

describe("ElmMakeError", () => {
  test("GeneralError, NoPath", () => {
    const fixture: ElmMakeError = {
      tag: "GeneralError",
      path: { tag: "NoPath" },
      title: "title",
      message: [
        {
          tag: "UnstyledText",
          string: "text",
        },
        {
          tag: "StyledText",
          string: "styled",
          bold: false,
          underline: false,
          color: "red",
        },
      ],
    };

    const jsonString = Codec.JSON.stringify(ElmMakeError, fixture, 2);

    expect(jsonString).toMatchInlineSnapshot(`
      {
        "type": "error",
        "path": null,
        "title": "title",
        "message": [
          "text",
          {
            "bold": false,
            "underline": false,
            "color": "red",
            "string": "styled"
          }
        ]
      }
    `);

    expect(decode(jsonString)).toStrictEqual(fixture);
  });

  test("GeneralError, elm.json", () => {
    const fixture: ElmMakeError = {
      tag: "GeneralError",
      path: { tag: "elm.json" },
      title: "title",
      message: [],
    };

    const jsonString = Codec.JSON.stringify(ElmMakeError, fixture, 2);

    expect(jsonString).toMatchInlineSnapshot(`
      {
        "type": "error",
        "path": "elm.json",
        "title": "title",
        "message": []
      }
    `);

    expect(decode(jsonString)).toStrictEqual(fixture);
  });

  test("CompileErrors", () => {
    const fixture: ElmMakeError = {
      tag: "CompileErrors",
      errors: [
        {
          path: markAsAbsolutePath("/path/to/file"),
          name: "name",
          problems: [
            {
              title: "title",
              region: {
                start: {
                  line: 1,
                  column: 2,
                },
                end: {
                  line: 3,
                  column: 4,
                },
              },
              message: [
                {
                  tag: "UnstyledText",
                  string: "text",
                },
                {
                  tag: "StyledText",
                  string: "styled",
                  bold: false,
                  underline: false,
                  color: undefined,
                },
              ],
            },
          ],
        },
      ],
    };

    const jsonString = Codec.JSON.stringify(ElmMakeError, fixture, 2);

    expect(jsonString).toMatchInlineSnapshot(`
      {
        "type": "compile-errors",
        "errors": [
          {
            "path": "/path/to/file",
            "name": "name",
            "problems": [
              {
                "title": "title",
                "region": {
                  "start": {
                    "line": 1,
                    "column": 2
                  },
                  "end": {
                    "line": 3,
                    "column": 4
                  }
                },
                "message": [
                  "text",
                  {
                    "bold": false,
                    "underline": false,
                    "color": null,
                    "string": "styled"
                  }
                ]
              }
            ]
          }
        ]
      }
    `);

    expect(decode(jsonString)).toStrictEqual(fixture);
  });
});
