/**
 * Triggers a browser download of `content` as a file named `filename` — the standard
 * Blob + object URL + temporary <a download> pattern, since the DOM has no direct
 * "save this string as a file" API.
 *
 * @param {string} content The file's full text content.
 * @param {string} filename The filename offered to the browser's save dialog.
 * @param {string} [mimeType='text/xml'] The Blob's MIME type.
 */
export function downloadTextFile(content, filename, mimeType = 'text/xml') {
  // Wrap the text in a Blob, then mint a temporary blob: URL the browser can navigate to.
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  // A hidden <a download> is the standard way to trigger a "Save As" for an in-memory
  // string — it has to be attached to the document for .click() to reliably fire the
  // download in every browser, then it's removed again right after.
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Frees the blob: URL now that the download has been handed off — otherwise it (and
  // the Blob backing it) would leak for the lifetime of the page.
  URL.revokeObjectURL(url);
}
