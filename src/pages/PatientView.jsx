import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Niivue } from '@niivue/niivue';
import toast from 'react-hot-toast';

import { FullWidthLayout } from '../components/FullWidthLayout';
import { ThemeToggle } from '../components/ThemeToggle';
import { EegViewer } from '../components/EegViewer';
import { NiiViewer } from '../components/NiiViewer';
import { SplitPane } from '../components/SplitPane';
import { EEGTypeToggle } from '../components/EEGTypeToggle';
import { FileDropZone } from '../components/FileDropZone';
import { filesToLayers } from '../utils/NiiViewer.utils';
import { buildElectrodeLayer } from '../utils/eegTopographyUtils';
import { useEegFileIntake } from '../hooks/useEegFileIntake';
import { useMontage } from '../hooks/useMontage';
import { useElectricalSourceImaging } from '../hooks/useElectricalSourceImaging';
import { useDemoData } from '../hooks/useDemoData';

// Shared title styling — keeps "Neuroimaging" and the toggle's labels visually
// consistent, and both header bars the same height (TrafficLightButtons are 16px tall).
const PANEL_TITLE_CLASS = 'h-7 flex items-center text-xl font-medium leading-none text-header';

export const PatientView = () => {
  // Prevent default browser drag-and-drop behavior (e.g., opening files in a new tab)
  useEffect(() => {
    const prevent = (e) => e.preventDefault();
    document.addEventListener('dragover', prevent);
    document.addEventListener('drop', prevent);
    return () => {
      document.removeEventListener('dragover', prevent);
      document.removeEventListener('drop', prevent);
    };
  }, []);

  const [eeg, setEeg] = useState(null); // recording provider: { channelNames, fs, tMax, getChunk }
  const [layers, setLayers] = useState([]); // image volumes/meshes loaded from files
  // Whether NiiViewer holds layers dropped into its own internal dropzone — those never
  // touch `layers` above, so this prevents wrongly unmounting NiiViewer (and discarding
  // them) when e.g. switching out of iEEG mode clears electrodeLayer.
  const [niiHasOwnContent, setNiiHasOwnContent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const eegReadyResolveRef = useRef(null); // set before demo load; EegViewer calls it when charts are ready
  const niiReadyResolveRef = useRef(null); // set before demo load; NiiViewer calls it when volumes are ready
  const [maximizedPanel, setMaximizedPanel] = useState(null); // null | 'left' | 'right'

  // Live EEG/electrode state lifted out of EegViewer — drives the intracranial connectome
  // layer in the Neuroimaging pane. { isIntracranial, matched, voltages } | null.
  const [electrodeSnapshot, setElectrodeSnapshot] = useState(null);
  // 'eeg' | 'ieeg' — owned here (not EegViewer) so the SplitPane title can show/drive the
  // toggle. EegViewer reports its auto-detection result up via the same setter that the
  // title's click handler uses, then reads the resulting value back down as a prop.
  const [recordingType, setRecordingType] = useState('eeg');
  const [channelSnapshot, setChannelSnapshot] = useState(null); // { isIntracranial, channelNames, voltages } lifted from EegViewer on each click

  const { montage, setMontage, resetMontage } = useMontage();

  const {
    inverseSolutionFileName,
    esiLayer,
    handleInverseSolutionFile,
    handleMontageChange,
    resetInverseSolution,
  } = useElectricalSourceImaging({ eeg, recordingType, channelSnapshot, montage, setMontage });

  const {
    pendingEegFiles,
    eegHint,
    customElectrodes,
    customElecPosFileName,
    handleElecPosFile,
    handleEegFiles,
    resetIntake,
  } = useEegFileIntake({
    setEeg,
    setIsLoading,
    onInverseSolutionFile: handleInverseSolutionFile,
  });

  const { isDemoLoading, handleLoadDemo } = useDemoData({
    setEeg,
    setLayers,
    handleElecPosFile,
    handleInverseSolutionFile,
    setIsLoading,
    eegReadyResolveRef,
    niiReadyResolveRef,
  });

  // Derives the Neuroimaging pane's connectome layer from the EEG state lifted out of
  // EegViewer — null until there's an intracranial recording with at least one
  // position-matched channel. `?? {}` guards the initial (pre-EegViewer-effect) null state.
  const electrodeLayer = useMemo(
    () => buildElectrodeLayer(electrodeSnapshot ?? {}),
    [electrodeSnapshot]
  ); // intracranial electrodes

  // Whether the Neuroimaging pane currently has anything to show — same condition that
  // decides whether NiiViewer is mounted at all (below) and whether its reset button appears.
  const niiViewerHasContent =
    layers.length > 0 || Boolean(electrodeLayer) || Boolean(esiLayer) || niiHasOwnContent;

  // when both these flags are true, then the two plots can be synchronised
  const [niiNvReady, setNiiNvReady] = useState(false); // flag when the NiiViewer canvas is initialised
  const [topoNvReady, setTopoNvReady] = useState(false); // flag when EegTopoViewer canvas is initialised
  // useCallback returns the same function every render, instead of a new one each time —
  // EegTopoViewer's setup effect can then list it as a dependency without re-running on
  // every PatientView re-render.
  const handleTopoNvReady = useCallback(() => setTopoNvReady(true), []);
  // Flags indicating whether the topography/imaging NiiVue canvas currently has a 3D scene with a 3D extent.
  // The rotation sync — broadcastTo() — between them must stay off unless BOTH do. It'll throw 'zero-extend warnings'.
  // 'Zero 3D extend' happens for an empty scene AND for a connectome-only scene (intracranial electrodes / ESI in connectome
  // mode), therefor a "has a volume or mesh", not merely "has any layer" condition is needed.
  // EegTopoViewer always builds a real convex-hull surface mesh => topoHasContent always implies a usable extent.
  // NiiViewer reports its own via onHas3DExtentChange, which is set to 'false' on unmount (see useSharedNiiVueInstance.js)
  const [topoHasContent, setTopoHasContent] = useState(false); // reported by EegViewer/EegTopoViewer
  const [niiHas3DExtent, setNiiHas3DExtent] = useState(false); // reported by NiiViewer

  // Lazy ref init — created once, never replaced. A cleanup-based useEffect would let
  // StrictMode's remount cycle recreate this and break NiiViewer's canvasReadyRef guard.
  const nvRef_niiviewer = useRef(null);
  if (nvRef_niiviewer.current === null) {
    nvRef_niiviewer.current = new Niivue({
      isOrientCube: true,
      dragAndDropEnabled: false,
      show3Dcrosshair: true,
    });
  }

  // Same lazy-ref pattern as nvRef_niiviewer, for the topography view's NiiVue instance.
  const nvRef_eegtopo = useRef(null);
  if (nvRef_eegtopo.current === null) {
    nvRef_eegtopo.current = new Niivue({
      isOrientCube: true,
    });
  }

  // Once both viewers are ready and BOTH sides have a 3D scene, then and only then the 3D rotation
  // can be synced (see niiHas3DExtent/topoHasContent above for why).
  // Re-runs whenever this changes on either side (not just once at mount),
  // so e.g. closing the topo window, or resetting the imaging panel down to just an ESI connectome,
  // un-links the panels — broadcastTo([]) — instead of leaving a stale link to a now-degenerate NiiVue instance whose sync() would crash the still-focused panel.
  useEffect(() => {
    if (!niiNvReady || !topoNvReady) return;
    const nvNii = nvRef_niiviewer.current;
    const nvTopo = nvRef_eegtopo.current;
    if (niiHas3DExtent && topoHasContent) {
      nvNii.broadcastTo([nvTopo], { '2d': false, '3d': true });
      nvTopo.broadcastTo([nvNii], { '2d': false, '3d': true });
    } else {
      nvNii.broadcastTo([]);
      nvTopo.broadcastTo([]);
    }
  }, [niiNvReady, topoNvReady, niiHas3DExtent, topoHasContent]);

  // Handler for when imaging files are dropped or selected. It reads the files as ArrayBuffers and prepares them for visualization, updating state accordingly.
  // NiiViewer shows its own loading/success toast once mounted, so this just sets layers and surfaces errors.
  const handleNiiFiles = async (files) => {
    setIsLoading(true);
    try {
      const result = await Promise.all(filesToLayers(files));
      setLayers(result);
    } catch (err) {
      toast.error(`Error loading imaging data:\n${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Top-bar "Reset" button — clears both panels back to their empty drop zone state, as
  // if the page had just loaded. Superset of handleEegReset + handleNiiReset below, plus
  // the EEG-side state that only this full reset needs to touch (layers/niiHasOwnContent
  // are the Neuroimaging side, which handleEegReset deliberately leaves alone).
  const handleReset = () => {
    setEeg(null);
    setLayers([]);
    setNiiHasOwnContent(false);
    resetIntake();
    setElectrodeSnapshot(null);
    resetInverseSolution();
    resetMontage();
    setChannelSnapshot(null);
    setRecordingType('eeg');
  };

  // SplitPane's left (EEG) panel reset button — clears only the EEG side (recording,
  // pending files, electrode positions, inverse solution/montage/ESI, recording type).
  // Leaves `layers`/`niiHasOwnContent` untouched, so any imaging data already loaded in
  // the Neuroimaging panel survives; the intracranial connectome layer built from EEG
  // state does get cleared, via setIntracranialSnapshot(null) below.
  const handleEegReset = () => {
    setEeg(null);
    resetIntake();
    setRecordingType('eeg');
    setElectrodeSnapshot(null);
    resetInverseSolution();
    resetMontage();
    setChannelSnapshot(null);
  };

  // SplitPane's right (Neuroimaging) panel reset button — clears only the imaging volumes
  // dropped via PatientView's `layers` state and NiiViewer's own internal dropzone flag.
  // Leaves the EEG side, and therefore the intracranial/ESI connectome layers derived
  // from it, untouched — NiiViewer stays mounted and simply re-renders without `layers`.
  const handleNiiReset = () => {
    setLayers([]);
    setNiiHasOwnContent(false);
  };

  return (
    <FullWidthLayout>
      {/* Top bar: 3-column flex row so the title is always geometrically between the left buttons and right toggle */}
      <div className="shrink-0 flex items-start border-b border-border">
        {/* Left column: Back + Load Demo in normal flow — top bar never scrolls so fixed isn't needed */}
        <div className="shrink-0 flex flex-col items-start gap-2 px-5 py-3 z-10">
          <Link to="/" className="button flex items-center gap-2 px-3 py-1">
            <ArrowLeft size={16} /> Back
          </Link>
          <button
            type="button"
            className="button px-3 py-1"
            onClick={
              eeg || layers.length > 0 || pendingEegFiles.length > 0 ? handleReset : handleLoadDemo
            }
            disabled={isLoading}
            title={
              isDemoLoading
                ? 'Loading demo data…'
                : eeg || layers.length > 0 || pendingEegFiles.length > 0
                  ? 'Reset both viewers'
                  : 'Load demo data to test VIDEPE without needing your own files'
            }
          >
            {isDemoLoading
              ? 'Loading…'
              : eeg || layers.length > 0 || pendingEegFiles.length > 0
                ? 'Reset'
                : 'Load Demo'}
          </button>
        </div>

        {/* Center column: title always stays between the two side columns */}
        <div className="flex-1 min-w-0 flex flex-col items-center justify-center py-2 text-center select-none pointer-events-none">
          <h1 className="!mb-3">VIDEPE</h1>
          <p className="text-sm text-foreground/70 py-2">
            <span className="font-bold">V</span>isualization & <span className="font-bold">I</span>
            ntegration of <span className="font-bold">D</span>ata for{' '}
            <span className="font-bold">E</span>pilepsy <span className="font-bold">P</span>
            resurgical <span className="font-bold">E</span>valuation
          </p>
          <span className="text-xs text-foreground/40 border border-border/60 rounded-full px-2 py-0.5">
            In Development
          </span>
        </div>

        {/* Right column: ThemeToggle rendered inline (not fixed) — top bar never scrolls so fixed isn't needed,
            and inline keeps it locked to the layout as the window resizes */}
        <div className="shrink-0 flex items-start px-5 py-3">
          <ThemeToggle className="" />
        </div>
      </div>

      <SplitPane
        leftLabel={
          eeg ? (
            <EEGTypeToggle recordingType={recordingType} onChange={setRecordingType} />
          ) : (
            <span className={PANEL_TITLE_CLASS}>EEG</span>
          )
        }
        rightLabel={<span className={PANEL_TITLE_CLASS}>Neuroimaging</span>}
        onLeftReset={eeg || pendingEegFiles.length > 0 ? handleEegReset : undefined}
        onRightReset={niiViewerHasContent ? handleNiiReset : undefined}
        onMaximizeChange={setMaximizedPanel}
        left={
          eeg ? (
            <EegViewer
              nvRef_eegtopo={nvRef_eegtopo}
              provider={eeg}
              channelNames={eeg.channelNames}
              onViewReady={() => eegReadyResolveRef.current?.()} // charts ready
              onTopoNvReady={handleTopoNvReady} // topo canvas ready
              customElectrodes={customElectrodes}
              customElecPosFileName={customElecPosFileName}
              inverseSolutionFileName={inverseSolutionFileName}
              recordingType={recordingType}
              onRecordingTypeChange={setRecordingType}
              montage={montage}
              onMontageChange={handleMontageChange}
              onElecPosFile={handleElecPosFile}
              onInverseSolutionFile={handleInverseSolutionFile}
              onElectrodeSnapshotChange={setElectrodeSnapshot}
              onChannelSnapshotChange={setChannelSnapshot}
              onTopoHasContentChange={setTopoHasContent}
            />
          ) : (
            <div className="h-full p-2">
              <FileDropZone
                onFiles={handleEegFiles}
                accepted_formats=".vhdr,.eeg,.elc,.tsv,.mat"
                label={'Drop EEG files'}
                description={
                  '\tBrainVision EEG:\t\t\t.vhdr + .eeg\nElectrode Positions:\t\t.elc + .tsv\n\t\tInverse Solution:\t\t\t.mat (FieldTrip)'
                }
                // Registered electrode-position/inverse-solution files ride along in the same checkmark list as pending EEG files.
                pendingFiles={[
                  ...pendingEegFiles.map((f) => ({ name: `EEG Recording: ${f.name}` })),
                  ...(customElecPosFileName
                    ? [{ name: `Electrode positions: ${customElecPosFileName}` }]
                    : []),
                  ...(inverseSolutionFileName
                    ? [{ name: `Inverse solution: ${inverseSolutionFileName}` }]
                    : []),
                ]}
                hint={eegHint}
                className="h-full min-h-48"
              />
            </div>
          )
        }
        right={
          niiViewerHasContent ? (
            <NiiViewer
              nvRef={nvRef_niiviewer}
              layers={layers}
              electrodeLayer={electrodeLayer}
              esiLayer={esiLayer}
              onHasContentChange={setNiiHasOwnContent}
              onHas3DExtentChange={setNiiHas3DExtent}
              isFullscreen={maximizedPanel === 'right'}
              onViewReady={() => niiReadyResolveRef.current?.()}
              onNiiNvReady={() => setNiiNvReady(true)}
            />
          ) : (
            <div className="h-full p-2">
              <FileDropZone
                onFiles={handleNiiFiles}
                accepted_formats=".nii,.nii.gz,.mgh,.mgz,.gii,.ply,.obj"
                label="Drop imaging files"
                description="Volumes: NIfTI, MGH, GIFTI, PLY, OBJ, …"
                className="h-full min-h-48"
              />
            </div>
          )
        }
      />
    </FullWidthLayout>
  );
};
