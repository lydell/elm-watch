import { split } from "./Helpers";
import { NonEmptyArray } from "./NonEmptyArray";

// First char uppercase: https://github.com/elm/compiler/blob/2860c2e5306cb7093ba28ac7624e8f9eb8cbc867/compiler/src/Parse/Variable.hs#L263-L267
// Rest: https://github.com/elm/compiler/blob/2860c2e5306cb7093ba28ac7624e8f9eb8cbc867/compiler/src/Parse/Variable.hs#L328-L335
// https://hackage.haskell.org/package/base-4.14.0.0/docs/Data-Char.html#v:isLetter
const MODULE_NAME = /^\p{Lu}[_\d\p{L}]*(?:\.\p{Lu}[_\d\p{L}]*)*$/u;

export type ModuleName = NonEmptyArray<string>;

export type ReadState = {
  tokenizerState: TokenizerState;
  parserState: ParserState;
  importedModules: Array<ModuleName>;
};

export const initialReadState: ReadState = {
  tokenizerState: { tag: "Initial", chars: "" },
  parserState: { tag: "StartOfFile" },
  importedModules: [],
};

export function readChar(char: string, readState: ReadState): ReadState {
  const [nextTokenizerState, maybeToken] = tokenize(
    char,
    readState.tokenizerState
  );

  if (maybeToken === undefined) {
    return {
      tokenizerState: nextTokenizerState,
      parserState: readState.parserState,
      importedModules: readState.importedModules,
    };
  }

  const [nextParserState, maybeModuleName] = parse(
    maybeToken,
    readState.parserState
  );

  return {
    tokenizerState: nextTokenizerState,
    parserState: nextParserState,
    importedModules:
      maybeModuleName === undefined
        ? readState.importedModules
        : [...readState.importedModules, maybeModuleName],
  };
}

export function finalize(readState: ReadState): Array<ModuleName> {
  const maybeLastToken =
    readState.tokenizerState.tag === "Initial"
      ? flush(readState.tokenizerState.chars)
      : undefined;

  const maybeLastModuleName =
    maybeLastToken === undefined
      ? undefined
      : parse(maybeLastToken, readState.parserState)[1];

  return maybeLastModuleName === undefined
    ? readState.importedModules
    : [...readState.importedModules, maybeLastModuleName];
}

type Token = { tag: "NewChunk" } | { tag: "Word"; chars: string };

type TokenizerState =
  | { tag: "Initial"; chars: string }
  | { tag: "MaybeMultilineComment{" }
  | { tag: "MaybeNewChunk" }
  | { tag: "MaybeSinglelineComment-" }
  | { tag: "MultilineComment-"; level: number }
  | { tag: "MultilineComment"; level: number }
  | { tag: "MultilineComment{"; level: number }
  | { tag: "SinglelineComment" };

function tokenize(
  char: string,
  tokenizerState: TokenizerState
): [TokenizerState, Token | undefined] {
  switch (tokenizerState.tag) {
    case "Initial":
      switch (char) {
        case " ":
          return [{ tag: "Initial", chars: "" }, flush(tokenizerState.chars)];
        case "\r":
        case "\n":
          return [{ tag: "MaybeNewChunk" }, flush(tokenizerState.chars)];
        case "{":
          return [
            { tag: "MaybeMultilineComment{" },
            flush(tokenizerState.chars),
          ];
        case "-":
          return [
            { tag: "MaybeSinglelineComment-" },
            flush(tokenizerState.chars),
          ];
        default:
          return [
            { tag: "Initial", chars: tokenizerState.chars + char },
            undefined,
          ];
      }

    case "MaybeNewChunk":
      switch (char) {
        case " ":
          return [{ tag: "Initial", chars: "" }, undefined];
        case "\r":
        case "\n":
          return [{ tag: "MaybeNewChunk" }, undefined];
        case "{":
          return [{ tag: "MaybeMultilineComment{" }, undefined];
        case "-":
          return [{ tag: "MaybeSinglelineComment-" }, undefined];
        default:
          return [{ tag: "Initial", chars: char }, { tag: "NewChunk" }];
      }

    case "MaybeMultilineComment{":
      switch (char) {
        case "-":
          return [{ tag: "MultilineComment", level: 1 }, undefined];
        default:
          return tokenize(char, { tag: "Initial", chars: "{" });
      }

    case "MultilineComment":
      switch (char) {
        case "{":
          return [
            { tag: "MultilineComment{", level: tokenizerState.level },
            undefined,
          ];
        case "-":
          return [
            { tag: "MultilineComment-", level: tokenizerState.level },
            undefined,
          ];
        default:
          return [tokenizerState, undefined];
      }

    case "MultilineComment{":
      switch (char) {
        case "-":
          return [
            { tag: "MultilineComment", level: tokenizerState.level + 1 },
            undefined,
          ];
        case "{":
          return [
            { tag: "MultilineComment{", level: tokenizerState.level },
            undefined,
          ];
        default:
          return [
            { tag: "MultilineComment", level: tokenizerState.level },
            undefined,
          ];
      }

    case "MultilineComment-":
      switch (char) {
        case "}":
          return [
            tokenizerState.level <= 1
              ? { tag: "Initial", chars: "" }
              : { tag: "MultilineComment", level: tokenizerState.level - 1 },
            undefined,
          ];
        case "{":
          return [
            { tag: "MultilineComment{", level: tokenizerState.level },
            undefined,
          ];
        case "-":
          return [
            { tag: "MultilineComment-", level: tokenizerState.level },
            undefined,
          ];
        default:
          return [
            { tag: "MultilineComment", level: tokenizerState.level },
            undefined,
          ];
      }

    case "MaybeSinglelineComment-":
      switch (char) {
        case "-":
          return [{ tag: "SinglelineComment" }, undefined];
        default:
          return tokenize(char, {
            tag: "Initial",
            chars: "-",
          });
      }

    case "SinglelineComment":
      switch (char) {
        case "\r":
        case "\n":
          return [{ tag: "MaybeNewChunk" }, undefined];
        default:
          return [tokenizerState, undefined];
      }
  }
}

function flush(chars: string): Token | undefined {
  return chars.length === 0 ? undefined : { tag: "Word", chars };
}

type ParserState =
  | { tag: "Ignore" }
  | { tag: "Import" }
  | { tag: "NewChunk" }
  | { tag: "NonImport" }
  | { tag: "StartOfFile" };

function parse(
  token: Token,
  parserState: ParserState
): [ParserState, ModuleName | undefined] {
  switch (parserState.tag) {
    case "StartOfFile":
      switch (token.tag) {
        case "NewChunk":
          return [{ tag: "StartOfFile" }, undefined];
        case "Word":
          if (token.chars === "import") {
            return [{ tag: "Import" }, undefined];
          } else {
            return [{ tag: "Ignore" }, undefined];
          }
      }

    case "NewChunk":
      switch (token.tag) {
        // istanbul ignore next
        case "NewChunk":
          return [{ tag: "NewChunk" }, undefined];
        case "Word":
          if (token.chars === "import") {
            return [{ tag: "Import" }, undefined];
          } else {
            return [{ tag: "NonImport" }, undefined];
          }
      }

    case "Import":
      switch (token.tag) {
        case "NewChunk":
          return [{ tag: "NewChunk" }, undefined];
        case "Word":
          if (MODULE_NAME.test(token.chars)) {
            return [{ tag: "Ignore" }, split(token.chars, ".")];
          } else {
            return [{ tag: "Ignore" }, undefined];
          }
      }

    case "Ignore":
      switch (token.tag) {
        case "NewChunk":
          return [{ tag: "NewChunk" }, undefined];
        case "Word":
          return [parserState, undefined];
      }

    case "NonImport":
      return [parserState, undefined];
  }
}
