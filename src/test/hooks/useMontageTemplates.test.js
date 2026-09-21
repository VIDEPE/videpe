import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMontageTemplates } from '@/hooks/useMontageTemplates';

// react-hot-toast's default export is itself a callable function with .loading/.success/etc
// attached — a plain object mock would make the hook's toast.error(...) call throw silently.
vi.mock('react-hot-toast', () => {
  const toastFn = vi.fn();
  toastFn.loading = vi.fn();
  toastFn.success = vi.fn();
  toastFn.error = vi.fn();
  toastFn.dismiss = vi.fn();
  return { default: toastFn };
});

const ANYWAVE_TEXT = `<!DOCTYPE AnyWaveMontage>
<Montage>
	<Channel name="FP1">
		<type>EEG</type>
		<reference></reference>
		<color>darkblue</color>
	</Channel>
</Montage>`;

const CARTOOL_TEXT = 'MT01\nFP1\tF3\n';

const TEMPLATE_LIST = [
  { name: 'AnyWave Template', path: 'montage_files/anywave.mtg' },
  { name: 'Cartool Template', path: 'montage_files/cartool.mtg' },
];

const mockFetchByUrl = (routes) => {
  global.fetch = vi.fn((url) => {
    if (url in routes) return Promise.resolve({ text: () => Promise.resolve(routes[url]) });
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
};

beforeEach(() => {
  mockFetchByUrl({
    'montage_files/TEMPLATE_MONTAGES.json': JSON.stringify(TEMPLATE_LIST),
    'montage_files/anywave.mtg': ANYWAVE_TEXT,
    'montage_files/cartool.mtg': CARTOOL_TEXT,
  });
});

describe('useMontageTemplates', () => {
  it('fetches the template list on mount', async () => {
    renderHook(() => useMontageTemplates());
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('montage_files/TEMPLATE_MONTAGES.json')
    );
  });

  it('fetches and parses every file listed in the template list', async () => {
    const { result } = renderHook(() => useMontageTemplates());
    await waitFor(() => expect(result.current).toHaveLength(2));

    expect(result.current[0]).toEqual({
      name: 'AnyWave Template',
      path: 'montage_files/anywave.mtg',
      rows: [{ channel: 'FP1', reference: null, color: 'darkblue' }],
      channelTypes: { FP1: 'eeg' },
    });
    expect(result.current[1]).toEqual({
      name: 'Cartool Template',
      path: 'montage_files/cartool.mtg',
      rows: [{ channel: 'FP1', reference: 'F3', color: null }],
      channelTypes: {},
    });
  });

  it('starts with an empty list before the fetch resolves', () => {
    const { result } = renderHook(() => useMontageTemplates());
    expect(result.current).toEqual([]);
  });

  it('skips a template whose file fails to parse and toasts an error, keeping the rest', async () => {
    const { default: toast } = await import('react-hot-toast');
    mockFetchByUrl({
      'montage_files/TEMPLATE_MONTAGES.json': JSON.stringify(TEMPLATE_LIST),
      'montage_files/anywave.mtg': 'not a montage file',
      'montage_files/cartool.mtg': CARTOOL_TEXT,
    });

    const { result } = renderHook(() => useMontageTemplates());
    await waitFor(() => expect(result.current).toHaveLength(1));

    expect(result.current[0].name).toBe('Cartool Template');
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('AnyWave Template'));
  });

  it('silently returns an empty list when the template list fetch fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useMontageTemplates());
    expect(() => renderHook(() => useMontageTemplates())).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toEqual([]);
  });
});
