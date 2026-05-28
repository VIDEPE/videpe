import { useState } from 'react';
import { Eye, EyeOff, ChevronDown, ChevronUp, GripVertical } from 'lucide-react';

const COLORMAP_OPTIONS = [
  { value: 'gray', label: 'Grayscale' },
  { value: 'viridis', label: 'Viridis' },
  { value: 'magma', label: 'Magma' },
  { value: 'mako', label: 'Mako' },
];

const ToggleSwitch = ({ checked, onChange, 'aria-label': ariaLabel }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    onClick={() => onChange(!checked)}
    className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-border'}`}
  >
    <span
      className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-background transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`}
    />
  </button>
);

export const ImagingControls = ({ volumes, layerSettings, onSettingChange }) => {
  const [expandedIndex, setExpandedIndex] = useState(null);

  return (
    <div className="flex flex-col gap-1 py-2">
      {volumes.map((volume, index) => {
        const settings = layerSettings[index];
        const isExpanded = expandedIndex === index;
        const label = volume.type ?? `Volume ${index + 1}`;

        return (
          <div key={volume.url} className="rounded border border-border bg-surface">
            {/* Always-visible header row */}
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              {/* Drag handle — wired up in Step 4 */}
              <GripVertical size={14} className="text-border shrink-0 cursor-grab" />

              <span className="flex-1 text-sm font-medium text-heading truncate">{label}</span>

              <button
                type="button"
                onClick={() => onSettingChange(index, 'visible', !settings.visible)}
                className="button button-icon"
                aria-label={`${settings.visible ? 'Hide' : 'Show'} ${label}`}
              >
                {settings.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>

              <button
                type="button"
                onClick={() => setExpandedIndex(isExpanded ? null : index)}
                className="button button-icon"
                aria-label={isExpanded ? `Collapse ${label} controls` : `Expand ${label} controls`}
              >
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>

            {/* Expanded controls */}
            {isExpanded && (
              <div className="border-t border-border px-3 py-2.5 flex flex-col gap-3 text-sm">
                {/* Opacity */}
                <div className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-foreground">Opacity</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={settings.opacity}
                    onChange={(e) => onSettingChange(index, 'opacity', parseFloat(e.target.value))}
                    className="flex-1"
                    aria-label={`${label} opacity`}
                  />
                  <span className="w-9 text-right tabular-nums text-foreground">
                    {Math.round(settings.opacity * 100)}%
                  </span>
                </div>

                {/* Colormap */}
                <div className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-foreground">Colormap</span>
                  <select
                    value={settings.colormap}
                    onChange={(e) => onSettingChange(index, 'colormap', e.target.value)}
                    className="flex-1 bg-surface border border-border rounded px-2 py-0.5 text-foreground cursor-pointer"
                    aria-label={`${label} colormap`}
                  >
                    {COLORMAP_OPTIONS.map(({ value, label: optionLabel }) => (
                      <option key={value} value={value}>
                        {optionLabel}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Invert */}
                <div className="flex items-center justify-between">
                  <span className="text-foreground">Invert</span>
                  <ToggleSwitch
                    checked={settings.invert}
                    onChange={(value) => onSettingChange(index, 'invert', value)}
                    aria-label={`Invert ${label} colormap`}
                  />
                </div>

                {/* Show colorbar */}
                <div className="flex items-center justify-between">
                  <span className="text-foreground">Colorbar</span>
                  <ToggleSwitch
                    checked={settings.showColorbar}
                    onChange={(value) => onSettingChange(index, 'showColorbar', value)}
                    aria-label={`Show ${label} colorbar`}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
