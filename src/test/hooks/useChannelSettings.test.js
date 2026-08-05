import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChannelSettings } from '@/hooks/useChannelSettings';

const setup = (channelNames, defaultType) =>
  renderHook(({ channelNames, defaultType }) => useChannelSettings(channelNames, defaultType), {
    initialProps: { channelNames, defaultType },
  });

describe('useChannelSettings — seeding', () => {
  const defaultTypes = ['eeg', 'seeg'];

  defaultTypes.forEach((defaultType) => {
    it(`seeds every channel with the given ${defaultType} and bad:false`, () => {
      const { result } = setup(['FP1', 'FP2'], defaultType);
      expect(result.current.channelSettings).toEqual({
        FP1: { type: defaultType, bad: false },
        FP2: { type: defaultType, bad: false },
      });
    });
  });

  it('defaults to type "eeg" when defaultType is omitted', () => {
    const { result } = setup(['FP1'], undefined);
    expect(result.current.channelSettings.FP1.type).toBe('eeg');
  });
});

describe('useChannelSettings — defaultType changes', () => {
  // Regression guard: isIntracranial detection resolves asynchronously and often changes
  // defaultType a render or two after channelNames first arrives, once the earlier seed
  // already locked every channel to the wrong type — this must still pick up the correction.
  it('re-applies the new defaultType to every existing channel', () => {
    const { result, rerender } = setup(['FP1', 'FP2'], 'eeg');
    act(() => rerender({ channelNames: ['FP1', 'FP2'], defaultType: 'seeg' }));
    expect(result.current.channelSettings.FP1.type).toBe('seeg');
    expect(result.current.channelSettings.FP2.type).toBe('seeg');
  });

  it("preserves each channel's bad flag when defaultType changes", () => {
    const { result, rerender } = setup(['FP1'], 'eeg');
    act(() => result.current.applyChannelSettings({ FP1: { type: 'eeg', bad: true } }));
    act(() => rerender({ channelNames: ['FP1'], defaultType: 'seeg' }));
    expect(result.current.channelSettings.FP1).toEqual({ type: 'seeg', bad: true });
  });
});

describe('useChannelSettings — channelNames changes', () => {
  it('seeds newly-added channels with defaultType and bad:false', () => {
    const { result, rerender } = setup(['FP1'], 'eeg');
    act(() => rerender({ channelNames: ['FP1', 'FP2'], defaultType: 'eeg' }));
    expect(result.current.channelSettings.FP2).toEqual({ type: 'eeg', bad: false });
  });

  it('drops channels no longer present', () => {
    const { result, rerender } = setup(['FP1', 'FP2'], 'eeg');
    act(() => rerender({ channelNames: ['FP1'], defaultType: 'eeg' }));
    expect(result.current.channelSettings).not.toHaveProperty('FP2');
  });

  it('preserves bad flags for channels that persist across a channelNames change', () => {
    const { result, rerender } = setup(['FP1', 'FP2'], 'eeg');
    act(() =>
      result.current.applyChannelSettings({
        FP1: { type: 'eeg', bad: true },
        FP2: { type: 'eeg', bad: false },
      })
    );
    act(() => rerender({ channelNames: ['FP1', 'FP3'], defaultType: 'eeg' }));
    expect(result.current.channelSettings.FP1.bad).toBe(true);
    expect(result.current.channelSettings.FP3).toEqual({ type: 'eeg', bad: false });
    expect(result.current.channelSettings).not.toHaveProperty('FP2');
  });
});

describe('useChannelSettings — applyChannelSettings', () => {
  it('replaces channelSettings with new settings that are passed in', () => {
    // initialise channelSettings
    const { result } = setup(['FP1', 'FP2'], 'eeg');
    // create new channelSettings with different values
    const draft = { FP1: { type: 'other', bad: true }, FP2: { type: 'seeg', bad: false } };
    act(() => result.current.applyChannelSettings(draft));
    expect(result.current.channelSettings).toEqual(draft);
  });
});
