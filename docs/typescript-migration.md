# TypeScript migration

VIDEPE is moving from JavaScript to TypeScript **one file at a time**. `allowJs` lets `.js`/`.jsx` and `.ts`/`.tsx` files import each other, so the app keeps working after every converted file. There is no big-bang rewrite.

## Habits

1. **New files are written in TypeScript.** Every new module, hook or component is a `.ts`/`.tsx` file, even while the files around it are still JS.
2. **Convert in a fixed order, leaves first:** utils/loaders → hooks → components → pages. Each converted file then imports code that is already typed, instead of guessing at untyped JS.
3. **Keep this list current.** Tick a file off in the same PR that converts it, so progress stays visible and it's clear when the migration is done.

Also:

- A file's test is converted in the same PR as the file it tests.
- Use `// @ts-check` at the top of a JS file that calls typed code but isn't converted yet. TypeScript then checks it without the file being renamed.
- Behaviour changes and conversions go in separate commits, so a regression can be traced to one or the other.

## Phase 0: setup

- [ ] Add `typescript` as a dev dependency
- [ ] `tsconfig.json`: `allowJs`, `jsx: react-jsx`, `@/*` → `src/*` path alias (matching the Vite alias), `noEmit`
- [ ] `typecheck` script (`tsc --noEmit`) in `package.json`
- [ ] Run `typecheck` in CI next to the tests

## Phase 1: layer state (with the layer-state overhaul)

The layer state is rebuilt as one url-keyed reducer (instead of the parallel `orderedLayers`/`layerSettings` arrays). These files are rewritten anyway, so they're converted as part of it.

- [ ] `src/state/layerState.ts` (new: state shape, action types, reducer)
- [ ] `src/utils/NiiViewer.utils.js`
- [ ] `src/hooks/useLayerLoader.js`
- [ ] `src/hooks/useElectrodeConnectome.js`
- [ ] `src/hooks/useEsiLayer.js`
- [ ] `src/hooks/useSharedNiiVueInstance.js`
- [ ] `src/components/NiiViewer.jsx`
- [ ] `src/components/ImagingControls.jsx`

## Phase 2: utils, loaders and Shanoir (no React)

### Utils

- [ ] `src/utils/arrayAndMatrixMathUtils.js`
- [ ] `src/utils/benchmarkEegFilters.js`
- [ ] `src/utils/benchmarkMatrixMultiplication.js`
- [ ] `src/utils/downsample.js`
- [ ] `src/utils/eegColormaps.js`
- [ ] `src/utils/eegFilters.js`
- [ ] `src/utils/eegTopographyUtils.js`
- [ ] `src/utils/eegViewerUtils.js`
- [ ] `src/utils/electricalSourceImagingUtils.js`
- [ ] `src/utils/fileDownload.js`
- [ ] `src/utils/inferElectrodePositionUnitScale.js`
- [ ] `src/utils/intracranialDetection.js`
- [ ] `src/utils/useScrollToHash.js`
- [ ] `src/utils/utils.js`
- [ ] `src/utils/yieldToMain.js`

### Loaders

- [ ] `src/loaders/eegBuffer.js`
- [ ] `src/loaders/eegFormatRegistry.js`
- [ ] `src/loaders/loadEEGBrainVision.js`
- [ ] `src/loaders/parseElectrodePositionElc.js`
- [ ] `src/loaders/parseElectrodePositionFile.js`
- [ ] `src/loaders/parseElectrodePositionTsv.js`
- [ ] `src/loaders/parseInverseSolutionFieldtrip.js`
- [ ] `src/loaders/parseMontageAnywave.js`
- [ ] `src/loaders/parseMontageCartool.js`
- [ ] `src/loaders/parseMontageFile.js`
- [ ] `src/loaders/toMontageAnyWave.js`
- [ ] `src/loaders/unzipToFiles.js`

### Shanoir

- [ ] `src/shanoir/fakeShanoirClient.js`
- [ ] `src/shanoir/fetchShanoirExamination.js`
- [ ] `src/shanoir/shanoirAuth.js`
- [ ] `src/shanoir/shanoirClient.js`
- [ ] `src/shanoir/shanoirConfig.js`
- [ ] `src/shanoir/shanoirFiles.js`
- [ ] `src/shanoir/shanoirLaunch.js`

## Phase 3: hooks

- [ ] `src/hooks/useCanvasAutoLayout.js`
- [ ] `src/hooks/useChannelSettings.js`
- [ ] `src/hooks/useContainerResize.js`
- [ ] `src/hooks/useDemoData.js`
- [ ] `src/hooks/useEegFileIntake.js`
- [ ] `src/hooks/useEegPlotControls.js`
- [ ] `src/hooks/useElectricalSourceImaging.js`
- [ ] `src/hooks/useElectrodeMatching.js`
- [ ] `src/hooks/useLoadingToast.js`
- [ ] `src/hooks/useMontage.js`
- [ ] `src/hooks/useMontageTemplates.js`
- [ ] `src/hooks/useRowResize.js`
- [ ] `src/hooks/useScrubberDrag.js`
- [ ] `src/hooks/useSingleAndDoubleClick.js`
- [ ] `src/hooks/useTimepointSnapshot.js`
- [ ] `src/shanoir/useShanoirData.js`

## Phase 4: components

- [ ] `src/components/CenteredLayout.jsx`
- [ ] `src/components/EegMatrixViewer.jsx`
- [ ] `src/components/EegMontageEditor.jsx`
- [ ] `src/components/EegTopoViewer.jsx`
- [ ] `src/components/EegViewer.jsx`
- [ ] `src/components/FileDropZone.jsx`
- [ ] `src/components/Footer.jsx`
- [ ] `src/components/FullWidthLayout.jsx`
- [ ] `src/components/ScrollToTopButton.jsx`
- [ ] `src/components/SplitPane.jsx`
- [ ] `src/components/StatusLed.jsx`
- [ ] `src/components/ThemeContext.jsx`
- [ ] `src/components/ThemedToaster.jsx`
- [ ] `src/components/ThemeToggle.jsx`
- [ ] `src/components/TrafficLightButtons.jsx`
- [ ] `src/shanoir/ShanoirLaunchPages.jsx`
- [ ] `src/shanoir/ShanoirSessionContext.jsx`

## Phase 5: pages and app entry

- [ ] `src/pages/AboutPage.jsx`
- [ ] `src/pages/LandingPage.jsx`
- [ ] `src/pages/NotFoundPage.jsx`
- [ ] `src/pages/PatientView.jsx`
- [ ] `src/App.jsx`
- [ ] `src/main.jsx`

## Phase 6: finish

- [ ] Test infrastructure: `src/test/setup.js`, `src/test/__mocks__/SvgMock.jsx`
- [ ] Remove `allowJs` from `tsconfig.json`
- [ ] Turn on `strict` (if not already on), and fix what it finds
