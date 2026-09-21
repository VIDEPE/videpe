const TYPE_MAP = { eeg: 'eeg', seeg: 'seeg' };

// Parse AnyWave montage XML text into montage-editor rows + per-channel types.
//
// Returns:
//   rows          – [{ channel, reference, color }], reference/color null when the
//                    corresponding tag is empty
//   channelTypes  – { channelName: 'eeg'|'seeg'|'other' }
//
// Throws on malformed input (bad XML, wrong root element, no channels, missing name) —
// there's no sensible empty-result fallback for a montage file that doesn't parse.
export function parseAnyWaveMontage(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Not a valid AnyWave montage file: XML parse error');
  }
  if (doc.documentElement?.tagName !== 'Montage') {
    throw new Error('Not a valid AnyWave montage file: missing <Montage> root element');
  }

  const channelEls = doc.querySelectorAll('Channel');
  if (channelEls.length === 0) {
    throw new Error('Not a valid AnyWave montage file: no <Channel> entries found');
  }

  const rows = [];
  const channelTypes = {};
  for (const el of channelEls) {
    const name = el.getAttribute('name');
    if (!name)
      throw new Error('Not a valid AnyWave montage file: <Channel> missing name attribute');

    const typeText = (el.querySelector('type')?.textContent ?? '').trim().toLowerCase();
    const referenceText = (el.querySelector('reference')?.textContent ?? '').trim();
    const colorText = (el.querySelector('color')?.textContent ?? '').trim();
    // AnyWave always renders on a black canvas, so its files use the literal 'black' or
    // 'white' to mean "no color explicitly chosen" — not an intentional color pick. This
    // app's "Default" (color: null) is theme-adaptive, so fold both of AnyWave's
    // default spellings into null rather than rendering them literally (invisible in
    // dark mode / light mode respectively).
    const isAnyWaveDefaultColor = ['black', 'white'].includes(colorText.toLowerCase());
    const color = colorText && !isAnyWaveDefaultColor ? colorText : null;

    channelTypes[name] = TYPE_MAP[typeText] ?? 'other';
    rows.push({ channel: name, reference: referenceText || null, color });
  }

  return { rows, channelTypes };
}
