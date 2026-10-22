# Privacy and limitations

## Local reading and online metadata

PDF parsing, rendering, outlines, saved papers, and existing notes run locally. Opening a web PDF contacts its original website. There are no analytics or bundled API keys.

Reference previews send an identifier or bibliographic query to arXiv/OpenAlex. The current paper's arXiv metadata loads when opened. Citation-count lookup sends the paper title to Google Scholar when no fresh cache or active backoff exists. It uses a temporary Safari tab and the browser's usual Scholar session; only search-result markup is read. A lookup tab closes after completion or timeout unless the user selects or navigates it.

Successful counts are cached locally for seven days, up to 200 entries. Missing papers or counts are never interpreted as zero. Access challenges require user verification; the extension does not solve CAPTCHAs. More → Google Scholar supports explicit count import.

## Optional AI features

**AI outline** sends extracted section text to OpenAI only after you enter your key and submit the form. The key stays in tab memory and is cleared after the request; requests use `store:false`. Limits are 60 sections and 14,000 characters per section, with excerpts marked. Summaries may be inaccurate and are not saved across reloads.

**AI check** uses Pangram. Enter your API key, load available models, choose one, and click **Send text & analyze**. This sends extracted paper text, including references and captions, and consumes your API credits. Nothing is analyzed automatically. The key and result stay in tab memory; no public result link is requested. A website workflow is also available through **Copy paper text → Open Pangram**.

Pangram requests use a native bridge limited to fixed service endpoints. **Stop waiting** stops local polling but does not cancel server processing or charges. **Check result** resumes retrieval of the same task without resubmitting. If submission fails, check your Pangram dashboard before retrying: the service may already have received it. Papers over 500,000 extracted characters need the website workflow. Detection percentages are estimates, not proof of authorship.

## Reading limitations

Scanned PDFs need OCR elsewhere first. Section headings and unlinked references are detected heuristically; complex layouts may fail or include adjacent text. Abstracts and PDF links depend on metadata coverage. Authenticated publishers and cross-origin redirects may require downloading a PDF and opening it locally.

Distant page canvases are released and recreated when needed. The raster cache targets 64 MiB, with up to 8 million raster pixels per page; this is not a limit on total browser memory. PDF bytes, fonts, text indexes, visible pages, and browser internals use additional memory.
