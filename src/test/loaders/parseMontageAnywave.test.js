import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseAnyWaveMontage } from '@/loaders/parseMontageAnywave';

// path.join + fileURLToPath (not `new URL(..., import.meta.url)`) — Vite's import-analysis
// plugin statically rewrites that pattern into a public-asset URL reference, which breaks
// plain Node readFileSync under Vitest.
const FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ANYWAVE_FIXTURE = readFileSync(
  path.join(FIXTURE_DIR, '../../../public/montage_files/AnyWave_montage_file.mtg'),
  'utf-8'
);

describe('parseAnyWaveMontage', () => {
  it('parses the real AnyWave sample file', () => {
    const { rows, channelTypes } = parseAnyWaveMontage(ANYWAVE_FIXTURE);
    expect(rows).toHaveLength(25);
    expect(rows[0]).toEqual({ channel: 'FP2', reference: null, color: 'darkblue' });
    expect(rows.every((r) => r.reference === null)).toBe(true);
    expect(rows.every((r) => channelTypes[r.channel] === 'eeg')).toBe(true);
  });

  it.each(['black', 'white', 'Black', 'WHITE'])(
    'treats <color>%s</color> as the theme default (null), not a literal color',
    (colorText) => {
      const xml = `<!DOCTYPE AnyWaveMontage>
<Montage>
	<Channel name="F3">
		<type>EEG</type>
		<reference></reference>
		<color>${colorText}</color>
	</Channel>
</Montage>`;
      const { rows } = parseAnyWaveMontage(xml);
      expect(rows[0].color).toBeNull();
    }
  );

  it('reads a non-empty <reference> as a bipolar reference', () => {
    const xml = `<!DOCTYPE AnyWaveMontage>
<Montage>
	<Channel name="F3">
		<type>EEG</type>
		<reference>Fz</reference>
		<color>red</color>
	</Channel>
</Montage>`;
    const { rows } = parseAnyWaveMontage(xml);
    expect(rows[0]).toEqual({ channel: 'F3', reference: 'Fz', color: 'red' });
  });

  it.each([
    ['SEEG', 'seeg'],
    ['Other', 'other'],
    ['seeg', 'seeg'],
    ['banana', 'other'],
  ])('maps <type>%s</type> to channelTypes value %s', (typeText, expected) => {
    const xml = `<!DOCTYPE AnyWaveMontage>
<Montage>
	<Channel name="A1">
		<type>${typeText}</type>
		<reference></reference>
		<color></color>
	</Channel>
</Montage>`;
    const { channelTypes } = parseAnyWaveMontage(xml);
    expect(channelTypes.A1).toBe(expected);
  });

  it('throws on non-XML text', () => {
    expect(() => parseAnyWaveMontage('hello world')).toThrow();
  });

  it('throws when the root element is not <Montage>', () => {
    expect(() => parseAnyWaveMontage('<Foo></Foo>')).toThrow();
  });

  it('throws when there are no <Channel> entries', () => {
    expect(() => parseAnyWaveMontage('<!DOCTYPE AnyWaveMontage>\n<Montage></Montage>')).toThrow();
  });

  it('throws when a <Channel> is missing its name attribute', () => {
    const xml = `<!DOCTYPE AnyWaveMontage>
<Montage>
	<Channel>
		<type>EEG</type>
		<reference></reference>
		<color></color>
	</Channel>
</Montage>`;
    expect(() => parseAnyWaveMontage(xml)).toThrow();
  });
});
