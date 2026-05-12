import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { ThemeToggle } from '../components/ThemeToggle';

// Icons & Logos
import { Globe } from 'lucide-react';
const GithubIcon = ({ size = 24, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    {...props}
  >
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);
import Logo from '../assets/logo.svg?react';

// Links
const GITHUB_URL = 'https://github.com/VIDEPE/videpe'; // Link to github page
const UNIGE_URL =
  'https://www.unige.ch/medecine/neucli/groupes-de-recherche/serge-vulliemoz/open-science/videpe2';
const DOCS_URL = '#'; // TODO: add when available

export const LandingPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh">
      {/*Theme Toggle Button for switching themes */}
      <ThemeToggle />

      <section className="flex flex-col items-center justify-center gap-8 flex-grow px-5 py-12">
        <Logo className="w-48 app-logo" aria-label="VIDÉPÉ logo" />
        <button type="button" className="button" onClick={() => navigate('/analysis')}>
          Get Started
        </button>
      </section>
      <hr></hr>
      <section id="documentation_section" className="grid grid-cols-1 md:grid-cols-2">
        <div id="docs">
          <Globe size={22} className="icon" />
          <h2>Documentation</h2>
          <ul>
            <li>
              <a href={DOCS_URL}>Documentation</a>
            </li>
            <li>
              <a href={`${GITHUB_URL}#readme`} target="_blank">
                README
              </a>
            </li>
            <li>
              <Link to="/about">About</Link>
            </li>
          </ul>
        </div>

        <div id="social">
          <GithubIcon size={22} className="icon" />
          <h2>Connect with us</h2>
          <ul>
            <li>
              <a href={GITHUB_URL} target="_blank">
                <GithubIcon size={18} aria-hidden="true" />
                GitHub
              </a>
            </li>
            <li>
              <a href={UNIGE_URL} target="_blank" rel="noreferrer">
                <Globe size={18} aria-hidden="true" />
                UNIGE
              </a>
            </li>
          </ul>
        </div>
      </section>

      <div className="ticks" />
      <div id="spacer" />
    </div>
  );
};
