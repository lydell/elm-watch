import { describe, expect, test } from "vitest";

import * as Parser from "../src/Parser";

function parse(elmFile: string): Array<Parser.ModuleName> {
  const readState = Parser.initialReadState();
  for (const char of Buffer.from(elmFile)) {
    Parser.readChar(char, readState);
    if (Parser.isNonImport(readState)) {
      break;
    }
  }
  return Parser.finalize(readState);
}

describe("Parser", () => {
  test("empty string", () => {
    expect(parse("")).toEqual([]);
  });

  test("https://elm-lang.org/examples/hello", () => {
    const elm = `
import Html exposing (text)


main =
  text "Hello!"
    `.trim();
    expect(parse(elm)).toEqual([["Html"]]);
  });

  test("https://elm-lang.org/examples/buttons", () => {
    const elm = `
module Main exposing (..)

-- Press buttons to increment and decrement a counter.
--
-- Read how it works:
--   https://guide.elm-lang.org/architecture/buttons.html
--


import Browser
import Html exposing (Html, button, div, text)
import Html.Events exposing (onClick)



-- MAIN


main =
  Browser.sandbox { init = init, update = update, view = view }
    `.trim();
    expect(parse(elm)).toEqual([["Browser"], ["Html"], ["Html", "Events"]]);
  });

  test("elm/json Json.Decode", () => {
    const elm = `
module Json.Decode exposing
  ( Decoder, string, bool, int, float
  , nullable, list, array, dict, keyValuePairs, oneOrMore
  , field, at, index
  , maybe, oneOf
  , decodeString, decodeValue, Value, Error(..), errorToString
  , map, map2, map3, map4, map5, map6, map7, map8
  , lazy, value, null, succeed, fail, andThen
  )

{-| Turn JSON values into Elm values. Definitely check out this [intro to
JSON decoders][guide] to get a feel for how this library works!
[guide]: https://guide.elm-lang.org/effects/json.html
# Primitives
@docs Decoder, string, bool, int, float
# Data Structures
@docs nullable, list, array, dict, keyValuePairs, oneOrMore
# Object Primitives
@docs field, at, index
# Inconsistent Structure
@docs maybe, oneOf
# Run Decoders
@docs decodeString, decodeValue, Value, Error, errorToString
# Mapping
**Note:** If you run out of map functions, take a look at [elm-json-decode-pipeline][pipe]
which makes it easier to handle large objects, but produces lower quality type
errors.
[pipe]: /packages/NoRedInk/elm-json-decode-pipeline/latest
@docs map, map2, map3, map4, map5, map6, map7, map8
# Fancy Decoding
@docs lazy, value, null, succeed, fail, andThen
-}


import Array exposing (Array)
import Dict exposing (Dict)
import Json.Encode
import Elm.Kernel.Json



-- PRIMITIVES


{-| A value that knows how to decode JSON values.
There is a whole section in \`guide.elm-lang.org\` about decoders, so [check it
out](https://guide.elm-lang.org/interop/json.html) for a more comprehensive
introduction!
-}
type Decoder a = Decoder

    `.trim();
    expect(parse(elm)).toEqual([
      ["Array"],
      ["Dict"],
      ["Json", "Encode"],
      ["Elm", "Kernel", "Json"],
    ]);
  });

  test("only imports", () => {
    const elm = `
import A
import B
    `.trim();
    expect(parse(elm)).toEqual([["A"], ["B"]]);
  });

  test("skip invalid imports", () => {
    const elm = `
import A
import a -- lowercase
import -- missing module
import--missing module
import
import C..D -- double dot
import .E -- leading dot
import F. -- trailing dot
import + -- not a module name
import - -- not a module name
import Z
importHtml -- missing space (last since this ends the imports)
import NotDetected
    `.trim();
    expect(parse(elm)).toEqual([["A"], ["Z"]]);
  });

  test("unicode", () => {
    const elm = `
import åäö
import Åäö
import Ππ
import πΠ
import Xᾀ_5Ϡ
    `.trim();
    expect(parse(elm)).toEqual([["Åäö"], ["Ππ"], ["Xᾀ_5Ϡ"]]);
  });

  test("tricky comments", () => {
    const elm = `
module{--}Main {-
    {{-}-}-
-}exposing--{-

 ({--}one{--}
    ,
    -- notExport
  two{-{-{-{--}-}{--}-}{-{--}-}-},Type{--}({--}..{--}){--}
  ,    three{-
import Not.An.Import
-}
  )--
import{--}A.B {-
    {{-}-}-
-}exposing--{-

 ({--}one{--}
    ,
    -- notImported
  two{-{-{-{--}-}{--}-}{-{--}-}-},Type{--}({--}..{--}){--}
  ,    three{-
import Not.An.Import2
-}
  )--
import--comment
 C--
import{-
-}D{-
-}exposing{-{x-{---}(d)
    `;
    expect(parse(elm)).toEqual([["A", "B"], ["C"], ["D"]]);
  });

  test("tricky whitespace", () => {
    const elm = `
   import     First.Module
  
     
import
    Second.Module
import Third . Module -- spaces around dot not allowed – we only find "Third", ignoring the rest of the line
    `;
    expect(parse(elm)).toEqual([
      ["First", "Module"],
      ["Second", "Module"],
      ["Third"],
    ]);
  });

  test("is not fooled by strings", () => {
    const elm = `
module Main exposing (a, b)
import Yes
a = "import A"
b = """
import B
"""
    `;
    expect(parse(elm)).toEqual([["Yes"]]);
  });

  test("CRLF", () => {
    const elm = `
module Main exposing (a, b)
import A -- comment
import B
    `.replace(/\n/g, "\r\n");
    expect(parse(elm)).toEqual([["A"], ["B"]]);
  });

  test("CR", () => {
    // Elm only allows LF and CRLF, not CR by its own. But we do.
    const elm = `
module Main exposing (a, b)
import A -- comment

import B
    `.replace(/\n/g, "\r");
    expect(parse(elm)).toEqual([["A"], ["B"]]);
  });

  test("invalid exposing does not matter", () => {
    // This is invalid code, but we can still make out the imports, allowing us
    // to react to changes to sub files even before the importer has gotten the
    // syntax right.
    const elm = `
module Main (x, y)
import A exposing (x
import B some
  yibberish = 1
import C
x=1
y = 2
    `.replace(/\n/g, "\r");
    expect(parse(elm)).toEqual([["A"], ["B"], ["C"]]);
  });

  test("handles unclosed comment", () => {
    const elm = `import A {-`;
    expect(parse(elm)).toEqual([["A"]]);
  });

  test("code coverage – last token leads to no import", () => {
    const elm = `import A.`;
    expect(parse(elm)).toEqual([]);
  });

  test("code coverage – braces that aren’t comments", () => {
    const elm = `import {A}`;
    expect(parse(elm)).toEqual([]);
  });

  test("forgetting Parser.isNonImport", () => {
    const elm = `
import A

x =
    1
    `.trim();
    const readState = Parser.initialReadState();
    for (const char of Buffer.from(elm)) {
      Parser.readChar(char, readState);
    }
    const result = Parser.finalize(readState);
    expect(result).toEqual([["A"]]);
  });
});
