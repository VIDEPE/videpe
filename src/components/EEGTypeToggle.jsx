import { cn } from '../utils/utils';

// Sits in the SplitPane's left title once EEG is loaded, replacing the static "EEG"
// label. One switch, not two buttons — clicking anywhere flips the value regardless of
// which label half was clicked. pointer-events-auto overrides panelHeader's <h2>.
export const EEGTypeToggle = ({ recordingType, onChange }) => {
  const isIntracranial = recordingType === 'ieeg';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isIntracranial}
      aria-label="Recording type"
      onClick={() => onChange(isIntracranial ? 'eeg' : 'ieeg')}
      className="relative w-28 h-6.5 rounded-full border border-border bg-background cursor-pointer pointer-events-auto"
      title="Automatically detected from channel naming — click to overwrite"
    >
      <span className="absolute inset-0.5 flex">
        <span
          className={cn(
            'absolute inset-y-0 left-0 w-1/2 rounded-full bg-primary transition-transform duration-150 ease-out',
            isIntracranial && 'translate-x-full'
          )}
        />
        <span
          className={cn(
            'relative z-10 flex-1 flex items-center justify-center text-xl font-medium leading-none transition-colors',
            !isIntracranial ? 'text-header' : 'text-foreground/50'
          )}
        >
          EEG
        </span>
        <span
          className={cn(
            'relative z-10 flex-1 flex items-center justify-center text-xl font-medium leading-none transition-colors',
            isIntracranial ? 'text-header' : 'text-foreground/50'
          )}
        >
          iEEG
        </span>
      </span>
    </button>
  );
};
