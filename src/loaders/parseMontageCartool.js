// Parse Cartool montage text into montage-editor rows. Cartool montages carry no per-channel
// type info, so channelTypes is always empty — kept as a return field only to match
// parseAnyWaveMontage's shape (see parseMontageFile, which dispatches to either parser
// interchangeably).
//
// Returns:
//   rows          – [{ channel, reference, color: null }], always bipolar (reference set)
//   channelTypes  – {} always
//
// Throws when the text isn't at least a name line followed by one or more valid
// channel<TAB>reference data lines.
export function parseCartoolMontage(text) {
  // Splits on \n or \r\n — Cartool is a Windows desktop application, so files it writes
  // (or files re-saved by a Windows text editor) commonly use CRLF line endings.
  const nonBlankLines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (nonBlankLines.length < 2) {
    throw new Error(
      'Not a valid Cartool montage file: expected a name line followed by channel pairs'
    );
  }

  // The first line is the montage name (informational only, not a channel pair) — every
  // line after it should be one channel<TAB>reference pair.
  const dataLines = nonBlankLines.slice(1);

  const rows = dataLines.map((line) => {
    const rawPair = line.split('\t');
    const trimmedPair = rawPair.map((field) => field.trim());
    // Drops empty strings so a stray trailing tab (the sample file has one: "C3\tP3\t")
    // isn't mistaken for a bogus third field.
    const chanRefPair = trimmedPair.filter((field) => field.length > 0);

    if (chanRefPair.length !== 2) {
      throw new Error(`Not a valid Cartool montage file: invalid line "${line}"`);
    }

    const [channel, reference] = chanRefPair;
    return { channel, reference, color: null };
  });

  return { rows, channelTypes: {} };
}
