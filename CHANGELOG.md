# Changelog

## 0.3.14

- Renamed the app, extension, and repository to `safari_arxiv_reader`.
- Added the GPT-6 Astra acknowledgement to the README.

- Simplified the README with screenshots and Safari installation instructions.
- Separated release notes, development guidance, and privacy information.

## 0.3.13

- Renamed the app, extension, reader labels, and exported files to ArxivPDFReader.
- Retained extension identifiers and storage keys to preserve existing saved data.

## 0.3.12

- Fixed citation lookups interrupted by initial blank tabs, normalized search URLs, or delayed results.
- Match the first exact paper title across search results without combining duplicate counts.
- Retry temporary failures once automatically, with increasing backoff for later attempts.
- Distinguish missing papers, missing counts, website permission, and verification challenges.
- Preserve cached counts when refresh fails and migrate obsolete failure-cache entries.

## 0.3.11

- Introduced the blue #73A4C6 palette across the reader, popup, and citation import helper.

## 0.3.10

- Removed the persistent bottom counts bar; show action feedback as temporary messages.

## 0.3.9

- Removed the highlighter, selection popup, and persistent highlight overlays.
- Kept text selection, exact-word search highlighting, and access to previously saved notes.

## 0.3.8

- Replaced the header logo with the paper title and removed the References sidebar tab.
- Retrieve citation counts through a temporary background browser tab and cache successful results.
- Keep citation previews available directly from the PDF.

## 0.3.7

- Added automatic citation-count display, caching, and failure backoff.
- The original native lookup transport was replaced in 0.3.8.

## 0.3.6

- Switched citation counts from OpenAlex to Google Scholar, initially through explicit import.
- Moved rotation into the More menu.

## 0.3.5

- Added paper citation counts and optional Pangram analysis.
- Added a native bridge for explicit Pangram requests, model selection, and result retrieval.

## 0.3.4

- Improved small pinch movements and gesture pauses.
- Released distant page canvases and bounded the raster cache to reduce memory overhead.
- Coalesced scroll bookkeeping into animation frames.

## 0.3.3

- Prevented citation exports before bibliographic metadata was ready.
- Added regressions for zoom, exact-word search, and BibTeX dialogs.

## 0.3.2

- Made zoom scale existing page surfaces immediately and render sharp replacements after settling.
- Simplified citation export to BibTeX and highlighted only matching search characters.

## 0.3.1

- Added in-place PDF reading, section outlines, citation previews, paper links, and local saved papers.
- Added PDF keyboard zoom, page navigation, themes, author–year reference detection, and optional AI summaries.
- Fixed Safari permission requests to run from explicit user gestures.
