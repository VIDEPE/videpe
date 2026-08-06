import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseMontageFile } from '@/loaders/parseMontageFile';

const FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ANYWAVE_FIXTURE = readFileSync(
  path.join(FIXTURE_DIR, '../../../public/montage_files/AnyWave_montage_file.mtg'),
  'utf-8'
);
const CARTOOL_FIXTURE = readFileSync(
  path.join(FIXTURE_DIR, '../../../public/montage_files/Cartool_montage_file.mtg'),
  'utf-8'
);

describe('parseMontageFile', () => {
  it('routes AnyWave (XML) content to parseAnyWaveMontage', async () => {
    const file = new File([ANYWAVE_FIXTURE], 'x.mtg');
    const { rows } = await parseMontageFile(file);
    // Only AnyWave parsing ever produces a non-null color — Cartool rows always have color: null.
    expect(rows[0].color).toBe('darkblue');
  });

  it('routes Cartool (plain text) content to parseCartoolMontage', async () => {
    const file = new File([CARTOOL_FIXTURE], 'x.mtg');
    const { rows, channelTypes } = await parseMontageFile(file);
    expect(rows.every((r) => r.reference !== null)).toBe(true);
    expect(channelTypes).toEqual({});
  });

  it('dispatches by content, not extension — both fixtures share the .mtg extension', async () => {
    const anyWaveFile = new File([ANYWAVE_FIXTURE], 'same-name.mtg');
    const cartoolFile = new File([CARTOOL_FIXTURE], 'same-name.mtg');
    const anyWaveResult = await parseMontageFile(anyWaveFile);
    const cartoolResult = await parseMontageFile(cartoolFile);
    expect(anyWaveResult.rows[0].color).toBe('darkblue');
    expect(cartoolResult.rows[0].color).toBeNull();
  });

  it('routes to AnyWave parsing even with leading whitespace before <!DOCTYPE', async () => {
    const file = new File([`  \n${ANYWAVE_FIXTURE}`], 'x.mtg');
    const { rows } = await parseMontageFile(file);
    expect(rows[0].color).toBe('darkblue');
  });

  it('propagates a thrown error when content matches neither format', async () => {
    const file = new File(['not a montage file'], 'bad.mtg');
    await expect(parseMontageFile(file)).rejects.toThrow();
  });
});
