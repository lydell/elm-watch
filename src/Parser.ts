import { split } from "./Helpers";
import { NonEmptyArray } from "./NonEmptyArray";

// Note: This was initially written in a beatiful, immutable way. But I changed
// it to use mutation, since it turned out to be much faster. Basically, every
// time we mutate state we used to return a new one.

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

export const initialReadState = (): ReadState => ({
  tokenizerState: { tag: "Initial", chars: "", multilineCommentLevel: 0 },
  parserState: { tag: "StartOfFile" },
  importedModules: [],
});

export function readChar(char: string, readState: ReadState): void {
  const maybeToken = tokenize(char, readState.tokenizerState);

  if (maybeToken === undefined) {
    return;
  }

  const maybeModuleName = parse(maybeToken, readState.parserState);

  if (maybeModuleName !== undefined) {
    readState.importedModules.push(maybeModuleName);
  }
}

export function isNonImport(readState: ReadState): boolean {
  return readState.parserState.tag === "NonImport";
}

export function finalize(readState: ReadState): Array<ModuleName> {
  if (readState.tokenizerState.tag !== "Initial") {
    return readState.importedModules;
  }

  const maybeLastToken = flush(readState.tokenizerState.chars);

  if (maybeLastToken === undefined) {
    return readState.importedModules;
  }

  const maybeLastModuleName = parse(maybeLastToken, readState.parserState);

  if (maybeLastModuleName === undefined) {
    return readState.importedModules;
  }

  readState.importedModules.push(maybeLastModuleName);
  return readState.importedModules;
}

type Token = { tag: "NewChunk" } | { tag: "Word"; chars: string };

type TokenizerState = {
  tag:
    | "Initial"
    | "MaybeMultilineComment{"
    | "MaybeNewChunk"
    | "MaybeSinglelineComment-"
    | "MultilineComment-"
    | "MultilineComment"
    | "MultilineComment{"
    | "SinglelineComment";
  chars: string;
  multilineCommentLevel: number;
};

function tokenize(
  char: string,
  tokenizerState: TokenizerState
): Token | undefined {
  switch (tokenizerState.tag) {
    case "Initial":
      switch (char) {
        case " ": {
          const maybeToken = flush(tokenizerState.chars);
          tokenizerState.chars = "";
          return maybeToken;
        }
        case "\r":
        case "\n":
          tokenizerState.tag = "MaybeNewChunk";
          return flush(tokenizerState.chars);
        case "{":
          tokenizerState.tag = "MaybeMultilineComment{";
          return flush(tokenizerState.chars);
        case "-":
          tokenizerState.tag = "MaybeSinglelineComment-";
          return flush(tokenizerState.chars);
        default:
          tokenizerState.chars += char;
          return undefined;
      }

    case "MaybeNewChunk":
      switch (char) {
        case " ":
          tokenizerState.tag = "Initial";
          tokenizerState.chars = "";
          return undefined;
        case "\r":
        case "\n":
          return undefined;
        case "{":
          tokenizerState.tag = "MaybeMultilineComment{";
          return undefined;
        case "-":
          tokenizerState.tag = "MaybeSinglelineComment-";
          return undefined;
        default:
          tokenizerState.tag = "Initial";
          tokenizerState.chars = char;
          return { tag: "NewChunk" };
      }

    case "MaybeMultilineComment{":
      switch (char) {
        case "-":
          tokenizerState.tag = "MultilineComment";
          tokenizerState.multilineCommentLevel = 1;
          return undefined;
        default:
          tokenizerState.tag = "Initial";
          tokenizerState.chars = "{";
          return tokenize(char, tokenizerState);
      }

    case "MultilineComment":
      switch (char) {
        case "{":
          tokenizerState.tag = "MultilineComment{";
          return undefined;
        case "-":
          tokenizerState.tag = "MultilineComment-";
          return undefined;
        default:
          return undefined;
      }

    case "MultilineComment{":
      switch (char) {
        case "-":
          tokenizerState.tag = "MultilineComment";
          tokenizerState.multilineCommentLevel++;
          return undefined;
        case "{":
          return undefined;
        default:
          tokenizerState.tag = "MultilineComment";
          return undefined;
      }

    case "MultilineComment-":
      switch (char) {
        case "}":
          if (tokenizerState.multilineCommentLevel <= 1) {
            tokenizerState.tag = "Initial";
            tokenizerState.chars = "";
          } else {
            tokenizerState.tag = "MultilineComment";
            tokenizerState.multilineCommentLevel--;
          }
          return undefined;
        case "{":
          tokenizerState.tag = "MultilineComment{";
          return undefined;
        case "-":
          return undefined;
        default:
          tokenizerState.tag = "MultilineComment";
          return undefined;
      }

    case "MaybeSinglelineComment-":
      switch (char) {
        case "-":
          tokenizerState.tag = "SinglelineComment";
          return undefined;
        default:
          tokenizerState.tag = "Initial";
          tokenizerState.chars = "-";
          return tokenize(char, tokenizerState);
      }

    case "SinglelineComment":
      switch (char) {
        case "\r":
        case "\n":
          tokenizerState.tag = "MaybeNewChunk";
          return undefined;
        default:
          return undefined;
      }
  }
}

function flush(chars: string): Token | undefined {
  return chars.length === 0 ? undefined : { tag: "Word", chars };
}

type ParserState = {
  tag: "Ignore" | "Import" | "NewChunk" | "NonImport" | "StartOfFile";
};

function parse(token: Token, parserState: ParserState): ModuleName | undefined {
  switch (parserState.tag) {
    case "StartOfFile":
      switch (token.tag) {
        case "NewChunk":
          return undefined;
        case "Word":
          if (token.chars === "import") {
            parserState.tag = "Import";
            return undefined;
          } else {
            parserState.tag = "Ignore";
            return undefined;
          }
      }

    case "NewChunk":
      switch (token.tag) {
        // istanbul ignore next
        case "NewChunk":
          return undefined;
        case "Word":
          if (token.chars === "import") {
            parserState.tag = "Import";
            return undefined;
          } else {
            parserState.tag = "NonImport";
            return undefined;
          }
      }

    case "Import":
      switch (token.tag) {
        case "NewChunk":
          parserState.tag = "NewChunk";
          return undefined;
        case "Word":
          if (MODULE_NAME.test(token.chars)) {
            parserState.tag = "Ignore";
            return split(token.chars, ".");
          } else {
            parserState.tag = "Ignore";
            return undefined;
          }
      }

    case "Ignore":
      switch (token.tag) {
        case "NewChunk":
          parserState.tag = "NewChunk";
          return undefined;
        case "Word":
          return undefined;
      }

    case "NonImport":
      return undefined;
  }
}
