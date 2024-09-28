import { split } from "./Helpers";
import { isNonEmptyArray, NonEmptyArray } from "./NonEmptyArray";

// Note: This was initially written in a beatiful, immutable way. But I changed
// it to use mutation, since it turned out to be much faster. Basically, every
// time we mutate state we used to return a new one.

// First char uppercase: https://github.com/elm/compiler/blob/2860c2e5306cb7093ba28ac7624e8f9eb8cbc867/compiler/src/Parse/Variable.hs#L263-L267
// Rest: https://github.com/elm/compiler/blob/2860c2e5306cb7093ba28ac7624e8f9eb8cbc867/compiler/src/Parse/Variable.hs#L328-L335
// https://hackage.haskell.org/package/base-4.14.0.0/docs/Data-Char.html#v:isLetter
const MODULE_NAME = /^\p{Lu}[_\d\p{L}]*(?:\.\p{Lu}[_\d\p{L}]*)*$/u;

const CR = 0x0d;
const HYPHEN = 0x2d;
const LEFT_BRACE = 0x7b;
const LF = 0x0a;
const RIGHT_BRACE = 0x7d;
const SPACE = 0x20;

function isImport(chars: NonEmptyArray<number>): boolean {
  return (
    chars.length === 6 &&
    chars[0] === 0x69 &&
    chars[1] === 0x6d &&
    chars[2] === 0x70 &&
    chars[3] === 0x6f &&
    chars[4] === 0x72 &&
    chars[5] === 0x74
  );
}

export type ModuleName = NonEmptyArray<string>;

type ReadState = {
  tokenizerState: TokenizerState;
  parserState: ParserState;
  importedModules: Array<ModuleName>;
};

export const initialReadState = (): ReadState => ({
  tokenizerState: { tag: "Initial", chars: [], multilineCommentLevel: 0 },
  parserState: { tag: "StartOfFile" },
  importedModules: [],
});

export function readChar(char: number, readState: ReadState): void {
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

type Token =
  | { tag: "NewChunk" }
  | { tag: "Word"; chars: NonEmptyArray<number> };

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
  chars: Array<number>;
  multilineCommentLevel: number;
};

function tokenize(
  char: number,
  tokenizerState: TokenizerState
): Token | undefined {
  switch (tokenizerState.tag) {
    case "Initial":
      switch (char) {
        case SPACE: {
          const maybeToken = flush(tokenizerState.chars);
          tokenizerState.chars = [];
          return maybeToken;
        }
        case CR:
        case LF:
          tokenizerState.tag = "MaybeNewChunk";
          return flush(tokenizerState.chars);
        case LEFT_BRACE:
          tokenizerState.tag = "MaybeMultilineComment{";
          return flush(tokenizerState.chars);
        case HYPHEN:
          tokenizerState.tag = "MaybeSinglelineComment-";
          return flush(tokenizerState.chars);
        default:
          tokenizerState.chars.push(char);
          return undefined;
      }

    case "MaybeNewChunk":
      switch (char) {
        case SPACE:
          tokenizerState.tag = "Initial";
          tokenizerState.chars = [];
          return undefined;
        case CR:
        case LF:
          return undefined;
        case LEFT_BRACE:
          tokenizerState.tag = "MaybeMultilineComment{";
          return undefined;
        case HYPHEN:
          tokenizerState.tag = "MaybeSinglelineComment-";
          return undefined;
        default:
          tokenizerState.tag = "Initial";
          tokenizerState.chars = [char];
          return { tag: "NewChunk" };
      }

    case "MaybeMultilineComment{":
      switch (char) {
        case HYPHEN:
          tokenizerState.tag = "MultilineComment";
          tokenizerState.multilineCommentLevel = 1;
          return undefined;
        default:
          tokenizerState.tag = "Initial";
          tokenizerState.chars = [LEFT_BRACE];
          return tokenize(char, tokenizerState);
      }

    case "MultilineComment":
      switch (char) {
        case LEFT_BRACE:
          tokenizerState.tag = "MultilineComment{";
          return undefined;
        case HYPHEN:
          tokenizerState.tag = "MultilineComment-";
          return undefined;
        default:
          return undefined;
      }

    case "MultilineComment{":
      switch (char) {
        case HYPHEN:
          tokenizerState.tag = "MultilineComment";
          tokenizerState.multilineCommentLevel++;
          return undefined;
        case LEFT_BRACE:
          return undefined;
        default:
          tokenizerState.tag = "MultilineComment";
          return undefined;
      }

    case "MultilineComment-":
      switch (char) {
        case RIGHT_BRACE:
          if (tokenizerState.multilineCommentLevel <= 1) {
            tokenizerState.tag = "Initial";
            tokenizerState.chars = [];
          } else {
            tokenizerState.tag = "MultilineComment";
            tokenizerState.multilineCommentLevel--;
          }
          return undefined;
        case LEFT_BRACE:
          tokenizerState.tag = "MultilineComment{";
          return undefined;
        case HYPHEN:
          return undefined;
        default:
          tokenizerState.tag = "MultilineComment";
          return undefined;
      }

    case "MaybeSinglelineComment-":
      switch (char) {
        case HYPHEN:
          tokenizerState.tag = "SinglelineComment";
          return undefined;
        default:
          tokenizerState.tag = "Initial";
          tokenizerState.chars = [HYPHEN];
          return tokenize(char, tokenizerState);
      }

    case "SinglelineComment":
      switch (char) {
        case CR:
        case LF:
          tokenizerState.tag = "MaybeNewChunk";
          return undefined;
        default:
          return undefined;
      }
  }
}

function flush(chars: Array<number>): Token | undefined {
  return isNonEmptyArray(chars) ? { tag: "Word", chars } : undefined;
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
          if (isImport(token.chars)) {
            parserState.tag = "Import";
            return undefined;
          } else {
            parserState.tag = "Ignore";
            return undefined;
          }
      }

    case "NewChunk":
      switch (token.tag) {
        /* v8 ignore start */
        case "NewChunk":
          return undefined;
        /* v8 ignore stop */
        case "Word":
          if (isImport(token.chars)) {
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
        case "Word": {
          const string = Buffer.from(token.chars).toString();
          if (MODULE_NAME.test(string)) {
            parserState.tag = "Ignore";
            return split(string, ".");
          } else {
            parserState.tag = "Ignore";
            return undefined;
          }
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
