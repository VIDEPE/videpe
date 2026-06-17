import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EegTopoViewer } from '@/components/EegTopoViewer';

// ── NiiVue mock ──────────────────────────────────────────────────────────────
// NiiVue requires WebGL which jsdom does not provide. Mock the minimal API
// surface EegTopoViewer uses so tests run headlessly.

const mockNvInstance = {
  attachToCanvas: vi.fn(),
  addMesh: vi.fn(),
  setSliceType: vi.fn(),
  opts: {},
  meshes: [],
};

vi.mock('@niivue/niivue', () => ({
  Niivue: vi.fn().mockImplementation(function () {
    return mockNvInstance;
  }),
  NVMesh: {
    loadFromUrl: vi.fn().mockResolvedValue({ id: 'mesh-0' }),
  },
  NVMeshUtilities: {
    createMZ3: vi.fn().mockReturnValue(new ArrayBuffer(16)),
  },
  SLICE_TYPE: { RENDER: 4 },
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ELECTRODES = [
  { label: 'Fp1', x: -29, y: 84, z: -7 },
  { label: 'Fp2', x: 29, y: 84, z: -7 },
  { label: 'Cz', x: 0, y: 0, z: 88 },
];

const MATCHED = [
  { channelIdx: 0, name: 'Fp1', pos: ELECTRODES[0] },
  { channelIdx: 2, name: 'Cz', pos: ELECTRODES[2] },
];

const VOLTAGES = [10, -5];
const TOTAL_CHANNELS = 10;

const defaultProps = {
  electrodes: ELECTRODES,
  matched: MATCHED,
  voltages: VOLTAGES,
  totalChannels: TOTAL_CHANNELS,
  onClose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockNvInstance.meshes = [];
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EegTopoViewer', () => {
  it('renders without crashing', async () => {
    const { container } = await act(async () => render(<EegTopoViewer {...defaultProps} />));
    expect(container.firstChild).toBeTruthy();
  });

  it('renders a canvas element for the NiiVue instance', async () => {
    const { container } = await act(async () => render(<EegTopoViewer {...defaultProps} />));
    expect(container.querySelector('canvas')).toBeTruthy();
  });

  it('shows matched vs total channel count in the footer', async () => {
    await act(async () => render(<EegTopoViewer {...defaultProps} />));
    expect(screen.getByText(/2\s*\/\s*10\s*channels mapped/i)).toBeTruthy();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    await act(async () => render(<EegTopoViewer {...defaultProps} onClose={onClose} />));
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders a Re-referencing label with a dropdown defaulting to average', async () => {
    await act(async () => render(<EegTopoViewer {...defaultProps} />));
    expect(screen.getByText('Re-referencing')).toBeTruthy();
    const select = screen.getByLabelText(/re-referencing/i);
    expect(select.value).toBe('average');
  });

  it('re-referencing dropdown has None, Average, and Median options', async () => {
    await act(async () => render(<EegTopoViewer {...defaultProps} />));
    const select = screen.getByLabelText(/re-referencing/i);
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain('none');
    expect(values).toContain('average');
    expect(values).toContain('median');
  });

  it('renders a maximize button', async () => {
    await act(async () => render(<EegTopoViewer {...defaultProps} />));
    expect(screen.getByRole('button', { name: /maximize/i })).toBeTruthy();
  });

  it('attaches NiiVue to the canvas on mount', async () => {
    const { Niivue } = await import('@niivue/niivue');
    await act(async () => render(<EegTopoViewer {...defaultProps} />));
    expect(Niivue).toHaveBeenCalled();
    expect(mockNvInstance.attachToCanvas).toHaveBeenCalled();
  });

  it('builds and loads a mesh when voltages are provided', async () => {
    const { NVMeshUtilities, NVMesh } = await import('@niivue/niivue');
    await act(async () => render(<EegTopoViewer {...defaultProps} />));
    expect(NVMeshUtilities.createMZ3).toHaveBeenCalled();
    expect(NVMesh.loadFromUrl).toHaveBeenCalled();
  });
});
