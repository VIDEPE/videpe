import { unzip } from 'fflate';

// Folder names/files zip tools add that are never data (macOS resource forks, Finder metadata).
const isJunkEntry = (path) => path.startsWith('__MACOSX/') || path.endsWith('.DS_Store');

/**
 * Unzips an archive (e.g. a Shanoir dataset download) into File objects, so they can be
 * fed to the same entry points as a local file drop.
 *
 * Files are named by their base file name only — the folder structure inside the zip is
 * dropped, since VIDEPE's format detection works on file names/extensions alone.
 *
 * Uses fflate's async unzip, which decompresses off the main thread where possible, so a
 * large recording doesn't freeze the UI.
 *
 * @param {Blob} zipBlob - the zip archive.
 * @returns {Promise<File[]>} one File per file entry (directories and junk entries skipped).
 * @throws {Error} when the data isn't a valid zip archive.
 */
export async function unzipToFiles(zipBlob) {
  const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());

  // Only job of this promise: turn unzip's callback into something awaitable
  const unzipped = await new Promise((resolve, reject) => {
    // unzip is parallelized and often much faster than unzipSync
    unzip(
      zipBytes,
      { filter: (entry) => !entry.name.endsWith('/') && !isJunkEntry(entry.name) },
      (err, files) => (err ? reject(err) : resolve(files))
    );
  });

  // unzipped = { 'path/in/zip.ext': Uint8Array, ... }
  // => convert to array of File objects so VIDEPE can handle them
  // new File(fileBits, fileName), note that for fileName we take the last section in the filepath
  return Object.entries(unzipped).map(([path, data]) => new File([data], path.split('/').pop()));
}
