import {
  ExternalLink,
  Brain,
  ChartLine,
  ChartNetwork,
  FolderOpen,
  Columns2,
  FlaskConical,
  TabletSmartphone,
  ShieldCheck,
  ArrowLeft,
  CodeXml,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useScrollToHash } from '@/utils/useScrollToHash';
import { CenteredLayout } from '../components/CenteredLayout';
import { Footer } from '../components/Footer';
import { ThemeToggle } from '../components/ThemeToggle';
import { ScrollToTopButton } from '../components/ScrollToTopButton';

const NiiVueIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path
      d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
      stroke="currentColor"
      strokeWidth="2"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const Section = ({ title, id, className, children }) => (
  <section id={id} className={`mb-10 ${className ?? ''}`}>
    <h2 className="mb-4">{title}</h2>
    {children}
  </section>
);

const PersonCard = ({ name, role, affiliation, url, urlLabel, secondaryUrl, secondaryLabel }) => (
  <div
    className="flex flex-col gap-1 p-4 rounded-lg border"
    style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface)' }}
  >
    <p className="font-bold text-heading">{name}</p>
    <p className="text-sm text-heading font-thin">{role}</p>
    {affiliation &&
      (Array.isArray(affiliation) ? affiliation : [affiliation]).map((a, i) => (
        <p key={i} className="text-sm" style={{ color: 'var(--c-foreground)', opacity: 0.75 }}>
          {a}
        </p>
      ))}
    {url && (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1 text-sm mt-1"
        style={{ color: 'var(--c-primary)' }}
      >
        <ExternalLink size={14} /> {urlLabel}
      </a>
    )}
    {secondaryUrl && (
      <a
        href={secondaryUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1 text-sm"
        style={{ color: 'var(--c-primary)' }}
      >
        <ExternalLink size={14} /> {secondaryLabel}
      </a>
    )}
  </div>
);

const LibraryCard = ({ name, description, url, license }) => (
  <div
    className="flex flex-col gap-1 p-4 rounded-lg border"
    style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface)' }}
  >
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 font-semibold"
      style={{ color: 'var(--c-primary)' }}
    >
      {name} <ExternalLink size={14} />
    </a>
    <p className="text-sm" style={{ color: 'var(--c-foreground)' }}>
      {description}
    </p>
    {license && (
      <p className="text-xs mt-1" style={{ color: 'var(--c-foreground)', opacity: 0.7 }}>
        License: {license}
      </p>
    )}
  </div>
);

const FundingBadge = ({ children }) => (
  <div
    className="px-4 py-3 rounded-lg border text-sm"
    style={{
      borderColor: 'var(--c-border)',
      background: 'var(--c-surface)',
      color: 'var(--c-foreground)',
    }}
  >
    {children}
  </div>
);

export const AboutPage = () => {
  useScrollToHash();

  return (
    <CenteredLayout footer={<Footer />}>
      <ScrollToTopButton />
      {/* Navigation — normal page flow, sits at top and scrolls out of view as the page scrolls down */}
      <div className="flex items-center justify-between px-5 pt-5">
        <Link to="/" className="button flex items-center gap-2 px-3 py-1">
          <ArrowLeft size={16} /> Back
        </Link>
        <ThemeToggle className="" />
      </div>
      <div className="px-5 pt-6 pb-10 max-w-3xl mx-auto w-full">
        <Section id="about-videpe" title="About VIDEPE" className="!mb-2">
          <p>
            <strong>VIDEPE</strong> — <strong>V</strong>isualization &amp; <strong>I</strong>
            ntegration of <strong>D</strong>ata for <strong>E</strong>pilepsy <strong>P</strong>
            resurgical <strong>E</strong>valuation — is an open-source web application for reviewing
            EEG and neuroimaging data (MRI, PET, SPECT), developed at the{' '}
            <a
              href="https://www.unige.ch/medecine/neucli/groupes-de-recherche/serge-vulliemoz/open-science/videpe2"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--c-primary)' }}
            >
              Epilepsy and Brain Networks Lab, UNIGE
            </a>
            .
          </p>
          <hr className="mt-4 mb-3" />
          <p className="text-sm" style={{ color: 'var(--c-alert)', opacity: 0.7 }}>
            VIDEPE is currently under active development. Features and interfaces may change, and
            some functionality may be incomplete or subject to revision.
          </p>
        </Section>

        <hr className="mb-10" />

        <Section title="Features">
          <div className="flex flex-col gap-4">
            <div
              id="feature-privacy"
              className="flex gap-3 p-4 rounded-lg border"
              style={{ borderColor: 'var(--c-primary)', background: 'var(--c-surface)' }}
            >
              <ShieldCheck
                size={22}
                className="shrink-0 mt-0.5"
                style={{ color: 'var(--c-primary)' }}
              />
              <div>
                <p className="font-semibold text-heading">Privacy-first: 100% local processing</p>
                <p className="text-sm mt-1" style={{ color: 'var(--c-foreground)' }}>
                  All data processing happens entirely in your browser. No files are ever uploaded
                  to a server, sent to a third party, or stored outside your own machine. This makes
                  VIDEPE safe to use with sensitive medical data — including identifiable patient
                  recordings — without any institutional data-sharing agreement or de-identification
                  step.
                </p>
              </div>
            </div>

            <div id="feature-eeg" className="flex gap-3">
              <ChartLine
                size={22}
                className="shrink-0 mt-0.5"
                style={{ color: 'var(--c-primary)' }}
              />
              <div>
                <p className="font-semibold text-heading">EEG viewer</p>
                <p className="text-sm mt-1" style={{ color: 'var(--c-foreground)' }}>
                  A high-performance multichannel viewer built on{' '}
                  <a
                    href="https://github.com/leeoniya/uplot"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--c-primary)' }}
                  >
                    uPlot
                  </a>
                  , optimised for long EEG recordings with many channels. All plots share a single
                  time axis — panning or zooming one channel instantly updates all others.
                </p>
                <ul
                  className="text-sm mt-2 flex flex-col gap-1 list-disc list-inside"
                  style={{ color: 'var(--c-foreground)' }}
                >
                  <li>Adjustable range (µV scale), window size, and time step</li>
                  <li>
                    Interactive timeline scrubber for fast navigation across the full recording
                  </li>
                  <li>
                    Keyboard navigation — arrow keys for range/panning, Page Up/Down and Space for
                    window jumps, Home/End to jump to the start/end
                  </li>
                  <li>Configurable number of simultaneously visible channels</li>
                  <li>Min-max downsampling keeps rendering fast at any zoom level</li>
                  <li>
                    EEG topography — a resizable panel showing a 3D voltage map at the selected time
                    point using{' '}
                    <a
                      href="https://niivue.com/"
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--c-primary)' }}
                    >
                      NiiVue
                    </a>{' '}
                    mesh rendering; re-reference on the fly (none, average, or median); diverging
                    blue-white-red colormap with a live colorbar (µV) and a colour-blind-friendly
                    mode; individual electrode markers on the mesh, voltage-coloured for matched
                    channels; uses Standard 10-05 electrode positions by default with support for
                    custom <code>.elc</code> or <code>.tsv</code> files; 3D rotation is synchronised
                    with the neuroimaging viewer — rotate one and the other follows
                  </li>
                </ul>
              </div>
            </div>

            <div id="feature-ieeg" className="flex gap-3">
              <ChartNetwork
                size={22}
                className="shrink-0 mt-0.5"
                style={{ color: 'var(--c-primary)' }}
              />
              <div>
                <p className="font-semibold text-heading">Intracranial (iEEG) support</p>
                <p className="text-sm mt-1" style={{ color: 'var(--c-foreground)' }}>
                  Toggle between scalp EEG and intracranial (sEEG/ECoG) recordings. Intracranial
                  channels are auto-detected from channel naming, with a manual override always
                  available.
                </p>
                <ul
                  className="text-sm mt-2 flex flex-col gap-1 list-disc list-inside"
                  style={{ color: 'var(--c-foreground)' }}
                >
                  <li>
                    Intracranial channels are shown as a per-electrode-group, per-contact voltage
                    matrix instead of the scalp topography mesh
                  </li>
                  <li>
                    Once electrode positions are loaded, intracranial electrodes are also rendered
                    as a 3D electrode connectome in the neuroimaging viewer, synchronised with the
                    selected EEG timepoint
                  </li>
                  <li>
                    Supports custom electrode positions via <code>.elc</code> or <code>.tsv</code>{' '}
                    files
                  </li>
                </ul>
              </div>
            </div>

            <div id="feature-neuroimaging" className="flex gap-3">
              <Brain size={22} className="shrink-0 mt-0.5" style={{ color: 'var(--c-primary)' }} />
              <div>
                <p className="font-semibold text-heading">Neuroimaging viewer</p>
                <p className="text-sm mt-1" style={{ color: 'var(--c-foreground)' }}>
                  Full multiplanar and 3D rendering powered by{' '}
                  <a
                    href="https://niivue.com/"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--c-primary)' }}
                  >
                    NiiVue
                  </a>
                  . Load multiple volumes simultaneously and adjust each one independently.
                </p>
                <ul
                  className="text-sm mt-2 flex flex-col gap-1 list-disc list-inside"
                  style={{ color: 'var(--c-foreground)' }}
                >
                  <li>Supports NIfTI (.nii, .nii.gz), MGH/MGZ, GIFTI, PLY, OBJ</li>
                  <li>Multi-layer support for MRI, PET, and SPECT in one view</li>
                  <li>
                    Per-layer opacity, colormap (grayscale, viridis, magma, mako), inversion, and
                    colorbar
                  </li>
                  <li>
                    Drag-to-reorder layers, with a modality subtype label shown on each volume
                  </li>
                  <li>
                    Slice view buttons for axial, coronal, sagittal, multiplanar, and 3D render
                  </li>
                </ul>
              </div>
            </div>

            <div id="feature-demo" className="flex gap-3">
              <FlaskConical
                size={22}
                className="shrink-0 mt-0.5"
                style={{ color: 'var(--c-primary)' }}
              />
              <div>
                <p className="font-semibold text-heading">Built-in demo</p>
                <p className="text-sm mt-1" style={{ color: 'var(--c-foreground)' }}>
                  Want to explore VIDEPE before committing your own files? Hit{' '}
                  <strong>Load Demo</strong> on the patient view to instantly load a synthetic EEG
                  recording alongside aligned MRI, PET, and SPECT volumes — no upload, no account,
                  no wait.
                </p>
              </div>
            </div>

            <div id="feature-drag-drop" className="flex gap-3">
              <FolderOpen
                size={22}
                className="shrink-0 mt-0.5"
                style={{ color: 'var(--c-primary)' }}
              />
              <div>
                <p className="font-semibold text-heading">Drag &amp; drop file loading</p>
                <p className="text-sm mt-1" style={{ color: 'var(--c-foreground)' }}>
                  Drop files directly onto either viewer panel. VIDEPE detects the format
                  automatically and guides you when multiple files are required.
                </p>
                <ul
                  className="text-sm mt-2 flex flex-col gap-1 list-disc list-inside"
                  style={{ color: 'var(--c-foreground)' }}
                >
                  <li>
                    EEG: BrainVision (<code>.vhdr</code> + <code>.eeg</code>) — drop both together
                    or one at a time
                  </li>
                  <li>Volumes: NIfTI, MGH/MGZ, GIFTI, PLY, OBJ</li>
                  <li>
                    Drop multiple imaging files at once to load them as separate layers, or append
                    them to an already-active neuroimaging viewer
                  </li>
                </ul>
              </div>
            </div>

            <div id="feature-split-view" className="flex gap-3">
              <Columns2
                size={22}
                className="shrink-0 mt-0.5"
                style={{ color: 'var(--c-primary)' }}
              />
              <div>
                <p className="font-semibold text-heading">Side-by-side split view</p>
                <p className="text-sm mt-1" style={{ color: 'var(--c-foreground)' }}>
                  EEG and neuroimaging panels sit side by side with a draggable divider. Each panel
                  can be independently maximised, restored, or reset, and the two panels can be
                  swapped without reloading any data.
                </p>
              </div>
            </div>

            <div id="feature-cross-platform" className="flex gap-3">
              <TabletSmartphone
                size={22}
                className="shrink-0 mt-0.5"
                style={{ color: 'var(--c-primary)' }}
              />
              <div>
                <p className="font-semibold text-heading">Cross-platform</p>
                <p className="text-sm mt-1" style={{ color: 'var(--c-foreground)' }}>
                  VIDEPE runs entirely in the browser — no installation, no plugins. It works on
                  modern desktop and mobile browsers alike. The interface adapts to the available
                  screen space, and dark or light mode is picked up from your OS preference
                  automatically, with a manual toggle always available.
                </p>
              </div>
            </div>

            <div id="feature-open-source" className="flex gap-3">
              <CodeXml
                size={22}
                className="shrink-0 mt-0.5"
                style={{ color: 'var(--c-primary)' }}
              />
              <div>
                <p className="font-semibold text-heading">Open source</p>
                <p className="text-sm mt-1" style={{ color: 'var(--c-foreground)' }}>
                  VIDEPE is free and open source, licensed under the{' '}
                  <a
                    href="https://www.gnu.org/licenses/agpl-3.0.html"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--c-primary)' }}
                  >
                    GNU Affero General Public License v3
                  </a>
                  . The source code is publicly available on{' '}
                  <a
                    href="https://github.com/VIDEPE/videpe"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--c-primary)' }}
                  >
                    GitHub
                  </a>
                  . All derivative works must remain open source under the same licence. Bug
                  reports, feature requests, and pull requests are welcome.
                </p>
              </div>
            </div>
          </div>
        </Section>

        <hr className="mb-10" />

        <Section title="Team" id="team">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <PersonCard
              name="Nicolas Roehri"
              role="Principle Investigator"
              affiliation="Department of Clinical Neuroscience - University of Geneva (UNIGE)"
              url="https://neurocenter-unige.ch/research-groups/nicolas-roehri/"
              urlLabel="Research group"
              secondaryUrl="https://linkedin.com/in/nicolas-roehri-43526580"
              secondaryLabel="LinkedIn"
            />
            <PersonCard
              name="Jeroen Buil"
              role="Biomedical Engineer & Software Developer"
              affiliation="Department of Clinical Neuroscience - University of Geneva (UNIGE)"
              url="https://jeroenbuil.github.io/"
              urlLabel="Website"
              secondaryUrl="https://linkedin.com/in/jeroen-buil"
              secondaryLabel="LinkedIn"
            />
            <PersonCard
              name="Isotta Rigoni"
              role="Maître Assistante"
              affiliation="Department of Clinical Neuroscience - University of Geneva (UNIGE)"
              url="https://www.unige.ch/medecine/neucli/groupes-de-recherche/serge-vulliemoz/membres-du-groupe/isotta-rigoni"
              urlLabel="Profile"
              secondaryUrl="https://linkedin.com/in/isotta-rigoni"
              secondaryLabel="LinkedIn"
            />
            <PersonCard
              name="Serge Vulliémoz"
              role="Associate Professor"
              affiliation={[
                'EEG and Epilepsy Unit - Geneva University Hospitals (HUG)',
                'Center for Biomedical Imaging (CIBM)',
              ]}
              url="https://neurocenter-unige.ch/research-groups/serge-vulliemoz/"
              urlLabel="Research group"
            />
          </div>
        </Section>

        <hr className="mb-10" />

        <Section title="Funding & Support">
          <div className="flex flex-col gap-3">
            <FundingBadge>
              This work was funded by a grant from the{' '}
              <strong>Private Foundation of the Geneva University Hospitals</strong>.
            </FundingBadge>
            <FundingBadge>
              This work received the <strong>Pépite Award</strong> from the{' '}
              <strong>Centre of Innovation of the Geneva University Hospitals</strong>.
            </FundingBadge>
            <FundingBadge>
              NR is supported by the <strong>Swiss National Science Foundation</strong> (grant
              209120).
            </FundingBadge>
          </div>
        </Section>

        <hr className="mb-10" />

        <Section title="Open Source Libraries">
          <p className="mb-4 text-sm" style={{ color: 'var(--c-foreground)' }}>
            VIDEPE relies heavily on the following open-source libraries:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <LibraryCard
              name="NiiVue"
              url="https://github.com/niivue/niivue"
              description="WebGL-based neuroimaging viewer powering the MRI/NIfTI volume rendering in VIDEPE. NiiVue supports a wide range of neuroimaging formats directly in the browser."
              license="BSD-2-Clause"
            />
            <LibraryCard
              name="uPlot"
              url="https://github.com/leeoniya/uPlot"
              description="A fast, lightweight canvas-based charting library used to render the multi-channel EEG waveforms. uPlot handles high-density time-series data with exceptional performance."
              license="MIT"
            />
          </div>
        </Section>
      </div>
    </CenteredLayout>
  );
};
