# Development

## Layout

- `extension/`: reader UI, PDF processing, citation metadata, and extension background scripts.
- `extension/vendor/`: bundled PDF.js 5.6.205 and its supporting assets and licenses.
- `native/`: macOS host app and native Pangram transport.
- `scripts/`: local app build, Xcode conversion, and browser preview server.
- `tests/`: unit and WebKit integration tests.

## Local build

From the repository root:

```sh
bash scripts/build-local.sh
open safari_arxiv_reader.app
```

Apple Command Line Tools are sufficient for this ad-hoc-signed build. The script verifies the resulting signatures. `SAFARI_ARXIV_READER_BUILD_APP` can override the output path. The app must remain on disk for Safari to load its extension.

The `dev.papertrail.reader` identifiers, `papertrail-*` storage keys, and `PAPERTRAIL_*` test variables are retained for compatibility with existing installations.

## Tests and browser preview

Unit tests need Node.js and no third-party dependencies:

```sh
npm test
```

For the browser tests, install the development dependencies and WebKit:

```sh
npm install
npx playwright install webkit
npm run serve
```

Open the printed localhost URL for a browser preview. In another terminal:

```sh
npm run test:browser
```

Extended suites are `test:parity`, `test:interactions`, `test:insights`, `test:scholar`, and `test:resources`. Set `PAPERTRAIL_FIXTURES` to a directory containing:

- `attention.pdf` and `attention.html`: PDF and abstract page for arXiv 1706.03762.
- `layernorm.pdf` and `arxiv.html`: PDF and abstract page for arXiv 1607.06450.
- `openalex.json`: the response to `https://api.openalex.org/works?search=Long%20short-term%20memory&per-page=5`.

The default fixture directory is `.test-fixtures/`, which is ignored by Git. `PAPERTRAIL_RUNTIME` optionally points to a Node module-resolution entry point when dependencies live outside this repository. Browser suites use recorded metadata and simulated extension APIs; they do not prove live service availability or physical trackpad latency. AI checks use simulated responses and do not consume paid API credits.

The v0.3.14 unit suite has 51 passing tests. Previous WebKit checks cover rendering, outlines, reference previews, zoom, search, saved papers, and optional-service flows. Generated screenshots and performance reports are ignored; selected documentation screenshots live in `docs/images/`.

## Signed distribution

A permanent distribution requires your own Apple developer signing configuration and a suitable distribution route. This repository does not include signing credentials or a notarized release.

With full Xcode installed, `bash scripts/build-safari.sh` creates an Xcode scaffold. Add `native/Extension.m` to the extension target, set its principal class to `SafariArxivReaderExtensionHandler`, link SafariServices, and retain the network-client entitlement and `nativeMessaging` permission to support Pangram. The local build script already includes this bridge.
