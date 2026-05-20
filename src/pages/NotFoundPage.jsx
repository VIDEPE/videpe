import { useNavigate } from 'react-router-dom';
import { Home, ArrowLeft } from 'lucide-react';

export const NotFoundPage = () => {
  const navigate = useNavigate();

  return (
    <section className="min-h-screen flex items-center justify-center px-4 py-24">
      <div className="container max-w-2xl mx-auto text-center">
        {/* 404 Number */}
        <h1 className="text-9xl md:text-[12rem] font-bold text-primary opacity-20 leading-none">
          404
        </h1>

        {/* Main Message */}
        <div className="mt-8 space-y-4">
          <h2 className="text-3xl md:text-5xl font-bold">
            Page Not <span className="text-primary">Found</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-md mx-auto">
            Oops! It looks like you've wandered into uncharted territory. The page you're looking
            for doesn't exist.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="mt-12 flex flex-col sm:flex-row gap-4 justify-center">
          <button
            onClick={() => navigate('/')}
            className="cosmic-button inline-flex items-center gap-2"
          >
            <Home size={18} />
            Back to Home
          </button>
          <button
            onClick={() => navigate(-1)}
            className="cosmic-button-inverted inline-flex items-center gap-2"
          >
            <ArrowLeft size={18} />
            Go Back
          </button>
        </div>
      </div>
    </section>
  );
};
