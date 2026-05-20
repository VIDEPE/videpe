# VIDÉPÉ

A web-based viewer for EEG and neuroimaging data (MRI, PET, SPECT), developed at the [Vulliemoz Lab, UNIGE](https://www.unige.ch/medecine/neucli/groupes-de-recherche/serge-vulliemoz/open-science/videpe2).

## Features

- **EEG viewer** — multichannel time-series plots with controls for navigating the recording. Build on [uPlot](https://github.com/leeoniya/uplot).
- **Neuroimaging viewer** — multiplanar 3D viewer for NIfTI volumes (utilising [NiiVue](https://niivue.com/) — A WebGL2 medical image viewer), with controls for adjusting MRI, PET and SPECT overlays settings. 
- **No Server Required** — Runs entirely in the browser.
- **Dark / Light Mode** — OS preference detection with manual override.
- **Cross-Platform** — Runs on modern browsers and even mobile devices.


## Tech stack

| Area | Library |
|---|---|
| Framework | React 19 + Vite 8 |
| Routing | React Router v7 (HashRouter for GitHub Pages) |
| Styling | Tailwind CSS v4 |
| EEG plots | uPlot + uplot-react |
| Neuroimaging | NiiVue |
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
