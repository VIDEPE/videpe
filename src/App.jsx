import { HashRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './components/ThemeContext';
import { ThemedToaster } from './components/ThemedToaster';
import { LandingPage } from './pages/LandingPage';
import { AboutPage } from './pages/AboutPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PatientView } from './pages/PatientView';

function App() {
  return (
    <ThemeProvider>
      {/* Global Toaster for notifications (e.g., error messages when loading files fails).*/}
      <ThemedToaster />
      {/* HashRouter is used for client-side routing. It uses the URL hash to keep the UI in sync with the URL. 
      This is simpler to set up than BrowserRouter, especially for static file hosting, but results in URLs with a # (e.g., /#/patient-view). */}
      <HashRouter>
        {/* Routes define the different pages of the app. with LandingPage at the root path "/" */}
        <Routes>
          {/* Landing page with welcome message and links to other pages */}
          <Route path="/" element={<LandingPage />} />
          {/* Main patient viewer page where users can load EEG and imaging data */}
          <Route path="/patient-view" element={<PatientView />} />
          {/* About page with information about the app */}
          <Route path="/about" element={<AboutPage />} />
          {/* Catch-all route for undefined paths, showing a 404 Not Found page */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </HashRouter>
    </ThemeProvider>
  );
}
export default App;
