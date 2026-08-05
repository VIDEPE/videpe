import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMontageChannels } from '@/hooks/useMontage';

const setup = (channelNames) =>
  renderHook(({ channelNames }) => useMontageChannels(channelNames), {
    initialProps: { channelNames },
  });

describe('useMontageChannels — seeding', () => {
  it('seeds one row per channel with reference:null and color:null', () => {
    const { result } = setup(['FP1', 'FP2']);
    expect(result.current.montageChannels).toEqual([
      { id: 'FP1', channel: 'FP1', reference: null, color: null },
      { id: 'FP2', channel: 'FP2', reference: null, color: null },
    ]);
  });

  it('preserves row order from channelNames', () => {
    const { result } = setup(['FP2', 'FP1']);
    expect(result.current.montageChannels.map((row) => row.channel)).toEqual(['FP2', 'FP1']);
  });
});

describe('useMontageChannels — channelNames changes', () => {
  it('adds a row for a newly-added channel', () => {
    const { result, rerender } = setup(['FP1']);
    act(() => rerender({ channelNames: ['FP1', 'FP2'] }));
    expect(result.current.montageChannels).toContainEqual({
      id: 'FP2',
      channel: 'FP2',
      reference: null,
      color: null,
    });
  });

  it('drops the row for a channel no longer present', () => {
    const { result, rerender } = setup(['FP1', 'FP2']);
    act(() => rerender({ channelNames: ['FP1'] }));
    expect(result.current.montageChannels.map((row) => row.channel)).toEqual(['FP1']);
  });

  it('preserves reference/color for a channel that persists across a channelNames change', () => {
    const { result, rerender } = setup(['FP1', 'FP2']);
    act(() =>
      result.current.applyMontageChannels([
        { id: 'FP1', channel: 'FP1', reference: 'FP2', color: 'red' },
        { id: 'FP2', channel: 'FP2', reference: null, color: null },
      ])
    );
    act(() => rerender({ channelNames: ['FP1', 'FP3'] }));
    expect(result.current.montageChannels).toEqual([
      { id: 'FP1', channel: 'FP1', reference: 'FP2', color: 'red' },
      { id: 'FP3', channel: 'FP3', reference: null, color: null },
    ]);
  });
});

describe('useMontageChannels — applyMontageChannels', () => {
  it('replaces montageChannels with the rows that are passed in', () => {
    const { result } = setup(['FP1', 'FP2']);
    const draft = [
      { id: 'FP1', channel: 'FP1', reference: 'FP2', color: 'blue' },
      { id: 'FP2', channel: 'FP2', reference: null, color: 'green' },
    ];
    act(() => result.current.applyMontageChannels(draft));
    expect(result.current.montageChannels).toEqual(draft);
  });
});
