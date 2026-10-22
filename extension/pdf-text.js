// Safari 18 supports stream readers, but not ReadableStream async iteration.
// PDF.js 5 uses async iteration in getTextContent, even in its legacy build.
export async function readPageText(page) {
  if (page.isPureXfa) return page.getTextContent();
  const reader = page.streamTextContent().getReader();
  const text = {items: [], styles: Object.create(null), lang: null};
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) return text;
      text.lang ??= value.lang;
      Object.assign(text.styles, value.styles);
      text.items.push(...value.items);
    }
  } finally {
    reader.releaseLock();
  }
}
