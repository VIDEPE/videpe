import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMontageChannels } from '@/hooks/useMontage';

const setup = (channelNames, fileTemplates) =>
  renderHook(({ channelNames, fileTemplates }) => useMontageChannels(channelNames, fileTemplates), {
    initialProps: { channelNames, fileTemplates },
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

describe('useMontageChannels — montageTemplate', () => {
  it('is "none" when there are no montage rows', () => {
    const { result } = setup(['FP1', 'FP2']);
    expect(result.current.montageTemplate).toBe('none');
  });

  it('is "average" when every channel has exactly one row referenced to average', () => {
    const { result } = setup(['FP1', 'FP2']);
    act(() =>
      result.current.applyMontageChannels([
        { id: 'row-1', channel: 'FP1', reference: 'average', color: null },
        { id: 'row-2', channel: 'FP2', reference: 'average', color: null },
      ])
    );
    expect(result.current.montageTemplate).toBe('average');
  });

  it('ignores color when matching the "average" template', () => {
    const { result } = setup(['FP1', 'FP2']);
    act(() =>
      result.current.applyMontageChannels([
        { id: 'row-1', channel: 'FP1', reference: 'average', color: 'red' },
        { id: 'row-2', channel: 'FP2', reference: 'average', color: null },
      ])
    );
    expect(result.current.montageTemplate).toBe('average');
  });

  it('is "custom" when the rows don\'t match a built-in template', () => {
    const { result } = setup(['FP1', 'FP2']);
    act(() =>
      result.current.applyMontageChannels([
        { id: 'row-1', channel: 'FP1', reference: 'FP2', color: null },
      ])
    );
    expect(result.current.montageTemplate).toBe('custom');
  });

  it('is "custom", not "average", when only some channels are average-referenced', () => {
    const { result } = setup(['FP1', 'FP2']);
    act(() =>
      result.current.applyMontageChannels([
        { id: 'row-1', channel: 'FP1', reference: 'average', color: null },
      ])
    );
    expect(result.current.montageTemplate).toBe('custom');
  });
});

describe('useMontageChannels — montageTemplate (file-backed templates)', () => {
  const doubleBanana = {
    path: 'montage_files/double-banana_10-20.mtg',
    rows: [
      { channel: 'FP1', reference: 'F7', color: 'yellow' },
      { channel: 'F7', reference: 'FP2', color: 'yellow' },
    ],
  };

  it("reflects the template's path when the applied rows exactly match a file-backed template", () => {
    const { result } = setup(['FP1', 'F7', 'FP2'], [doubleBanana]);
    act(() =>
      result.current.applyMontageChannels([
        { id: 'row-1', channel: 'FP1', reference: 'F7', color: 'yellow' },
        { id: 'row-2', channel: 'F7', reference: 'FP2', color: 'yellow' },
      ])
    );
    expect(result.current.montageTemplate).toBe(doubleBanana.path);
  });

  it('matches regardless of row order', () => {
    const { result } = setup(['FP1', 'F7', 'FP2'], [doubleBanana]);
    act(() =>
      result.current.applyMontageChannels([
        { id: 'row-2', channel: 'F7', reference: 'FP2', color: 'yellow' },
        { id: 'row-1', channel: 'FP1', reference: 'F7', color: 'yellow' },
      ])
    );
    expect(result.current.montageTemplate).toBe(doubleBanana.path);
  });

  it('is "custom" once a row is edited away from the matching template', () => {
    const { result } = setup(['FP1', 'F7', 'FP2'], [doubleBanana]);
    act(() =>
      result.current.applyMontageChannels([
        { id: 'row-1', channel: 'FP1', reference: 'F7', color: 'red' },
        { id: 'row-2', channel: 'F7', reference: 'FP2', color: 'yellow' },
      ])
    );
    expect(result.current.montageTemplate).toBe('custom');
  });
});

describe('useMontageChannels — customMontageChannels', () => {
  it('starts null — no custom montage has been set yet', () => {
    const { result } = setup(['FP1', 'FP2']);
    expect(result.current.customMontageChannels).toBeNull();
  });

  it('captures the rows once they stop matching a built-in template', () => {
    const { result } = setup(['FP1', 'FP2']);
    const custom = [{ id: 'row-1', channel: 'FP1', reference: 'FP2', color: null }];
    act(() => result.current.applyMontageChannels(custom));
    expect(result.current.customMontageChannels).toEqual(custom);
  });

  it('keeps the last custom snapshot after switching to a built-in template', () => {
    const { result } = setup(['FP1', 'FP2']);
    const custom = [{ id: 'row-1', channel: 'FP1', reference: 'FP2', color: null }];
    act(() => result.current.applyMontageChannels(custom));
    act(() => result.current.applyMontageChannels([]));
    expect(result.current.customMontageChannels).toEqual(custom);
  });
});

describe('useMontageChannels — applyMontageTemplate', () => {
  it('"none" clears every montage row', () => {
    const { result } = setup(['FP1', 'FP2']);
    act(() =>
      result.current.applyMontageChannels([
        { id: 'row-1', channel: 'FP1', reference: null, color: null },
      ])
    );
    act(() => result.current.applyMontageTemplate('none'));
    expect(result.current.montageChannels).toEqual([]);
  });

  it('"average" replaces the rows with one average-referenced row per channel', () => {
    const { result } = setup(['FP1', 'FP2']);
    act(() => result.current.applyMontageTemplate('average'));
    expect(result.current.montageChannels.map((row) => row.channel)).toEqual(['FP1', 'FP2']);
    expect(
      result.current.montageChannels.every(
        (row) => row.reference === 'average' && row.color === null
      )
    ).toBe(true);
  });

  it('"custom" restores the last custom snapshot', () => {
    const { result } = setup(['FP1', 'FP2']);
    const custom = [{ id: 'row-1', channel: 'FP1', reference: 'FP2', color: 'red' }];
    act(() => result.current.applyMontageChannels(custom));
    act(() => result.current.applyMontageTemplate('none'));
    act(() => result.current.applyMontageTemplate('custom'));
    expect(result.current.montageChannels).toEqual(custom);
  });

  it('"custom" is a no-op when there is no custom snapshot to restore', () => {
    const { result } = setup(['FP1', 'FP2']);
    act(() => result.current.applyMontageTemplate('custom'));
    expect(result.current.montageChannels).toEqual([]);
  });
});
