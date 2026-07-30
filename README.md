# VIDEPE

![Version](https://img.shields.io/badge/version-0.12.0-blue)

**V**isualization & **I**ntegration of **D**ata for **E**pilepsy **P**resurgical **E**valuation

A web-based viewer for EEG and neuroimaging data (MRI, PET, SPECT), developed at the [Epilepsy and Brain Networks Lab, UNIGE](https://www.unige.ch/medecine/neucli/groupes-de-recherche/serge-vulliemoz/open-science/videpe2).

> **No installation needed** — just open [videpe.github.io/videpe](https://videpe.github.io/videpe/) in your browser and start exploring.

> **Note:** VIDEPE is currently under active development. Features and interfaces may change, and some functionality may be incomplete or subject to revision.

## Privacy-first: 100% local processing

All data processing happens entirely in your browser. No files are ever uploaded to a server, sent to a third party, or stored outside your own machine. This makes VIDEPE safe to use with sensitive medical data — including identifiable patient recordings — without any institutional data-sharing agreement or de-identification step.

## Features

- **EEG viewer** — high-performance multichannel viewer built on [uPlot](https://github.com/leeoniya/uplot), optimised for long recordings with many channels. All plots share a single time axis — panning or zooming one channel instantly updates all others.
  - Adjustable range (µV scale), window size, and time step
  - Interactive timeline scrubber for fast navigation across the full recording
  - Keyboard navigation — arrow keys for range/panning, Page Up/Down and Space for window jumps, Home/End to jump to the start/end
  - Configurable number of simultaneously visible channels
  - Min-max downsampling keeps rendering fast at any zoom level
  - Sliding-window buffer — only a portion of the recording is kept in memory at once, so hour-long, high-channel-count recordings stay fast without exhausting browser memory
  - Drag-to-resize handle on the plot row to trade channel height for more visible channels
  - **EEG topography** — a resizable panel showing a 3D voltage map at the selected time point using [NiiVue](https://niivue.com/) mesh rendering
    - Re-reference on the fly: none, average, or median reference
    - Diverging blue-white-red colormap with a live colorbar (µV), plus a colour-blind-friendly mode
    - Individual electrode markers on the mesh — voltage-coloured for matched channels, grey for unmapped template positions
    - Uses Standard 10-05 electrode positions by default; load custom positions via `.elc` or `.tsv` file
    - 3D rotation is synchronised with the neuroimaging viewer — rotate one and the other follows
  - **Intracranial (iEEG) support** — toggle between scalp EEG and intracranial (sEEG/ECoG) recordings; iEEG channels are auto-detected from channel naming and shown as a per-electrode voltage matrix, or rendered as a 3D electrode connectome in the neuroimaging viewer once electrode positions are loaded
  - **Electrical Source Imaging** — When uploading an Inverse Solution file (currently only Fieldtrip `*_inversefilters.mat` supported), renders per-source power at the selected EEG time point as either a 3D connectome or a volumetric heatmap, with a toggle to switch between the two. Requires the Average montage — VIDEPE switches to it automatically when an inverse solution is loaded, and hides the layer if you switch away.

- **Neuroimaging viewer** — full multiplanar and 3D rendering powered by [NiiVue](https://niivue.com/). Load multiple volumes/meshes simultaneously and adjust each one independently.
  - Multi-layer support for e.g. MRI, PET, and SPECT in one view
    - Supports NIfTI (`.nii`, `.nii.gz`), MGH/MGZ, GIFTI, PLY, OBJ
  - Per-layer opacity/mesh xray, colormap, inversion, colorbar and thresholding controls
  - Drag-to-reorder layers, with a modality subtype label shown on each volume
  - Slice view buttons for axial, coronal, sagittal, multiplanar, and 3D render
  - Radiological/neurological convention toggle and clip plane toggle (3D render view only)
  - Adjustable node/edge size for connectome layers (ESI and iEEG electrode connectomes)
  - Switches to auto layout when maximised, restores to grid on collapse
- **Built-in demo** — hit **Load Demo** to instantly load a synthetic EEG recording, electrode positions and inverse solution alongside aligned MRI volumes. No upload, no account, no wait.
- **Drag & drop file loading** — drop files directly onto either viewer panel. VIDEPE detects the format automatically and guides you when multiple files are required.
  - EEG: BrainVision (`.vhdr` + `.eeg`) — drop both together or one at a time
  - Volumes: NIfTI, MGH/MGZ, GIFTI, PLY, OBJ
  - Drop multiple imaging files at once to load them as separate layers, or append them to an already-active neuroimaging viewer
- **Side-by-side split view** — EEG and neuroimaging panels with a draggable divider. Each panel can be independently maximised, restored, or reset, and the two panels can be swapped without reloading any data.
- **Cross-platform** — runs entirely in the browser, no installation or plugins required. Works on modern desktop and mobile browsers. Dark/light mode follows OS preference, with a manual toggle always available.
- **Open source** — licensed under [AGPL-3.0](LICENSE). The source code is publicly available on [GitHub](https://github.com/VIDEPE/videpe). All derivative works must remain open source. Bug reports, feature requests, and pull requests are welcome.

## Supported formats

| Modality            | Formats                                             |
| ------------------- | --------------------------------------------------- |
| EEG                 | BrainVision (`.vhdr` + `.eeg`)                      |
| Electrode positions | `.elc`, `.tsv`                                      |
| Volumes             | NIfTI (`.nii`, `.nii.gz`), MGH/MGZ, GIFTI, PLY, OBJ |

## Tech stack

| Area         | Library                                       |
| ------------ | --------------------------------------------- |
| Framework    | React 19 + Vite 8                             |
| Routing      | React Router v7 (HashRouter for GitHub Pages) |
| Styling      | Tailwind CSS v4                               |
| EEG plots    | uPlot + uplot-react                           |
| Neuroimaging | NiiVue                                        |
| Testing      | Vitest + React Testing Library                |

## Prerequisites

VIDEPE uses [npm](https://www.npmjs.com/) to manage dependencies. npm is bundled with [Node.js](https://nodejs.org/en/download) — installing Node.js is all you need.

## Getting started

```bash
npm install
npm run dev
```

The app is served at `http://localhost:5173/videpe/`.

## Running tests

```bash
npm test          # watch mode
npm run test:run  # single run (used in CI)
```

## Deployment

The app deploys automatically to GitHub Pages on every push to `main`. Tests run on every pull request.

## Links

- [GitHub repository](https://github.com/VIDEPE/videpe)
- [UNIGE Open Science page](https://www.unige.ch/medecine/neucli/groupes-de-recherche/serge-vulliemoz/open-science/videpe2)
