# VIDÉPÉ

A web-based viewer for EEG and neuroimaging data (MRI, PET, SPECT), developed at the [Vulliemoz Lab, UNIGE](https://www.unige.ch/medecine/neucli/groupes-de-recherche/serge-vulliemoz/open-science/videpe2).

## Features

- **EEG viewer** — multichannel time-series plots with linked crosshair cursor (uPlot)
- **Neuroimaging viewer** — multiplanar 3D viewer for NIfTI volumes (NiiVue), with toggle buttons for MRI, PET and SPECT overlays
- **Dark / light theme** — OS preference detection with manual override, no flash on load
- Runs entirely in the browser — no server required

## Tech stack

| Area | Library |
|---|---|
| Framework | React 19 + Vite 8 |
| Routing | React Router v7 (HashRouter for GitHub Pages) |
| Styling | Tailwind CSS v4 |
| EEG plots | uPlot + uplot-react |
| Neuroimaging | @niivue/niivue |
| Testing | Vitest + React Testing Library |

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
