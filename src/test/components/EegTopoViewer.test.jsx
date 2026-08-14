import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
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
  addColormap: vi.fn(),
  setMeshShader: vi.fn(),
  // Electrode marker layers are built via nv.loadConnectomeAsMesh(json) + nv.addMesh(mesh);
  // the mock just needs to hand back something Fidentifiable, not a real connectome mesh.
  loadConnectomeAsMesh: vi
    .fn()
    .mockImplementation((json) => ({ id: json.name, nodes: json.nodes })),
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
  mockNvInstance.opts = {};
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

  it('labels the colorbar with its unit, since NiiVue draws it without one', async () => {
    await act(async () => render(<EegTopoViewer {...defaultProps} />));
    expect(screen.getByText('µV')).toBeTruthy();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    await act(async () => render(<EegTopoViewer {...defaultProps} onClose={onClose} />));
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
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

    it('enables the global colorbar switch so the mesh colorbar renders', async () => {
      await act(async () => render(<EegTopoViewer {...defaultProps} />));
      expect(mockNvInstance.opts.isColorbar).toBe(true);
    });

    it('narrows and centers the colorbar so it clears the orientation cube', async () => {
      await act(async () => render(<EegTopoViewer {...defaultProps} />));
      expect(mockNvInstance.opts.colorbarWidth).toBeGreaterThan(0);
      expect(mockNvInstance.opts.colorbarWidth).toBeLessThan(1);
    });

    it('zooms out slightly so the mesh leaves room for the colorbar at the bottom', async () => {
      await act(async () => render(<EegTopoViewer {...defaultProps} />));
      expect(mockNvInstance.volScaleMultiplier).toBeLessThan(1);
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

    it('registers a custom blue-white-red colormap and applies it to the loaded mesh layer', async () => {
      await act(async () => render(<EegTopoViewer {...defaultProps} />));

      expect(mockNvInstance.addColormap).toHaveBeenCalled();
      const [key, cmap] = mockNvInstance.addColormap.mock.calls[0];

      const addedMesh = mockNvInstance.addMesh.mock.calls[0][0];
      // The mesh layer must reference the same colormap that was registered.
      expect(addedMesh.layers[0].colormap).toBe(key);

      // Negative end is pure blue, midpoint (zero) is white, positive end is pure red —
      // unlike the built-in 'blue2red' map, which passes through green/yellow at zero.
      const lastIdx = cmap.I.length - 1;
      const midIdx = cmap.I.indexOf(128);
      expect([cmap.R[0], cmap.G[0], cmap.B[0]]).toEqual([0, 0, 255]);
      expect([cmap.R[midIdx], cmap.G[midIdx], cmap.B[midIdx]]).toEqual([255, 255, 255]);
      expect([cmap.R[lastIdx], cmap.G[lastIdx], cmap.B[lastIdx]]).toEqual([255, 0, 0]);
    });

    it('sets symmetric cal_min and cal_max on the mesh layer', async () => {
      await act(async () => render(<EegTopoViewer {...defaultProps} />));
      // VOLTAGES=[10,-5]; the component no longer re-references internally,
      // so calMax = max(|10|, |-5|) = 10
      const addedMesh = mockNvInstance.addMesh.mock.calls[0][0];
      expect(addedMesh.layers[0].cal_max).toBe(10);
      expect(addedMesh.layers[0].cal_min).toBe(-10);
    });

    it('does not load a mesh when voltages is empty', async () => {
      const { NVMesh } = await import('@niivue/niivue');
      await act(async () => render(<EegTopoViewer {...defaultProps} voltages={[]} />));
      expect(NVMesh.loadFromUrl).not.toHaveBeenCalled();
    });

    it('applies a shader to each electrode marker layer, using a different shader for unmapped vs matched', async () => {
      await act(async () => render(<EegTopoViewer {...defaultProps} />));

      // Mesh names come from addElectrodeMarkers's loadConnectomeAsMesh calls; the mock
      // loadConnectomeAsMesh hands the `name` back as `id`, so these are the mesh ids
      // setMeshShader should have been called with.
      const unmappedCall = mockNvInstance.setMeshShader.mock.calls.find(
        ([id]) => id === 'eeg-electrodes-unmapped'
      );
      const matchedCall = mockNvInstance.setMeshShader.mock.calls.find(
        ([id]) => id === 'eeg-electrodes-matched'
      );

      // Regression guard for the mesh/node colour-mismatch bug: both marker layers must get
      // an explicit (non-default) shader, and the two layers must not share the same one —
      // the specific shader names are a styling choice, not something to pin down here.
      expect(unmappedCall).toBeTruthy();
      expect(matchedCall).toBeTruthy();
      expect(unmappedCall[1]).not.toBe(matchedCall[1]);
    });

    it('ignores a stale load that resolves after a newer one has started (StrictMode double-invoke guard)', async () => {
      // Without this guard, React StrictMode's mount->cleanup->mount double-invoke (or a
      // fast voltage change while a load is still in flight) lets the older, superseded
      // call add its own mesh once it resolves — leaving two overlapping meshes, each
      // contributing its own colorbar entry.
      const { NVMesh } = await import('@niivue/niivue');
      const resolvers = [];
      const deferredLoad = () => new Promise((resolve) => resolvers.push(resolve));
      NVMesh.loadFromUrl.mockImplementationOnce(deferredLoad).mockImplementationOnce(deferredLoad);

      const { rerender } = await act(async () => render(<EegTopoViewer {...defaultProps} />));
      await act(async () => {
        rerender(<EegTopoViewer {...defaultProps} voltages={[-3, 0]} />);
      });
      expect(resolvers).toHaveLength(2);

      const makeMesh = (id) => ({
        id,
        layers: [{ colormap: 'gray', cal_min: 0, cal_max: 1, opacity: 1 }],
        updateMesh: vi.fn(),
      });

      // The stale (first) load resolves last — it must not add its mesh.
      await act(async () => resolvers[0](makeMesh('stale-mesh')));
      expect(mockNvInstance.addMesh).not.toHaveBeenCalled();

      // The current (second) load resolving is the only one that should add meshes: the
      // cortex mesh, plus the two electrode marker layers from addElectrodeMarkers — one
      // for unmapped template dots (Fp2, the ELECTRODES entry absent from MATCHED) and one
      // for matched, voltage-coloured dots (Fp1 and Cz). 3 calls total.
      await act(async () => resolvers[1](makeMesh('current-mesh')));
      expect(mockNvInstance.addMesh).toHaveBeenCalledTimes(3);
      expect(mockNvInstance.addMesh.mock.calls[0][0].id).toBe('current-mesh');
    });
  });

  describe('voltages prop changes', () => {
    // Re-referencing now happens upstream in EegViewer — EegTopoViewer just renders
    // whatever voltages it's given, and rebuilds the mesh whenever that prop changes.
    it('reloads the mesh when the voltages prop changes', async () => {
      const { NVMesh } = await import('@niivue/niivue');
      const { rerender } = await act(async () => render(<EegTopoViewer {...defaultProps} />));
      expect(NVMesh.loadFromUrl).toHaveBeenCalledTimes(1);

      await act(async () => {
        rerender(<EegTopoViewer {...defaultProps} voltages={[-3, 0]} />);
      });
      expect(NVMesh.loadFromUrl).toHaveBeenCalledTimes(2);
    });

    it('uses the voltages exactly as provided, without re-referencing them itself', async () => {
      await act(async () => render(<EegTopoViewer {...defaultProps} voltages={[-3, 0]} />));
      // calMax = max(|-3|, |0|) = 3 — confirms no internal re-referencing is applied
      const addedMesh = mockNvInstance.addMesh.mock.calls[0][0];
      expect(addedMesh.layers[0].cal_max).toBe(3);
    });

    it('reuses the same convex-hull vertices/indices across voltage-only updates, instead of re-triangulating', async () => {
      const { NVMeshUtilities } = await import('@niivue/niivue');
      const { rerender } = await act(async () => render(<EegTopoViewer {...defaultProps} />));
      const [firstVertices, firstIndices] = NVMeshUtilities.createMZ3.mock.calls[0];

      await act(async () => {
        rerender(<EegTopoViewer {...defaultProps} voltages={[-3, 0]} />);
      });
      const [secondVertices, secondIndices] = NVMeshUtilities.createMZ3.mock.calls[1];

      expect(secondVertices).toBe(firstVertices);
      expect(secondIndices).toBe(firstIndices);
    });

    it('recomputes the convex hull when the electrodes prop itself changes', async () => {
      const { NVMeshUtilities } = await import('@niivue/niivue');
      const { rerender } = await act(async () => render(<EegTopoViewer {...defaultProps} />));
      const [firstVertices] = NVMeshUtilities.createMZ3.mock.calls[0];

      const newElectrodes = ELECTRODES.map((e) => ({ ...e }));
      await act(async () => {
        rerender(<EegTopoViewer {...defaultProps} electrodes={newElectrodes} />);
      });
      const [secondVertices] = NVMeshUtilities.createMZ3.mock.calls[1];

      expect(secondVertices).not.toBe(firstVertices);
    });
  });

  describe('electrode source', () => {
    it('shows "Default: Standard 10-05" label when isStandardElectrodes is true', async () => {
      await act(async () =>
        render(<EegTopoViewer {...defaultProps} isStandardElectrodes={true} />)
      );
      expect(screen.getByText(/default: standard 10-05/i)).toBeTruthy();
    });

    it('shows the customFileName prop when isStandardElectrodes is false', async () => {
      // customFileName is owned by PatientView and passed down, not local state —
      // EegTopoViewer just displays whatever it's given.
      await act(async () =>
        render(
          <EegTopoViewer {...defaultProps} isStandardElectrodes={false} customFileName="my_cap" />
        )
      );
      expect(screen.getByText('my_cap')).toBeTruthy();
    });

    it('renders a "Use custom positions" button', async () => {
      await act(async () =>
        render(<EegTopoViewer {...defaultProps} isStandardElectrodes={true} />)
      );
      expect(screen.getByRole('button', { name: /use custom.*positions/i })).toBeTruthy();
    });

    it('calls onElecPosFile with the selected File when a positions file is chosen', async () => {
      const onElecPosFile = vi.fn();
      const { container } = await act(async () =>
        render(
          <EegTopoViewer
            {...defaultProps}
            isStandardElectrodes={true}
            onElecPosFile={onElecPosFile}
          />
        )
      );
      const file = new File(['# ASA electrode file'], 'custom.elc');
      const input = container.querySelector('input[type="file"]');
      await userEvent.upload(input, file);
      expect(onElecPosFile).toHaveBeenCalledWith(file);
    });
  });

  describe('resize', () => {
    it('renders a resize handle on every edge and corner', async () => {
      await act(async () => render(<EegTopoViewer {...defaultProps} />));
      ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach((direction) => {
        expect(screen.getByTestId(`topo-resize-${direction}`)).toBeTruthy();
      });
    });

    it('does not render resize handles while maximized', async () => {
      await act(async () => render(<EegTopoViewer {...defaultProps} />));
      await userEvent.click(screen.getByRole('button', { name: /maximize/i }));
      expect(screen.queryByTestId('topo-resize-se')).toBeNull();
    });

    it('grows width and height when dragging the bottom-right corner outward', async () => {
      const { container } = await act(async () => render(<EegTopoViewer {...defaultProps} />));
      const windowEl = container.firstChild;
      const startWidth = parseInt(windowEl.style.width);
      const startHeight = parseInt(windowEl.style.height);

      fireEvent.mouseDown(screen.getByTestId('topo-resize-se'), { clientX: 0, clientY: 0 });
      await act(async () => {
        fireEvent.mouseMove(window, { clientX: 50, clientY: 30 });
        fireEvent.mouseUp(window);
      });

      expect(parseInt(windowEl.style.width)).toBe(startWidth + 50);
      expect(parseInt(windowEl.style.height)).toBe(startHeight + 30);
    });

    it('grows width only, leaving position unchanged, when dragging the right edge', async () => {
      const { container } = await act(async () => render(<EegTopoViewer {...defaultProps} />));
      const windowEl = container.firstChild;
      const startWidth = parseInt(windowEl.style.width);
      const startHeight = parseInt(windowEl.style.height);
      const startLeft = windowEl.style.left;

      fireEvent.mouseDown(screen.getByTestId('topo-resize-e'), { clientX: 0, clientY: 0 });
      await act(async () => {
        fireEvent.mouseMove(window, { clientX: 40, clientY: 0 });
        fireEvent.mouseUp(window);
      });

      expect(parseInt(windowEl.style.width)).toBe(startWidth + 40);
      expect(parseInt(windowEl.style.height)).toBe(startHeight);
      expect(windowEl.style.left).toBe(startLeft);
    });

    it('grows width and shifts left when dragging the left edge outward', async () => {
      const { container } = await act(async () => render(<EegTopoViewer {...defaultProps} />));
      const windowEl = container.firstChild;
      const startWidth = parseInt(windowEl.style.width);
      const startLeft = parseInt(windowEl.style.left);

      fireEvent.mouseDown(screen.getByTestId('topo-resize-w'), { clientX: 0, clientY: 0 });
      await act(async () => {
        fireEvent.mouseMove(window, { clientX: -40, clientY: 0 }); // drag left edge further left
        fireEvent.mouseUp(window);
      });

      expect(parseInt(windowEl.style.width)).toBe(startWidth + 40);
      expect(parseInt(windowEl.style.left)).toBe(startLeft - 40);
    });

    it('clamps shrinking at a minimum size instead of collapsing the window', async () => {
      const { container } = await act(async () => render(<EegTopoViewer {...defaultProps} />));
      const windowEl = container.firstChild;

      fireEvent.mouseDown(screen.getByTestId('topo-resize-se'), { clientX: 0, clientY: 0 });
      await act(async () => {
        // drag far past any reasonable minimum
        fireEvent.mouseMove(window, { clientX: -2000, clientY: -2000 });
        fireEvent.mouseUp(window);
      });

      expect(parseInt(windowEl.style.width)).toBeGreaterThan(100);
      expect(parseInt(windowEl.style.height)).toBeGreaterThan(100);
    });
  });

  describe('drag', () => {
    it('moves the window when dragging the title bar', async () => {
      const { container } = await act(async () => render(<EegTopoViewer {...defaultProps} />));
      const windowEl = container.firstChild;
      const startLeft = parseInt(windowEl.style.left);
      const startTop = parseInt(windowEl.style.top);

      fireEvent.mouseDown(screen.getByTestId('topo-title-bar'), { clientX: 0, clientY: 0 });
      await act(async () => {
        fireEvent.mouseMove(window, { clientX: 30, clientY: 20 });
        fireEvent.mouseUp(window);
      });

      expect(parseInt(windowEl.style.left)).toBe(startLeft + 30);
      expect(parseInt(windowEl.style.top)).toBe(startTop + 20);
    });

    it('clamps at the top-left viewport edge instead of dragging the window off-screen', async () => {
      const { container } = await act(async () => render(<EegTopoViewer {...defaultProps} />));
      const windowEl = container.firstChild;

      fireEvent.mouseDown(screen.getByTestId('topo-title-bar'), { clientX: 0, clientY: 0 });
      await act(async () => {
        // Drag far past the top-left corner of the viewport.
        fireEvent.mouseMove(window, { clientX: -5000, clientY: -5000 });
        fireEvent.mouseUp(window);
      });

      expect(parseInt(windowEl.style.left)).toBe(0);
      expect(parseInt(windowEl.style.top)).toBe(0);
    });

    it('clamps at the bottom-right viewport edge instead of dragging the window off-screen', async () => {
      const { container } = await act(async () => render(<EegTopoViewer {...defaultProps} />));
      const windowEl = container.firstChild;
      const width = parseInt(windowEl.style.width);
      const height = parseInt(windowEl.style.height);

      fireEvent.mouseDown(screen.getByTestId('topo-title-bar'), { clientX: 0, clientY: 0 });
      await act(async () => {
        // Drag far past the bottom-right corner of the viewport.
        fireEvent.mouseMove(window, { clientX: 50000, clientY: 50000 });
        fireEvent.mouseUp(window);
      });

      expect(parseInt(windowEl.style.left)).toBe(window.innerWidth - width);
      expect(parseInt(windowEl.style.top)).toBe(window.innerHeight - height);
    });
  });

  describe('colourblind mode', () => {
    it('renders a colourblind toggle button over the topography canvas', async () => {
      await act(async () => render(<EegTopoViewer {...defaultProps} />));
      expect(screen.getByRole('button', { name: /toggle colourblind colormap/i })).toBeTruthy();
    });

    it('is not pressed by default', async () => {
      await act(async () => render(<EegTopoViewer {...defaultProps} />));
      expect(screen.getByRole('button', { name: /toggle colourblind colormap/i })).toHaveAttribute(
        'aria-pressed',
        'false'
      );
    });

    it('registers both the default and colourblind colormaps on mount', async () => {
      await act(async () => render(<EegTopoViewer {...defaultProps} />));
      // 2 mesh colormaps (default + colourblind) + 5 electrode-marker colormaps
      // (matched pos/neg × 2 palettes, plus 1 flat unmapped colour).
      expect(mockNvInstance.addColormap).toHaveBeenCalledTimes(7);
    });

    it('applies the default colormap key to the mesh layer while colourblind mode is off', async () => {
      await act(async () => render(<EegTopoViewer {...defaultProps} />));
      const [defaultKey] = mockNvInstance.addColormap.mock.calls[0];
      const addedMesh = mockNvInstance.addMesh.mock.calls[0][0];
      expect(addedMesh.layers[0].colormap).toBe(defaultKey);
    });

    it('switches to the colourblind colormap key and re-presses the button when toggled on', async () => {
      await act(async () => render(<EegTopoViewer {...defaultProps} />));
      const [, colourBlindKey] = mockNvInstance.addColormap.mock.calls.map(([key]) => key);

      await userEvent.click(screen.getByRole('button', { name: /toggle colourblind colormap/i }));

      expect(screen.getByRole('button', { name: /toggle colourblind colormap/i })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      // The cortex mesh is the only added mesh with a `layers` array — electrode marker
      // layers (added alongside it) are plain connectome mocks without one.
      const cortexCalls = mockNvInstance.addMesh.mock.calls.filter(([m]) => m.layers);
      expect(cortexCalls.at(-1)[0].layers[0].colormap).toBe(colourBlindKey);
    });

    it('switches back to the default colormap key when toggled off again', async () => {
      await act(async () => render(<EegTopoViewer {...defaultProps} />));
      const [defaultKey] = mockNvInstance.addColormap.mock.calls.map(([key]) => key);
      const toggle = screen.getByRole('button', { name: /toggle colourblind colormap/i });

      await userEvent.click(toggle); // on
      await userEvent.click(toggle); // off again

      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      const cortexCalls = mockNvInstance.addMesh.mock.calls.filter(([m]) => m.layers);
      expect(cortexCalls.at(-1)[0].layers[0].colormap).toBe(defaultKey);
    });

    it('reloads the mesh when colourblind mode is toggled', async () => {
      const { NVMesh } = await import('@niivue/niivue');
      await act(async () => render(<EegTopoViewer {...defaultProps} />));
      expect(NVMesh.loadFromUrl).toHaveBeenCalledTimes(1);

      await userEvent.click(screen.getByRole('button', { name: /toggle colourblind colormap/i }));
      expect(NVMesh.loadFromUrl).toHaveBeenCalledTimes(2);
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

  describe('intracranial mode', () => {
    const intracranialProps = {
      ...defaultProps,
      isIntracranial: true,
      channelNames: ['B1', 'B2', 'ECG'],
      voltagesByChannel: [5, -3, 0],
    };

    it('does not render a canvas element', async () => {
      const { container } = await act(async () => render(<EegTopoViewer {...intracranialProps} />));
      expect(container.querySelector('canvas')).toBeNull();
    });

    it('does not attach NiiVue to a canvas or register colormaps', async () => {
      await act(async () => render(<EegTopoViewer {...intracranialProps} />));
      expect(mockNvInstance.attachToCanvas).not.toHaveBeenCalled();
      expect(mockNvInstance.addColormap).not.toHaveBeenCalled();
    });

    it('does not call onTopoNvReady', async () => {
      const onTopoNvReady = vi.fn();
      await act(async () =>
        render(<EegTopoViewer {...intracranialProps} onTopoNvReady={onTopoNvReady} />)
      );
      expect(onTopoNvReady).not.toHaveBeenCalled();
    });

    it('does not attempt to load a mesh', async () => {
      const { NVMesh } = await import('@niivue/niivue');
      await act(async () => render(<EegTopoViewer {...intracranialProps} />));
      expect(NVMesh.loadFromUrl).not.toHaveBeenCalled();
    });

    it('renders the intracranial matrix instead of a canvas', async () => {
      await act(async () => render(<EegTopoViewer {...intracranialProps} />));
      expect(screen.getByTestId('eeg-matrix-viewer')).toBeTruthy();
    });

    it('shows the "SEEG Electrode Matrix" title instead of "EEG Topography"', async () => {
      await act(async () => render(<EegTopoViewer {...intracranialProps} />));
      expect(screen.getByText('SEEG Electrode Matrix')).toBeTruthy();
      expect(screen.queryByText('EEG Topography')).toBeNull();
    });

    it('still shows the channels-mapped footer', async () => {
      await act(async () => render(<EegTopoViewer {...intracranialProps} />));
      expect(screen.getByText(/2\s*\/\s*10\s*channels mapped/i)).toBeTruthy();
    });

    it('still renders the "Use custom positions" button', async () => {
      await act(async () => render(<EegTopoViewer {...intracranialProps} />));
      expect(screen.getByRole('button', { name: /use custom.*positions/i })).toBeTruthy();
    });

    it('still renders the colourblind toggle button', async () => {
      await act(async () => render(<EegTopoViewer {...intracranialProps} />));
      expect(screen.getByRole('button', { name: /toggle colourblind colormap/i })).toBeTruthy();
    });

    it('switching from scalp to intracranial via rerender does not crash and stops further mesh loads', async () => {
      const { NVMesh } = await import('@niivue/niivue');
      const { rerender } = await act(async () => render(<EegTopoViewer {...defaultProps} />));
      const callsBefore = NVMesh.loadFromUrl.mock.calls.length;

      await act(async () => {
        rerender(<EegTopoViewer {...intracranialProps} />);
      });

      expect(NVMesh.loadFromUrl.mock.calls.length).toBe(callsBefore);
      expect(screen.getByTestId('eeg-matrix-viewer')).toBeTruthy();
    });
  });
});
