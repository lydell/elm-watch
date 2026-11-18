// elm-watch links to /v2/link#some-key instead of directly to the docs, so
// the docs can be restructured without breaking links in released versions.
// The keys are mapped to URLs in docs/_data/v2_links.json.
export const DOCS_LINK_KEYS = [
  "home",
  "javascript-api",
  "elm-watch-json",
  "package-targets",
  "clickable-error-locations",
  "postprocess",
  "server",
  "index-html",
  "allowed-hosts",
  "network-exposure",
  "https",
] as const;

export type DocsLinkKey = (typeof DOCS_LINK_KEYS)[number];

export function docsLink(key: DocsLinkKey): string {
  return `https://lydell.github.io/elm-watch/v2/link#${key}`;
}
