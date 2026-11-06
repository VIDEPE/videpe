import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseMontageText } from '@/loaders/parseMontageText';

const FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ANYWAVE_FIXTURE = readFileSync(
  path.join(FIXTURE_DIR, '../../assets/montage_files/AnyWave_montage_file.mtg'),
  'utf-8'
);
const CARTOOL_FIXTURE = readFileSync(
  path.join(FIXTURE_DIR, '../../assets/montage_files/Cartool_montage_file.mtg'),
  'utf-8'
);

describe('parseMontageText', () => {
  it('routes AnyWave (XML) content to parseAnyWaveMontage', () => {
    const { rows } = parseMontageText(ANYWAVE_FIXTURE);
    // Only AnyWave parsing ever produces a non-null color — Cartool rows always have color: null.
    expect(rows[0].color).toBe('darkblue');
  });

  it('routes Cartool (plain text) content to parseCartoolMontage', () => {
    const { rows, channelTypes } = parseMontageText(CARTOOL_FIXTURE);
    expect(rows.every((r) => r.reference !== null)).toBe(true);
    expect(rows[0].color).toBeNull();
    expect(channelTypes).toEqual({});
  });

  it('routes to AnyWave parsing even with leading whitespace before <!DOCTYPE', () => {
    const { rows } = parseMontageText(`  \n${ANYWAVE_FIXTURE}`);
    expect(rows[0].color).toBe('darkblue');
  });

  it('throws when content matches neither format', () => {
    expect(() => parseMontageText('not a montage file')).toThrow();
  });
});
