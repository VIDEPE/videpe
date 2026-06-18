# VIDEPE

![Version](https://img.shields.io/badge/version-0.5.0-blue)

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

- **Neuroimaging viewer** — full multiplanar and 3D rendering powered by [NiiVue](https://niivue.com/). Load multiple volumes simultaneously and adjust each one independently.
  - Supports NIfTI (`.nii`, `.nii.gz`), MGH/MGZ, GIFTI, PLY, OBJ
  - Multi-layer support for MRI, PET, and SPECT in one view
  - Per-layer opacity, colormap (grayscale, viridis, magma, mako), inversion, and colorbar
  - Drag-to-reorder layers, with a modality subtype label shown on each volume
  - Slice view buttons for axial, coronal, sagittal, multiplanar, and 3D render
  - Switches to auto layout when maximised, restores to grid on collapse
- **Built-in demo** — hit **Load Demo** to instantly load a synthetic EEG recording alongside aligned MRI, PET, and SPECT volumes. No upload, no account, no wait.
- **Drag & drop file loading** — drop files directly onto either viewer panel. VIDEPE detects the format automatically and guides you when multiple files are required.
  - EEG: BrainVision (`.vhdr` + `.eeg`) — drop both together or one at a time
  - Volumes: NIfTI, MGH/MGZ, GIFTI, PLY, OBJ
  - Drop multiple imaging files at once to load them as separate layers, or append them to an already-active neuroimaging viewer
- **Side-by-side split view** — EEG and neuroimaging panels with a draggable divider. Each panel can be independently maximised, restored, or reset, and the two panels can be swapped without reloading any data.
- **Cross-platform** — runs entirely in the browser, no installation or plugins required. Works on modern desktop and mobile browsers. Dark/light mode follows OS preference, with a manual toggle always available.
- **Open source** — licensed under [AGPL-3.0](LICENSE). The source code is publicly available on [GitHub](https://github.com/VIDEPE/videpe). All derivative works must remain open source. Bug reports, feature requests, and pull requests are welcome.

## Supported formats

| Modality | Formats                                             |
| -------- | --------------------------------------------------- |
| EEG      | BrainVision (`.vhdr` + `.eeg`)                      |
| Volumes  | NIfTI (`.nii`, `.nii.gz`), MGH/MGZ, GIFTI, PLY, OBJ |

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

## Credits

### Third-party data

| Asset                                          | Source                                                                                                | Licence      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------ |
| `public/electrode_positions/standard_1005.elc` | [MNE-Python](https://mne.tools/) — doi:[10.5281/zenodo.592483](https://doi.org/10.5281/zenodo.592483) | BSD 3-Clause |

## Links

- [GitHub repository](https://github.com/VIDEPE/videpe)
- [UNIGE Open Science page](https://www.unige.ch/medecine/neucli/groupes-de-recherche/serge-vulliemoz/open-science/videpe2)
