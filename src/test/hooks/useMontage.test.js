import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMontageChannels } from '@/hooks/useMontage';

const setup = (channelNames) =>
  renderHook(({ channelNames }) => useMontageChannels(channelNames), {
    initialProps: { channelNames },
  });

describe('useMontageChannels — seeding', () => {
  it('starts with no rows — rows are only created explicitly via EegMontageEditor', () => {
    const { result } = setup(['FP1', 'FP2']);
    expect(result.current.montageChannels).toEqual([]);
  });
});

describe('useMontageChannels — channelNames changes', () => {
  it('does not add a row for a newly-added channel', () => {
    const { result, rerender } = setup(['FP1']);
    act(() => rerender({ channelNames: ['FP1', 'FP2'] }));
    expect(result.current.montageChannels).toEqual([]);
  });

  it('drops the row for a channel no longer present', () => {
    const { result, rerender } = setup(['FP1', 'FP2']);
    act(() =>
      result.current.applyMontageChannels([
        { id: 'row-1', channel: 'FP1', reference: null, color: null },
        { id: 'row-2', channel: 'FP2', reference: null, color: null },
      ])
    );
    act(() => rerender({ channelNames: ['FP1'] }));
    expect(result.current.montageChannels).toEqual([
      { id: 'row-1', channel: 'FP1', reference: null, color: null },
    ]);
  });

  it('preserves reference/color for a channel that persists across a channelNames change', () => {
    const { result, rerender } = setup(['FP1', 'FP2']);
    act(() =>
      result.current.applyMontageChannels([
        { id: 'row-1', channel: 'FP1', reference: 'FP2', color: 'red' },
        { id: 'row-2', channel: 'FP2', reference: null, color: null },
      ])
    );
    act(() => rerender({ channelNames: ['FP1', 'FP3'] }));
    expect(result.current.montageChannels).toEqual([
      { id: 'row-1', channel: 'FP1', reference: 'FP2', color: 'red' },
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
