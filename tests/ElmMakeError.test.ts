import * as Codec from "../src/Codec";
import { ElmMakeError } from "../src/ElmMakeError";
import { stringSnapshotSerializer } from "./Helpers";

expect.addSnapshotSerializer(stringSnapshotSerializer);

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

    const jsonString = Codec.stringify(ElmMakeError, fixture, 2);

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

    const decoded = Codec.parse(ElmMakeError, jsonString);

    expect(decoded).toStrictEqual(fixture);
  });

  test("GeneralError, elm.json", () => {
    const fixture: ElmMakeError = {
      tag: "GeneralError",
      path: { tag: "elm.json" },
      title: "title",
      message: [],
    };

    const jsonString = Codec.stringify(ElmMakeError, fixture, 2);

    expect(jsonString).toMatchInlineSnapshot(`
      {
        "type": "error",
        "path": "elm.json",
        "title": "title",
        "message": []
      }
    `);

    const decoded = Codec.parse(ElmMakeError, jsonString);

    expect(decoded).toStrictEqual(fixture);
  });

  test("CompileErrors", () => {
    const fixture: ElmMakeError = {
      tag: "CompileErrors",
      errors: [
        {
          path: {
            tag: "AbsolutePath",
            absolutePath: "/path/to/file",
          },
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

    const jsonString = Codec.stringify(ElmMakeError, fixture, 2);

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

    const decoded = Codec.parse(ElmMakeError, jsonString);

    expect(decoded).toStrictEqual(fixture);
  });
});
