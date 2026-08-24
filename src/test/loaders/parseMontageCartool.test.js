import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCartoolMontage } from '@/loaders/parseMontageCartool';

const FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url));
const CARTOOL_FIXTURE = readFileSync(
  path.join(FIXTURE_DIR, '../../../public/montage_files/Cartool_montage_file.mtg'),
  'utf-8'
);

describe('parseCartoolMontage', () => {
  it('parses the real Cartool sample file', () => {
    const { rows, channelTypes } = parseCartoolMontage(CARTOOL_FIXTURE);
    expect(rows).toHaveLength(18);
    expect(channelTypes).toEqual({});
    expect(rows[0]).toEqual({ channel: 'FP2', reference: 'F8', color: null });
    expect(rows.every((r) => r.reference !== null)).toBe(true);
  });

  it('discards the trailing-tab line cleanly', () => {
    const { rows } = parseCartoolMontage(CARTOOL_FIXTURE);
    expect(rows.find((r) => r.channel === 'C3')).toEqual({
      channel: 'C3',
      reference: 'P3',
      color: null,
    });
  });

  it('throws on empty text', () => {
    expect(() => parseCartoolMontage('')).toThrow();
  });

  it('throws when there are no data lines after the name line', () => {
    expect(() => parseCartoolMontage('MT01\n')).toThrow();
  });

  it('throws on a data line with no tab', () => {
    expect(() => parseCartoolMontage('MT01\nFP2 F8\n')).toThrow();
  });

  it('throws on a data line with three or more fields', () => {
    expect(() => parseCartoolMontage('MT01\nFP2\tF8\tT4\n')).toThrow();
  });
});
