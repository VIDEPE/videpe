# Neuroimaging viewer

This guide is for developers working on the neuroimaging viewer (`NiiViewer`), for example to support a new file format or add a new kind of layer. It explains how a file becomes a layer, which properties of a layer decide what happens to it, and which places in the code you need to touch for a change.

## How it works

Everything the viewer shows is a **layer**: one card in the controls panel, and one volume or mesh in NiiVue. Each layer moves through the same stages:

```
 files ──► filesToLayers ──► layer objects ──► layerReducer (cards + settings) ──► sync*AndApplySettings ──► NiiVue
                                                       ▲                                                        ▲
 EEG data ──► useElectrodeConnectome / useEsiLayer ────┴──── (generated layers build their own mesh/volume) ────┘

 card change (ImagingControls) ──► handleSettingChange ──► apply*SettingChange ──► the layer's NiiVue volume or mesh
```

1. **Files become layer objects.** `filesToLayers` turns each file into a plain object `{ url, name, type, subtype, kind }`. The `url` is a `blob:` url for a local file, or a path for demo data. DICOM files are converted to NIfTI first.
2. **Layer objects become cards.** `layerReducer` in `src/state/layerState.js` keeps the list of cards. Each card is an entry `{ url, layer, settings }`: the layer object, plus the card's settings (visibility, opacity, colormap, …), created by `getInitialLayerSettings`. The reducer is the only place this list changes, and it keeps image volumes above meshes and connectomes.
3. **Cards are loaded into NiiVue.** `syncVolumesAndApplySettings` loads the new volumes into `nv.volumes`, and `syncMeshesAndApplySettings` loads the new file meshes into `nv.meshes`. Both then apply each card's settings. Layers already loaded are skipped.
4. **Card changes go to NiiVue.** A slider or toggle on a card calls `handleSettingChange`, which commits the change to the reducer and applies it to that layer's volume or mesh in NiiVue.

The layer state is the source of truth: NiiVue only draws what the cards say. For example, a connectome file has its own node and edge sizes, but the card's sizes are applied as soon as it loads, so the sliders and the render always agree.

### Where layers come from

| Entry point                       | Route                                                                                           | Reducer action         |
| --------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------- |
| Initial "Drop imaging files" zone | `handleImagingFiles` in `PatientView.jsx` → `filesToLayers` → `layers` prop → `useLayerLoader`  | `LOAD_FILE_LAYERS`     |
| Demo data                         | `useDemoData` → `layers` prop → `useLayerLoader`                                                | `LOAD_FILE_LAYERS`     |
| Shanoir or host-app launch        | `selectImagingFiles` / `sortFilesByViewer` → `filesToLayers` → `layers` prop → `useLayerLoader` | `LOAD_FILE_LAYERS`     |
| Compact dropzone under the cards  | `handleImagingFiles` in `NiiViewer.jsx` → `filesToLayers` → loaded directly                     | `APPEND_FILE_LAYERS`   |
| EEG side (electrodes, ESI)        | `electrodeLayer` / `esiLayer` props → `useElectrodeConnectome` / `useEsiLayer`                  | `SYNC_GENERATED_LAYER` |

`LOAD_FILE_LAYERS` replaces all file layers but keeps the generated ones; `APPEND_FILE_LAYERS` adds to what's already there.

## Kind, owner and type

Three properties of a layer decide what happens to it. They're independent, so keep them apart when you make a change.

- **`kind`** decides _how it's rendered_: in `nv.volumes` or `nv.meshes`, and which controls its card shows. `filesToLayers` sets it from the file's extension.
- **The owner** decides _who loads, finds and deletes it_: NiiViewer itself for file layers, or a hook for generated layers. The owner follows from the `url`: generated layers have a fixed sentinel url.
- **`type`** (with `subtype`) decides _how it's labelled_: the card reads "type - subtype", and the type picks the default colormap. It's set from the file name, and never changes how a layer is loaded or which controls it gets.

The difference between `kind` and `type` shows most clearly for volumes: a T1 and a PET share the same `kind` (none), so they load the same way and get the same controls, but their `type`s (ANAT, PET) give them different labels and colormaps. Meshes and connectomes get a fixed type, `'Mesh'` or `'Connectome'`, so for them `type` just mirrors `kind`.

| Layer                              | `kind`         | `url`                    | Lives in                            | Owner (load, lookup, delete)                         | Card controls                                                   |
| ---------------------------------- | -------------- | ------------------------ | ----------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| File volume (`.nii`, `.mgz`, …)    | none           | `blob:` or path          | `nv.volumes`, by index              | `syncVolumesAndApplySettings`, `selectNvVolumeIndex` | Opacity, Colormap, Threshold, Invert, Colorbar; reorderable     |
| Surface mesh (`.gii`, `.ply`, …)   | `'mesh'`       | `blob:`                  | `nv.meshes`, via `fileMeshesRef`    | `syncMeshesAndApplySettings`                         | Mesh X-ray                                                      |
| Connectome file (`.jcon`, `.json`) | `'connectome'` | `blob:`                  | `nv.meshes`, via `fileMeshesRef`    | `syncMeshesAndApplySettings`                         | Mesh X-ray, Node/Edge size                                      |
| Electrode connectome               | `'connectome'` | `'__electrodes__'`       | `nv.meshes`, via `electrodeMeshRef` | `useElectrodeConnectome`                             | Mesh X-ray, Node/Edge size, Node Metric, Colorbar               |
| ESI, connectome mode               | `'connectome'` | `'__esi-source-power__'` | `nv.meshes`, via `esiMeshRef`       | `useEsiLayer`                                        | Mesh X-ray, Node/Edge size, Node Metric, Threshold, mode toggle |
| ESI, volume mode                   | none           | `'__esi-source-power__'` | `nv.volumes`                        | `useEsiLayer`                                        | Volume controls, mode toggle                                    |

Four checks answer the questions the code asks about a layer. Use them instead of comparing `kind` or `url` directly:

| Check                   | Where                | True for                                    | Used for                                                   |
| ----------------------- | -------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| `isImageVolumeLayer`    | `NiiViewer.utils.js` | Every layer that isn't a mesh or connectome | Volume loading, volume controls, reordering                |
| `isFileMeshLayer`       | `layerState.js`      | Surface meshes and connectome files         | Mesh loading, mesh lookup, delete                          |
| `isFileConnectomeLayer` | `layerState.js`      | Connectome files only                       | Connectome controls that differ from generated connectomes |
| `isGeneratedLayerUrl`   | `layerState.js`      | The electrode and ESI sentinel urls         | Keeping generated layers when file layers are replaced     |

### What `kind` affects

- **The NiiVue loader:** volumes go through `nv.loadVolumes`/`nv.addVolumesFromUrl`, file meshes and connectome files through `nv.addMeshesFromUrl`. NiiVue picks the parser from the file name's extension, which is why the layer's `name` is passed along with its `blob:` url.
- **The card's controls:** see the table above. `ImagingControls.jsx` decides this per control.
- **The card order:** image volumes always come before meshes and connectomes. Only volumes can be reordered, because 3D meshes have no z-order relative to the 2D slices.
- **Mesh X-ray:** NiiVue has one X-ray value for the whole scene, so it's shared across every mesh and connectome card. Changing it on one card changes it on all of them.
- **The 3D extent:** a scene with only connectomes has no spatial extent in NiiVue, which breaks the rotation link between the panels. `onHas3DExtentChange` reports whether any layer isn't a connectome, and PatientView keeps the link off otherwise.

### What `type` affects

- **The card label:** "type - subtype", e.g. "ANAT - sub-01_T1w" or "Connectome - network".
- **The default colormap:** `TYPE_COLORMAP_DEFAULTS` in `NiiViewer.utils.js`, e.g. PET gets `turbo` and DSEG gets `randomised`.

For volumes, `detectVolumeType` derives the type from the file name: first from a BIDS suffix (`_T1w`, `_pet`, `_dseg`, …), then from keywords (`t1`, `fdg`, `atlas`, …). If nothing matches, the file name becomes the type.

## File formats

`filesToLayers` decides a file's `kind` in this order:

1. **DICOM:** a `.dcm` extension, or no extension and DICOM's magic bytes. All DICOM files in one drop are converted to NIfTI together by dcm2niix, then treated as volumes.
2. **Connectome:** a `.jcon` or `.json` extension (`CONNECTOME_EXTENSIONS`). This check comes before the mesh check, because NiiVue's own mesh check also matches these extensions.
3. **Mesh:** NiiVue's `isMeshExt`, which covers about 30 mesh and tract formats (`.gii`, `.ply`, `.obj`, `.stl`, `.vtk`, `.trk`, FreeSurfer's `lh.pial`, …).
4. **Volume:** everything else. NiiVue's volume reader then handles its own formats (`.nii`, `.mgz`, `.nrrd`, `.mha`, …), and a file it can't read fails with a toast.

`src/utils/imagingFormats.js` lists the formats VIDEPE names: `LISTED_VOLUME_EXTENSIONS`, `LISTED_MESH_EXTENSIONS` and `CONNECTOME_EXTENSIONS`. These lists only cover the common formats, not everything that loads. They're used for:

- **The initial dropzone's description:** a row per type, plus an "Other" row saying more formats work.
- **Launches:** `LAUNCH_IMAGING_EXTENSIONS` is the whitelist for files handed over by Shanoir or a host app. A launch includes sidecars, so only listed formats are taken, and `.json` is left out so a BIDS sidecar isn't loaded as a connectome.

The dropzones don't filter: a drop takes any file, and the file pickers have no `accept` list.

## Adding a new file format

**If NiiVue already reads it** (check NiiVue's documentation), it loads already, as the right kind. To make it visible:

1. Add its extension to `LISTED_VOLUME_EXTENSIONS` or `LISTED_MESH_EXTENSIONS` in `imagingFormats.js`. It then appears in the dropzone description, and launches take it.
2. Add it to the format lists in `README.md` and `AboutPage.jsx`.
3. Add a `filesToLayers` test that checks its `kind`, in `src/test/components/NiiViewer.test.jsx`.

**If NiiVue reads it, but it needs different controls** (like connectome files, which NiiVue reads as meshes but need node and edge size): give it its own extension list in `imagingFormats.js`, and check that list in `filesToLayers` before `isMeshExt`, the way `isConnectomeFileName` does. Then follow [Adding a new layer type](#adding-a-new-layer-type) if no existing `kind` fits.

**If NiiVue can't read it:** convert it in `filesToLayers` to a format NiiVue reads, the way DICOM files are converted to NIfTI in `dicomFilesToLayers`.

**For a new volume modality** (e.g. a new BIDS suffix): add it to `detectVolumeType`, and give it a default colormap in `TYPE_COLORMAP_DEFAULTS` if it needs one.

## Adding a new layer type

First decide whether you need one. Reuse an existing `kind` if the new layer loads and renders the same way. Connectome files show how far that goes: they're a new sort of layer, but they reuse `kind: 'connectome'` for the card controls and the file-mesh route for loading.

Then answer the two questions from [Kind, owner and type](#kind-owner-and-type):

- **Where does it live in NiiVue?** In `nv.volumes` (a volume, sliced in 2D) or `nv.meshes` (a 3D object). This decides its `kind`.
- **Who owns it?** A file the user loads (owned by NiiViewer, keyed by its `blob:` url), or something built in memory from other data (owned by its own hook, with a sentinel url).

### Checklist

Each of these places branches on `kind` or owner. Go through all of them:

| Place                                                 | What to do                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `filesToLayers` (`NiiViewer.utils.js`)                | Tag the layer with its `kind`, `type` and `subtype`.                                    |
| `isImageVolumeLayer` (`NiiViewer.utils.js`)           | A new non-volume `kind` must return `false` here, or it's loaded as a volume.           |
| `isFileMeshLayer` (`layerState.js`)                   | A new file-loaded mesh kind must return `true` here, or it's never loaded or deleted.   |
| `GENERATED_LAYER_URLS` (`layerState.js`)              | A new generated layer's sentinel url goes here, so loading new files doesn't remove it. |
| `getInitialLayerSettings` (`NiiViewer.utils.js`)      | Any new setting gets its default here.                                                  |
| `handleSettingChange` (`NiiViewer.jsx`)               | A new owner needs its own line in the mesh lookup.                                      |
| `applyMeshSettingChange` / `applyVolumeSettingChange` | A new setting needs a branch that applies it to NiiVue.                                 |
| `handleDeleteLayer` (`NiiViewer.jsx`)                 | A new owner needs its own removal branch.                                               |
| `ImagingControls.jsx`                                 | Decide per control whether the new layer shows it.                                      |
| `onHas3DExtentChange` effect (`NiiViewer.jsx`)        | Decide whether the new layer gives the 3D scene a spatial extent.                       |
| Header comment of `layerState.js`                     | Describe the new layer's shape.                                                         |

A generated layer also needs its own hook, like `useElectrodeConnectome`: it dispatches `SYNC_GENERATED_LAYER` to add, replace or remove its card, builds its own mesh or volume in NiiVue, and keeps it in its own ref.

For tests, the `connectome layers (loaded from .jcon/.json files)` block in `NiiViewer.test.jsx` is a good template: loading through each entry point, the card's controls, a settings change, hiding, deleting and a failed load.

## Development decisions

### Kind and owner are separate questions

A connectome file is a mesh to NiiVue but a connectome on its card. Answering both questions with one `kind` would force a choice: `kind: 'mesh'` would lose the node and edge controls, and a new `kind` would need every `kind` check to learn about it. Keeping them apart means the card follows `kind`, and loading, lookup and delete follow the owner.

### Meshes are found by url, not by position

`nv.volumes` holds only volumes in card order, so a volume is found by its index (`selectNvVolumeIndex`). `nv.meshes` holds meshes from several owners in no fixed order, so each owner keeps its own reference: `fileMeshesRef` maps a file's url to its mesh, and the hooks keep `electrodeMeshRef` and `esiMeshRef`.

### A failed file fails its whole group

NiiVue loads a batch of volumes, or a batch of meshes, all or nothing. Volumes and meshes are loaded as separate batches, so a broken volume doesn't stop the meshes. But one broken mesh or connectome file stops the whole mesh batch of that drop. Every card in a failed batch is removed, and each file gets a toast naming it.

### The file pickers don't filter

NiiVue reads dozens of formats. An `accept` list would hide the unlisted ones in the file picker, while a drop would still take them. Without a filter, picking and dropping behave the same. The cost is that the picker also shows non-imaging files, which fail with the same toast a drop gives.

### Launches skip `.json`

A launch hands over everything at once, including BIDS sidecars, which are `.json` files. Taking `.json` would load every sidecar as a broken connectome, so launches only take `.jcon`. A dropped `.json` is still taken, because the user chose that file.

## Code

| File                                   | What it does                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/utils/imagingFormats.js`          | The listed formats, the dropzone description and the launch whitelist                           |
| `src/utils/NiiViewer.utils.js`         | `filesToLayers`, `detectVolumeType`, `getInitialLayerSettings`, the two `sync*AndApplySettings` |
| `src/state/layerState.js`              | The layer state: reducer, actions, selectors and the layer checks                               |
| `src/components/NiiViewer.jsx`         | The viewer: compact dropzone, setting changes, delete and reorder                               |
| `src/hooks/useLayerLoader.js`          | Loads the `layers` prop into the layer state and NiiVue                                         |
| `src/hooks/useElectrodeConnectome.js`  | The generated electrode connectome                                                              |
| `src/hooks/useEsiLayer.js`             | The generated ESI layer, in connectome or volume mode                                           |
| `src/hooks/useSharedNiiVueInstance.js` | The NiiVue instance, and clearing it on unmount                                                 |
| `src/components/ImagingControls.jsx`   | The cards and which controls each one shows                                                     |
| `src/utils/launchFiles.js`             | Which launched files go to the neuroimaging viewer                                              |
