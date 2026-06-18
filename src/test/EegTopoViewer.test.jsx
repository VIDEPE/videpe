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
  updateGLVolume: vi.fn(),
  setSliceType: vi.fn(),
  opts: {},
  meshes: [],
};

vi.mock('@niivue/niivue', () => ({
  Niivue: vi.fn().mockImplementation(function () {
    return mockNvInstance;
  }),
  NVMesh: {
    // Return a fresh mesh object per call so Object.assign mutations in one test
    // don't bleed into the next (mockResolvedValue reuses the same reference).
    loadFromUrl: vi.fn().mockImplementation(async () => ({
      id: 'mesh-0',
      layers: [{ colormap: 'gray', cal_min: 0, cal_max: 1, opacity: 1 }],
      updateMesh: vi.fn(),
    })),
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
  nvRef: { current: mockNvInstance },
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
    await act(async () => render(<EegTopoViewer {...defaultProps} />));
    expect(mockNvInstance.attachToCanvas).toHaveBeenCalled();
  });

  it('builds and loads a mesh when voltages are provided', async () => {
    const { NVMeshUtilities, NVMesh } = await import('@niivue/niivue');
    await act(async () => render(<EegTopoViewer {...defaultProps} />));
    expect(NVMeshUtilities.createMZ3).toHaveBeenCalled();
    expect(NVMesh.loadFromUrl).toHaveBeenCalled();
  });

  describe('mount initialisation', () => {
    it('calls setSliceType with SLICE_TYPE.RENDER on mount', async () => {
      const { SLICE_TYPE } = await import('@niivue/niivue');
      await act(async () => render(<EegTopoViewer {...defaultProps} />));
      expect(mockNvInstance.setSliceType).toHaveBeenCalledWith(SLICE_TYPE.RENDER);
    });

    it('calls onTopoNvReady after attaching to canvas', async () => {
      const onTopoNvReady = vi.fn();
      await act(async () =>
        render(<EegTopoViewer {...defaultProps} onTopoNvReady={onTopoNvReady} />)
      );
      expect(mockNvInstance.attachToCanvas).toHaveBeenCalled();
      expect(onTopoNvReady).toHaveBeenCalledOnce();
    });
  });

  describe('mesh loading', () => {
    it('clears nv.meshes before loading a new mesh', async () => {
      // Pre-populate so there is a stale mesh to clear
      mockNvInstance.meshes = [{ id: 'stale-mesh' }];
      await act(async () => render(<EegTopoViewer {...defaultProps} />));
      // Component sets nv.meshes = [] synchronously before awaiting loadFromUrl;
      // addMesh is a no-op mock so meshes stays empty after the load.
      expect(mockNvInstance.meshes).toHaveLength(0);
    });

    it('sets blue2red colormap on the loaded mesh layer', async () => {
      await act(async () => render(<EegTopoViewer {...defaultProps} />));
      const addedMesh = mockNvInstance.addMesh.mock.calls[0][0];
      expect(addedMesh.layers[0].colormap).toBe('blue2red');
    });

    it('sets symmetric cal_min and cal_max on the mesh layer', async () => {
      await act(async () => render(<EegTopoViewer {...defaultProps} />));
      // VOLTAGES=[10,-5], averageReference → [7.5,-7.5], calMax = 7.5
      const addedMesh = mockNvInstance.addMesh.mock.calls[0][0];
      expect(addedMesh.layers[0].cal_max).toBe(7.5);
      expect(addedMesh.layers[0].cal_min).toBe(-7.5);
    });

    it('does not load a mesh when voltages is empty', async () => {
      const { NVMesh } = await import('@niivue/niivue');
      await act(async () => render(<EegTopoViewer {...defaultProps} voltages={[]} />));
      expect(NVMesh.loadFromUrl).not.toHaveBeenCalled();
    });
  });

  describe('re-referencing', () => {
    it('reloads the mesh when re-referencing is changed to median', async () => {
      const { NVMesh } = await import('@niivue/niivue');
      await act(async () => render(<EegTopoViewer {...defaultProps} />));
      expect(NVMesh.loadFromUrl).toHaveBeenCalledTimes(1);

      await act(async () => {
        await userEvent.selectOptions(screen.getByLabelText(/re-referencing/i), 'median');
      });
      expect(NVMesh.loadFromUrl).toHaveBeenCalledTimes(2);
    });

    it('reloads the mesh when re-referencing is changed to none', async () => {
      const { NVMesh } = await import('@niivue/niivue');
      await act(async () => render(<EegTopoViewer {...defaultProps} />));

      await act(async () => {
        await userEvent.selectOptions(screen.getByLabelText(/re-referencing/i), 'none');
      });
      expect(NVMesh.loadFromUrl).toHaveBeenCalledTimes(2);
    });

    it('uses raw voltages when re-referencing is none', async () => {
      await act(async () => render(<EegTopoViewer {...defaultProps} />));

      await act(async () => {
        await userEvent.selectOptions(screen.getByLabelText(/re-referencing/i), 'none');
      });

      // Raw VOLTAGES=[10,-5]: calMax = max(|10|,|-5|) = 10, vs average-referenced 7.5
      const secondMesh = mockNvInstance.addMesh.mock.calls[1][0];
      expect(secondMesh.layers[0].cal_max).toBe(10);
    });
  });

  describe('electrode source', () => {
    it('shows "Default: Standard 10-05" label when isStandardElectrodes is true', async () => {
      await act(async () =>
        render(<EegTopoViewer {...defaultProps} isStandardElectrodes={true} />)
      );
      expect(screen.getByText(/default: standard 10-05/i)).toBeTruthy();
    });

    it('shows the filename (without extension) after a custom file is loaded', async () => {
      const onElcFile = vi.fn();
      const { container } = await act(async () =>
        render(
          <EegTopoViewer {...defaultProps} isStandardElectrodes={false} onElcFile={onElcFile} />
        )
      );
      const file = new File(['# ASA electrode file'], 'my_cap.elc');
      const input = container.querySelector('input[type="file"]');
      await userEvent.upload(input, file);
      expect(screen.getByText('my_cap')).toBeTruthy();
    });

    it('renders a "Use custom positions" button', async () => {
      await act(async () =>
        render(<EegTopoViewer {...defaultProps} isStandardElectrodes={true} />)
      );
      expect(screen.getByRole('button', { name: /use custom positions/i })).toBeTruthy();
    });

    it('calls onElcFile with the selected File when a positions file is chosen', async () => {
      const onElcFile = vi.fn();
      const { container } = await act(async () =>
        render(
          <EegTopoViewer {...defaultProps} isStandardElectrodes={true} onElcFile={onElcFile} />
        )
      );
      const file = new File(['# ASA electrode file'], 'custom.elc');
      const input = container.querySelector('input[type="file"]');
      await userEvent.upload(input, file);
      expect(onElcFile).toHaveBeenCalledWith(file);
    });
  });

  describe('maximize / restore', () => {
    it('changes the button label to Restore after clicking Maximize', async () => {
      await act(async () => render(<EegTopoViewer {...defaultProps} />));
      await userEvent.click(screen.getByRole('button', { name: /maximize/i }));
      expect(screen.getByRole('button', { name: /restore/i })).toBeTruthy();
    });

    it('changes the button label back to Maximize after clicking Restore', async () => {
      await act(async () => render(<EegTopoViewer {...defaultProps} />));
      await userEvent.click(screen.getByRole('button', { name: /maximize/i }));
      await userEvent.click(screen.getByRole('button', { name: /restore/i }));
      expect(screen.getByRole('button', { name: /maximize/i })).toBeTruthy();
    });
  });
});
