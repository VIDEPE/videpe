const TYPE_LABEL = { eeg: 'EEG', seeg: 'SEEG', other: 'Other' };

// Minimal XML-attribute/text escaping so a channel name containing &, <, >, or " can't
// break the surrounding XML structure.
function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Converts the current montage-editor draft (rows + channel types) into AnyWave montage
 * XML text — the inverse of parseAnyWaveMontage. Save always calls this, regardless of
 * whether the draft was built by hand, loaded from an AnyWave file, or loaded from a
 * Cartool file — there is no Cartool export path.
 *
 * @param {Array<{channel: string, reference: string|null, color: string|null, highPass: number|null, lowPass: number|null, notch: number|null}>} rows
 *   The draft montage-row list as edited in EegMontageEditor.
 * @param {Record<string, {type: 'eeg'|'seeg'|'other', bad: boolean}>} channelSettings
 *   The draft channel-selection state — only each row's `channel`'s `type` is read from
 *   here; `bad` isn't part of the AnyWave format and is ignored.
 * @returns {string} AnyWave montage XML text, ready for downloadTextFile.
 */
export function toAnyWaveMontage(rows, channelSettings) {
  const channelsXml = rows
    .map((row) => {
      const type = TYPE_LABEL[channelSettings[row.channel]?.type ?? 'eeg'];
      // AnyWave always writes a <filters> element, using -1 for an off highPass/lowPass
      // and 0 for an off notch — see parseAnyWaveMontage for the matching off-sentinels.
      return [
        `  <Channel name="${escapeXml(row.channel)}">`,
        `    <type>${type}</type>`,
        `    <reference>${escapeXml(row.reference ?? '')}</reference>`,
        `    <color>${escapeXml(row.color ?? '')}</color>`,
        `    <filters highPass="${row.highPass ?? -1}" lowPass="${row.lowPass ?? -1}" notch="${row.notch ?? 0}"/>`,
        `  </Channel>`,
      ].join('\n');
    })
    .join('\n');

  return `<!DOCTYPE AnyWaveMontage>\n<Montage>\n${channelsXml}\n</Montage>`;
}
