# VIDEPE

**V**isualization & **I**ntegration of **D**ata for **E**pilepsy **P**resurgical **E**valuation

A web-based viewer for EEG and neuroimaging data (MRI, PET, SPECT), developed at the [Vulliemoz Lab, UNIGE](https://www.unige.ch/medecine/neucli/groupes-de-recherche/serge-vulliemoz/open-science/videpe2).

## Privacy-first: 100% local processing

All data processing happens entirely in your browser — no files are ever uploaded to a server or sent anywhere remotely. This makes VIDEPE safe to use with sensitive medical data, including patient recordings, without any risk of data leaving your machine.

## Features

- **EEG viewer** — multichannel time-series plots with synchronized pan/zoom across all channels. Built on [uPlot](https://github.com/leeoniya/uplot).
  - Adjustable gain, window size, and time-shift step
  - Interactive timeline scrubber for fast navigation
  - Configurable number of visible channels
- **Neuroimaging viewer** — multiplanar + 3D rendering for NIfTI volumes. Built on [NiiVue](https://niivue.com/).
  - Multi-layer support: load MRI, PET, and SPECT volumes simultaneously
  - Per-layer controls: opacity, colormap (grayscale, viridis, magma, mako), colormap inversion, colorbar toggle
  - Drag-to-reorder layers
  - Adaptive layout: switches to auto layout when maximized, returns to grid when restored
- **Drag & drop file loading** — drop EEG or imaging files directly onto the viewer. Multi-file formats (e.g. BrainVision `.vhdr` + `.eeg`) can be dropped together or in separate drops.
- **Side-by-side split view** — adjustable split between EEG and neuroimaging panels, with maximize, restore, and swap controls.
- **Built-in demo** — load a sample EEG + MRI/PET/SPECT dataset with one click to explore the viewer without your own files.
- **Dark / Light mode** — OS preference detection with manual override.
- **Cross-platform** — runs on modern browsers, including mobile devices.

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
