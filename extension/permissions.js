// Keep requesting separate from checking. Safari requires request() in the
// synchronous call stack of a click; awaiting a tab lookup first loses it.
export function pdfPermission(url) {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('Use “Open a local PDF” for downloaded files.');
  return {origins:[`${parsed.origin}/*`]};
}
export function pdfAccess(api, url, fromUserGesture=false) {
  const permission=pdfPermission(url);
  if (!api?.permissions) return Promise.resolve(true);
  // Do not insert an await, contains(), or tabs.query() before request().
  return fromUserGesture ? api.permissions.request(permission) : api.permissions.contains(permission);
}
