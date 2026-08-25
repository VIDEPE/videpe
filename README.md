# VIDEPE

![Version](https://img.shields.io/badge/version-0.15.0-blue)

**V**isualization & **I**ntegration of **D**ata for **E**pilepsy **P**resurgical **E**valuation

A web-based viewer for EEG and neuroimaging data (MRI, PET, SPECT), developed at the [Epilepsy and Brain Networks Lab, UNIGE](https://www.unige.ch/medecine/neucli/groupes-de-recherche/serge-vulliemoz/open-science/videpe2).

**No installation needed** — just open [https://videpe.github.io/videpe](https://videpe.github.io/videpe/) in your browser and start exploring.

> **Note:** VIDEPE is currently under active development. Features and interfaces may change, and some functionality may be incomplete or subject to revision.

## Privacy-first: 100% local processing

All data processing happens entirely in your browser. No files are ever uploaded to a server, sent to a third party, or stored outside your own machine. This makes VIDEPE safe to use with sensitive medical data — including identifiable patient recordings — without any institutional data-sharing agreement or de-identification step.

## Features

### EEG Viewer

High-performance multichannel viewer built on [uPlot](https://github.com/leeoniya/uplot), optimised for long recordings and high channel count.

- Accepts BrainVision format EEG recordings
- Stack/unstack EEG — overlay all visible channels on a single plot to spot cross-channel patterns
- **Controls:**
  - Adjustable range (µV scale), window size, and time step
  - Interactive timeline scrubber for fast navigation across the full recording
  - Keyboard navigation — arrow keys for range/panning, Page Up/Down and Space for window jumps, Home/End to jump to the start/end
  - Configurable number of simultaneously visible channels.
- **Performance:**
  - Min-max downsampling keeps rendering fast at any zoom level
  - Sliding-window buffer — only a portion of the recording is kept in memory at once, so hour-long, high-channel-count recordings stay fast without exhausting browser memory

- **Montage Editor** — a dedicated window for channel selection, re-referencing and building custom EEG montages.
  - Re-reference on the fly or select preset montage (e.g. double banana)
  - Select and flag channels (bad-channel, per-channel type)
  - Build referenced or bipolar montage rows with custom per-row colors, reorder and sort them, and the waveform view switches to showing exactly those rows.
  - Import montage files in AnyWave (XML) or Cartool (plain-text) format — auto-detected from file content — and export back out as AnyWave XML.

- EEG topography — a resizable panel showing a 3D voltage map at the selected time point using [NiiVue](https://niivue.com/) mesh rendering
  - Load custom positions via `.elc` or `.tsv` file (Uses fsaverage_1005 (FreeSurfer) electrode positions by default)
  - 3D rotation is synchronised with the neuroimaging viewer — rotate one and the other follows
  - Matrix electrode overview to spot outliers

- **Intracranial (SEEG) support** — SEEG channels are auto-detected from channel naming
  - Custom channel type setting as EEG/SEEG will toggle VIDEPE options accordingly and changes rendering style of the 3D electrodes configuration in the neuroimaging viewer
- **Electrical Source Imaging** — Uploading an Inverse Solution file, unlocks the ability to 3D visualise the power of the surface EEG recording.
  - (currently only Fieldtrip `*_inversefilters.mat` supported)
  - renders per-source power at the selected EEG time point as either a 3D connectome or a volumetric heatmap

### **Neuroimaging viewer**

Full multiplanar and 3D rendering powered by [NiiVue](https://niivue.com/). Load multiple volumes/meshes simultaneously and adjust each one independently.

- Multi-layer support for e.g. MRI, PET, and SPECT in one view
- Supports NIfTI (`.nii`, `.nii.gz`), MGH/MGZ, GIFTI, PLY, OBJ, and DICOM (`.dcm`, converted to NIfTI on load via dcm2niix)
- Per-layer opacity/mesh xray, colormap, inversion, colorbar and thresholding controls
- Drag-to-reorder layers, with a modality subtype label shown on each volume
- Slice view buttons for axial, coronal, sagittal, multiplanar, and 3D render
- Radiological/neurological convention toggle and clip plane toggle (3D render view only)
- Adjustable node/edge size for connectome layers (ESI and SEEG electrode connectomes)

### Built-in Demo

Hit **Load Demo** to instantly load a synthetic EEG recording, electrode positions and inverse solution alongside aligned MRI volumes. No upload, no account, no wait.

### Additional features:

- **Drag & drop file loading** — drop files directly onto either viewer panel. VIDEPE detects the format automatically and guides you when multiple files are required.
- **Side-by-side split view** — EEG and neuroimaging panels with a draggable divider. Each panel can be independently maximised, restored, or reset, and the two panels can be swapped without reloading any data.
- **Cross-platform** — runs entirely in the browser, no installation or plugins required. Works on modern desktop and mobile browsers. Dark/light mode follows OS preference, with a manual toggle always available.
- **Open source** — licensed under [AGPL-3.0](LICENSE). The source code is publicly available on [GitHub](https://github.com/VIDEPE/videpe). All derivative works must remain open source. Bug reports, feature requests, and pull requests are welcome.

## Supported formats

| Modality            | Formats                                                             |
| ------------------- | ------------------------------------------------------------------- |
| EEG                 | BrainVision (`.vhdr` + `.eeg`)                                      |
| Electrode positions | `.elc`, `.tsv`                                                      |
| Volumes             | NIfTI (`.nii`, `.nii.gz`), MGH/MGZ, GIFTI, PLY, OBJ, DICOM (`.dcm`) |

## Tech stack

| Area                     | Library                                       |
| ------------------------ | --------------------------------------------- |
| Framework                | React 19 + Vite 8                             |
| Routing                  | React Router v7 (HashRouter for GitHub Pages) |
| Styling                  | Tailwind CSS v4                               |
| EEG plots                | uPlot + uplot-react                           |
| Neuroimaging             | NiiVue                                        |
| Drag & drop              | @dnd-kit                                      |
| Inverse solution parsing | mat-for-js                                    |
| Testing                  | Vitest + React Testing Library                |

## Development

### Prerequisites

VIDEPE is built using [npm](https://www.npmjs.com/) to manage dependencies, testing and running the development server. npm is bundled with [Node.js](https://nodejs.org/en/download) — installing Node.js is all you need (ensure npm is ticked during installation).

### Getting started

```bash
# Install the dependencies to the local node_modules folder (only needed once)
npm install
# Start the development server
npm run dev
```

After the development server is started the app is served at: [`http://localhost:5173/videpe/`](http://localhost:5173/videpe/).

### Running tests

```bash
npm test          # watch mode (re-runs affected tests after file changes)
npm run test:run  # single run (used in CI)
```

## CI/CD

Two GitHub Actions workflows handle testing and deployment:

- [`test.yml`](.github/workflows/test.yml) — runs on every pull request targeting `develop` or `main`. Installs dependencies and runs the test suite; PRs targeting `main` additionally run a production build to catch build-only failures before release.
- [`deploy.yml`](.github/workflows/deploy.yml) — runs on every push to `main`. Builds the app and publishes it to GitHub Pages.

## Links

- [GitHub repository](https://github.com/VIDEPE/videpe)
- [UNIGE Open Science page](https://www.unige.ch/medecine/neucli/groupes-de-recherche/serge-vulliemoz/open-science/videpe2)
