import { ExternalLink, Brain, ChartLine, FolderOpen, Columns2, FlaskConical, TabletSmartphone, ShieldCheck, ArrowLeft, CodeXml } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useScrollToHash } from '@/utils/useScrollToHash';
import { CenteredLayout } from '../components/CenteredLayout';
import { Footer } from '../components/Footer';
import { ThemeToggle } from '../components/ThemeToggle';
import { ScrollToTopButton } from '../components/ScrollToTopButton';

const NiiVueIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const Section = ({ title, id, children }) => (
  <section id={id} className="mb-10">
    <h2 className="mb-4">{title}</h2>
    {children}
  </section>
);

const PersonCard = ({ name, role, affiliation, url, urlLabel, secondaryUrl, secondaryLabel }) => (
  <div className="flex flex-col gap-1 p-4 rounded-lg border" style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface)' }}>
    <p className="font-semibold" style={{ color: 'var(--c-heading)' }}>{name}</p>
    <p className="text-sm" style={{ color: 'var(--c-foreground)' }}>{role}</p>
    {affiliation &&
      (Array.isArray(affiliation) ? affiliation : [affiliation]).map((a, i) => (
        <p key={i} className="text-sm" style={{ color: 'var(--c-foreground)', opacity: 0.75 }}>{a}</p>
      ))
    }
    {url && (
      <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm mt-1" style={{ color: 'var(--c-primary)' }}>
        <ExternalLink size={14} /> {urlLabel}
      </a>
    )}
    {secondaryUrl && (
      <a href={secondaryUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm" style={{ color: 'var(--c-primary)' }}>
        <ExternalLink size={14} /> {secondaryLabel}
      </a>
    )}
  </div>
);

const LibraryCard = ({ name, description, url, license }) => (
  <div className="flex flex-col gap-1 p-4 rounded-lg border" style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface)' }}>
    <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 font-semibold" style={{ color: 'var(--c-primary)' }}>
      {name} <ExternalLink size={14} />
    </a>
    <p className="text-sm" style={{ color: 'var(--c-foreground)' }}>{description}</p>
    {license && <p className="text-xs mt-1" style={{ color: 'var(--c-foreground)', opacity: 0.7 }}>License: {license}</p>}
  </div>
);

const FundingBadge = ({ children }) => (
  <div className="px-4 py-3 rounded-lg border text-sm" style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface)', color: 'var(--c-foreground)' }}>
    {children}
  </div>
);

export const AboutPage = () => {
  useScrollToHash();

  return (
    <CenteredLayout footer={<Footer />}>
      <ScrollToTopButton />
      <ThemeToggle />
      <Link to="/" className="button fixed top-5 left-5 z-50 flex items-center gap-2 px-3 py-1">
        <ArrowLeft size={16} /> Back
      </Link>
      <div className="px-5 pt-16 pb-10 max-w-3xl mx-auto w-full">

        <Section title="About VIDEPE">
          <p>
            <strong>VIDEPE</strong> —{' '}
            <strong>V</strong>isualization &amp; <strong>I</strong>ntegration of <strong>D</strong>ata
            for <strong>E</strong>pilepsy <strong>P</strong>resurgical <strong>E</strong>valuation —
            is an open-source web application for reviewing EEG and neuroimaging data (MRI, PET,
            SPECT), developed at the{' '}
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
        </Section>

        <hr className="mb-10" />

        <Section title="Features">
          <div className="flex flex-col gap-4">
            <div className="flex gap-3 p-4 rounded-lg border" style={{ borderColor: 'var(--c-primary)', background: 'var(--c-surface)' }}>
              <ShieldCheck size={22} className="shrink-0 mt-0.5" style={{ color: 'var(--c-primary)' }} />
              <div>
                <p className="font-semibold" style={{ color: 'var(--c-heading)' }}>Privacy-first: 100% local processing</p>
                <p className="text-sm" style={{ color: 'var(--c-foreground)' }}>
                  All data processing happens entirely in your browser — no files are ever uploaded
                  to a server or sent anywhere remotely. This makes VIDEPE safe to use with sensitive
                  medical data, including patient recordings, without any risk of data leaving your
                  machine.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <ChartLine size={22} className="shrink-0 mt-0.5" style={{ color: 'var(--c-primary)' }} />
              <div>
                <p className="font-semibold" style={{ color: 'var(--c-heading)' }}>EEG viewer</p>
                <p className="text-sm" style={{ color: 'var(--c-foreground)' }}>
                  Multichannel time-series plots with synchronized pan/zoom across all channels.
                  Adjustable gain, window size, and time-shift step. Interactive timeline scrubber
                  for fast navigation. Configurable number of visible channels.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Brain size={22} className="shrink-0 mt-0.5" style={{ color: 'var(--c-primary)' }} />
              <div>
                <p className="font-semibold" style={{ color: 'var(--c-heading)' }}>Neuroimaging viewer</p>
                <p className="text-sm" style={{ color: 'var(--c-foreground)' }}>
                  Multiplanar + 3D rendering for NIfTI volumes. Multi-layer support for MRI, PET,
                  and SPECT simultaneously. Per-layer controls for opacity, colormap, and colorbar.
                  Drag-to-reorder layers.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <FlaskConical size={22} className="shrink-0 mt-0.5" style={{ color: 'var(--c-primary)' }} />
              <div>
                <p className="font-semibold" style={{ color: 'var(--c-heading)' }}>Built-in demo</p>
                <p className="text-sm" style={{ color: 'var(--c-foreground)' }}>
                  Load a sample EEG + MRI/PET/SPECT dataset with one click to explore the viewer
                  without your own files.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <FolderOpen size={22} className="shrink-0 mt-0.5" style={{ color: 'var(--c-primary)' }} />
              <div>
                <p className="font-semibold" style={{ color: 'var(--c-heading)' }}>Drag &amp; drop file loading</p>
                <p className="text-sm" style={{ color: 'var(--c-foreground)' }}>
                  Drop EEG or imaging files directly onto the viewer. Multi-file formats (e.g.
                  BrainVision <code>.vhdr</code> + <code>.eeg</code>) can be dropped together or in
                  separate drops.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Columns2 size={22} className="shrink-0 mt-0.5" style={{ color: 'var(--c-primary)' }} />
              <div>
                <p className="font-semibold" style={{ color: 'var(--c-heading)' }}>Side-by-side split view</p>
                <p className="text-sm" style={{ color: 'var(--c-foreground)' }}>
                  Adjustable split between EEG and neuroimaging panels, with maximize, restore, and
                  swap controls.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <TabletSmartphone size={22} className="shrink-0 mt-0.5" style={{ color: 'var(--c-primary)' }} />
              <div>
                <p className="font-semibold" style={{ color: 'var(--c-heading)' }}>Cross-platform</p>
                <p className="text-sm" style={{ color: 'var(--c-foreground)' }}>
                  Runs on modern browsers including mobile. Dark/light mode with OS preference
                  detection.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <CodeXml size={22} className="shrink-0 mt-0.5" style={{ color: 'var(--c-primary)' }} />
              <div>
                <p className="font-semibold" style={{ color: 'var(--c-heading)' }}>Open source</p>
                <p className="text-sm" style={{ color: 'var(--c-foreground)' }}>
                  VIDEPE is licensed under the GNU Affero General Public License v3 (AGPL-3.0) and
                  publicly available on GitHub. All derivative works must remain open source.
                  Contributions, bug reports, and feature requests are welcome.
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
              role="Project Lead"
              affiliation="Department of Clinical Neuroscience - University of Geneva (UNIGE)"
              url="https://neurocenter-unige.ch/research-groups/nicolas-roehri/"
              urlLabel="Research group"
              secondaryUrl="https://linkedin.com/in/nicolas-roehri-43526580"
              secondaryLabel="LinkedIn"
            />
            <PersonCard
              name="Jeroen Buil"
              role="Developer"
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
              This work received the{' '}
              <strong>Pépite Award</strong> from the{' '}
              <strong>Centre of Innovation of the Geneva University Hospitals</strong>.
            </FundingBadge>
            <FundingBadge>
              NR is supported by the{' '}
              <strong>Swiss National Science Foundation</strong> (grant 209120).
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
