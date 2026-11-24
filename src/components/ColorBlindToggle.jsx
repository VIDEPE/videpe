import { EyeDashed } from 'lucide-react';
import { useColorBlindMode } from '@/hooks/useColorBlindMode';

// App-wide colorblind colormap toggle — switches every blue-white-red voltage map (EEG
// topography, electrode matrix, 3D connectome voltages) to the cividis variant. Sized to sit
// under the ThemeToggle in the PatientView header.
export const ColorBlindToggle = ({ className = '' }) => {
  const { isColorBlindMode, toggleColorBlindMode } = useColorBlindMode();

  return (
    <button
      type="button"
      onClick={toggleColorBlindMode}
      className={`${className} button-bare p-2`}
      aria-label={isColorBlindMode ? 'Turn colorblind colormap off' : 'Turn colorblind colormap on'}
      title={
        isColorBlindMode
          ? 'Colorblind colormap on — voltage maps use cividis (blue-white-yellow)'
          : 'Colorblind colormap off — voltage maps use blue-white-red'
      }
      aria-pressed={isColorBlindMode}
    >
      {/* Highlighted while on (primary), muted while off — same footprint as the ThemeToggle icon.
          /70 rather than /50: .button-bare already rests the icon at 85% opacity, so this
          stacks to ~60% — still clearly muted next to the primary-coloured on state. */}
      <EyeDashed
        className={`h-7 w-7 ${isColorBlindMode ? 'text-primary' : 'text-foreground/70'}`}
      />
    </button>
  );
};
