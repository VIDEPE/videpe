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

  const channels = doc.querySelectorAll('Channel');
  if (channels.length === 0) {
    throw new Error('Not a valid AnyWave montage file: no <Channel> entries found');
  }

  // initalise rows and channelTypes
  // rows are the montage rows that determine what and how the data is displayed
  // channeltypes is kept seperate as raw channel property to determine what functionality is possible with that channel
  const rows = [];
  const channelTypes = {};

  for (const channel of channels) {
    const name = channel.getAttribute('name');
    if (!name)
      throw new Error('Not a valid AnyWave montage file: <Channel> missing name attribute');

    const typeText = (channel.querySelector('type')?.textContent ?? '').trim().toLowerCase(); // example: <type>EEG</type>
    const referenceText = (channel.querySelector('reference')?.textContent ?? '').trim(); // example: <reference></reference>
    const colorText = (channel.querySelector('color')?.textContent ?? '').trim(); // example: <color>black</color>

    // filters follow a slightly different format: <filters lowPass="-1" highPass="-1" notch="0"/>
    // No <filters> element at all, and a <filters> element missing one of these attributes,
    // are two different "missing" values in the DOM (undefined vs null) that Number() treats
    // inconsistently (Number(undefined) is NaN, but Number(null) is 0) — so both are routed
    // to null explicitly here, before Number() ever runs on either.
    const filtersEl = channel.querySelector('filters');
    const lowPassAttr = filtersEl?.getAttribute('lowPass');
    const highPassAttr = filtersEl?.getAttribute('highPass');
    const notchAttr = filtersEl?.getAttribute('notch');
    // AnyWave always renders on a black canvas, so its files use the literal 'black' or
    // 'white' to mean "no color explicitly chosen" — not an intentional color pick. This
    // app's "Default" (color: null) is theme-adaptive, so fold both of AnyWave's
    // default spellings into null rather than rendering them literally (invisible in
    // dark mode / light mode respectively).
    const isAnyWaveDefaultColor = ['black', 'white'].includes(colorText.toLowerCase());
    const color = colorText && !isAnyWaveDefaultColor ? colorText : null;
    // Anywave uses -1 for inactive lowPass/highPass and 0 for inactive notch.
    const lowPassNum = lowPassAttr != null ? Number(lowPassAttr) : null;
    const highPassNum = highPassAttr != null ? Number(highPassAttr) : null;
    const notchNum = notchAttr != null ? Number(notchAttr) : null;
    const lowPass = !Number.isFinite(lowPassNum) || lowPassNum < 0 ? null : lowPassNum;
    const highPass = !Number.isFinite(highPassNum) || highPassNum < 0 ? null : highPassNum;
    const notch = !Number.isFinite(notchNum) || notchNum <= 0 ? null : notchNum; // note <=0 as anywave saves empty notch as 0, instead of -1

    channelTypes[name] = TYPE_MAP[typeText] ?? 'other';
    rows.push({
      channel: name,
      reference: referenceText || null,
      color,
      highPass,
      lowPass,
      notch,
    });
  }

  return { rows, channelTypes };
}
