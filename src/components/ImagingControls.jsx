import { useState } from 'react';
import { Eye, EyeOff, ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { DragDropProvider } from '@dnd-kit/react';
import { useSortable } from '@dnd-kit/react/sortable';
import { X } from 'lucide-react';
import { ESI_LAYER_URL } from '@/utils/NiiViewer.utils';

const COLORMAP_OPTIONS = [
  { value: 'gray', label: 'Grayscale' },
  { value: 'viridis', label: 'Viridis' },
  { value: 'cividis', label: 'Cividis' },
  { value: 'inferno', label: 'Inferno' },
  { value: 'magma', label: 'Magma' },
  { value: 'mako', label: 'Mako' },
  { value: 'rocket', label: 'Rocket' },
  { value: 'turbo', label: 'Turbo' },
];

const ToggleSwitch = ({ checked, onChange, 'aria-label': ariaLabel, title }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    title={title}
    onClick={() => onChange(!checked)}
    className={`relative h-5 w-9 rounded-full transition-colors cursor-pointer ${checked ? 'bg-primary' : 'bg-border'}`}
  >
    <span
      className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-background transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`}
    />
  </button>
);

function SortableSettingsCard({
  layer,
  index,
  settings,
  isExpanded,
  onToggleExpand,
  onSettingChange,
  onDeleteLayer,
}) {
  const { ref, handleRef, isDragging } = useSortable({ id: layer.url, index });
  // Label is either "type - subtype" (e.g. "MRI - T1") or just "type" if no subtype, or "Layer {index}" as a fallback if no type
  const label = layer.type
    ? layer.type + (layer.subtype ? ` - ${layer.subtype}` : '')
    : `Layer ${index + 1}`;
  // Connectome layers (e.g. intracranial electrodes) are colored by their own baked-in
  // node/edge colormap, not a NiiVue volume colormap — the intensity colormap dropdown,
  // invert toggle, and colorbar toggle don't apply to them.
  const isConnectome = layer.kind === 'connectome';
  // ESI layers have their own toggle for ESI Volume / ESI Connectome
  const isEsiLayer = layer.url === ESI_LAYER_URL;

  // Local string state — allows typing a partial value (e.g. empty string) without breaking the numeric opacity
  const [opacityStr, setOpacityStr] = useState(() => String(Math.round(settings.opacity * 100)));

  // Shared by both the slider and the number field.
  // Stays permissive (mirrors raw text, forwards only once parseable) for the number field's sake
  // CommitOpacity below is the backstop that normalizes whatever is in the number field once it loses focus.
  const handleOpacityChange = (e) => {
    setOpacityStr(e.target.value);
    const val = Number(e.target.value);
    if (e.target.value !== '' && !isNaN(val))
      onSettingChange(index, 'opacity', Math.max(0, Math.min(100, Math.round(val))) / 100);
  };

  // Blur-time commit: unlike the typing handler above, this always forces a valid
  // 0-100 value and snaps the display back, however invalid what's currently shown is.
  const commitOpacity = (raw) => {
    const clamped = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
    setOpacityStr(String(clamped));
    onSettingChange(index, 'opacity', clamped / 100);
  };

  // Local string state — allows typing a partial value (e.g. empty string) without breaking
  // the numeric threshold. cal_min/cal_max are 0-1 fractions of this layer's own data range
  // (see getCalBounds in NiiViewer.jsx), same "fraction, not absolute value" convention as
  // opacity — just resolved against a different range once it reaches NiiVue.
  const [calMinStr, setCalMinStr] = useState(() => String(Math.round(settings.cal_min * 100)));
  const [calMaxStr, setCalMaxStr] = useState(() => String(Math.round(settings.cal_max * 100)));

  // Same permissive-while-typing split as opacity above, plus one extra constraint: cal_min
  // can never exceed cal_max (and vice versa). Clamping against the sibling thumb's current
  // committed value — not just the raw 0-100 range — is what enforces that.
  const handleCalMinChange = (e) => {
    setCalMinStr(e.target.value);
    const val = Number(e.target.value);
    if (e.target.value !== '' && !isNaN(val))
      onSettingChange(
        index,
        'cal_min',
        Math.min(Math.max(0, Math.min(100, Math.round(val))) / 100, settings.cal_max)
      );
  };
  const handleCalMaxChange = (e) => {
    setCalMaxStr(e.target.value);
    const val = Number(e.target.value);
    if (e.target.value !== '' && !isNaN(val))
      onSettingChange(
        index,
        'cal_max',
        Math.max(Math.max(0, Math.min(100, Math.round(val))) / 100, settings.cal_min)
      );
  };

  // Blur-time commit: forces a valid value and clamps against the sibling thumb, same as the
  // typing handlers above, then snaps the display back regardless of what was left in the box.
  const commitCalMin = (raw) => {
    const clamped = Math.min(
      Math.max(0, Math.min(100, Math.round(Number(raw) || 0))) / 100,
      settings.cal_max
    );
    setCalMinStr(String(Math.round(clamped * 100)));
    onSettingChange(index, 'cal_min', clamped);
  };
  const commitCalMax = (raw) => {
    const clamped = Math.max(
      Math.max(0, Math.min(100, Math.round(Number(raw) || 0))) / 100,
      settings.cal_min
    );
    setCalMaxStr(String(Math.round(clamped * 100)));
    onSettingChange(index, 'cal_max', clamped);
  };

  return (
    <div
      ref={ref}
      className={`min-w-0 rounded border border-border bg-surface transition-opacity ${isDragging ? 'opacity-60' : ''}`}
    >
      {/* Always-visible header row */}
      <div className="flex items-center gap-1.5 px-2 py-1">
        {/* Drag handle — span rather than SVG (icon) so it can be focusable and gives a reliable pointer-event target */}
        <span
          ref={handleRef}
          className="cursor-grab active:cursor-grabbing touch-none shrink-0"
          aria-label={`Drag to reorder ${label}`}
        >
          <GripVertical
            size={16}
            className="text-border hover:text-secondary active:text-primary"
          />
        </span>

        <span className="flex-1 text-sm font-medium text-heading truncate">
          {layer.type ?? `Layer ${index + 1}`}
          {layer.subtype && (
            <span className="text-xs font-normal text-foreground/60 ml-1">- {layer.subtype}</span>
          )}
        </span>

        {/* Visibility toggle */}
        <button
          type="button"
          onClick={() => onSettingChange(index, 'visible', !settings.visible)}
          className="button button-icon shrink-0"
          aria-label={`${settings.visible ? 'Hide' : 'Show'} ${label}`}
          title={`${settings.visible ? 'Hide' : 'Show'} ${label}`}
          aria-pressed={settings.visible}
        >
          {settings.visible ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>

        {/* Expand/collapse toggle */}
        <button
          type="button"
          onClick={onToggleExpand}
          className="button button-icon"
          title={isExpanded ? `Collapse ${label} controls` : `Expand ${label} controls`}
          aria-label={isExpanded ? `Collapse ${label} controls` : `Expand ${label} controls`}
          aria-expanded={isExpanded}
        >
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Expanded controls — always rendered so the row track has a natural height to animate to.
          Toggling the single grid row between 0fr and 1fr smoothly grows/shrinks it from 0 to that
          height; overflow-hidden on the child clips the content while the row is collapsing. */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${
          isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
        aria-hidden={!isExpanded}
      >
        <div className="overflow-hidden">
          <div className="border-t border-border px-3 py-1.5 flex flex-col gap-1.5 text-xs">
            {/* Opacity */}
            <div className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-foreground select-none pointer-events-none">
                Opacity
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(settings.opacity * 100)}
                onChange={handleOpacityChange}
                className="flex-1 min-w-0 cursor-pointer"
                aria-label={`${label} opacity slider`}
              />
              <div className="flex items-center">
                <input
                  type="number"
                  value={opacityStr}
                  min={0}
                  max={100}
                  step={1}
                  style={{ width: 'calc(3ch + 1.5rem)' }}
                  onChange={handleOpacityChange}
                  onBlur={() => commitOpacity(opacityStr)}
                  className="text-center border border-border rounded px-1 py-0.5 text-xs bg-background text-foreground [appearance:textfield]"
                  aria-label={`${label} opacity`}
                />
                <span className="text-foreground pl-0.5 select-none pointer-events-none">%</span>
              </div>
            </div>

            {/* Threshold — meaningful for image volumes and the ESI layer (in either mode,
                since it colors its mesh from these same fractions), but not for the
                intracranial electrode connectome, which has no user-adjustable range. */}
            {(!isConnectome || isEsiLayer) && (
              <div className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-foreground select-none pointer-events-none">
                  Threshold
                </span>
                <div className="flex items-center">
                  <input
                    type="number"
                    value={calMinStr}
                    min={0}
                    max={100}
                    step={1}
                    style={{ width: 'calc(3ch + 1.5rem)' }}
                    onChange={handleCalMinChange}
                    onBlur={() => commitCalMin(calMinStr)}
                    className="text-center border border-border rounded px-1 py-0.5 text-xs bg-background text-foreground [appearance:textfield]"
                    aria-label={`${label} Threshold minimum`}
                  />
                  <span className="text-foreground pl-0.5 select-none pointer-events-none">%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.round(settings.cal_max * 100)}
                  step={1}
                  value={Math.round(settings.cal_min * 100)}
                  onChange={handleCalMinChange}
                  className="flex-1 min-w-0 cursor-pointer"
                  aria-label={`${label} Threshold minimum slider`}
                />
                <input
                  type="range"
                  min={Math.round(settings.cal_min * 100)}
                  max={100}
                  step={1}
                  value={Math.round(settings.cal_max * 100)}
                  onChange={handleCalMaxChange}
                  className="flex-1 min-w-0 cursor-pointer"
                  aria-label={`${label} Threshold maximum slider`}
                />
                <div className="flex items-center">
                  <input
                    type="number"
                    value={calMaxStr}
                    min={0}
                    max={100}
                    step={1}
                    style={{ width: 'calc(3ch + 1.5rem)' }}
                    onChange={handleCalMaxChange}
                    onBlur={() => commitCalMax(calMaxStr)}
                    className="text-center border border-border rounded px-1 py-0.5 text-xs bg-background text-foreground [appearance:textfield]"
                    aria-label={`${label} Threshold maximum`}
                  />
                  <span className="text-foreground pl-0.5 select-none pointer-events-none">%</span>
                </div>
              </div>
            )}

            {/* Colormap — not applicable to connectome layers, which colour themselves
                via baked-in node/edge colormaps rather than a NiiVue volume colormap */}
            {!isConnectome && (
              <div className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-foreground select-none pointer-events-none">
                  Colormap
                </span>
                <select
                  value={settings.colormap}
                  onChange={(e) => onSettingChange(index, 'colormap', e.target.value)}
                  className="flex-1 min-w-0 bg-surface border border-border rounded px-2 py-0.5 text-xs text-heading cursor-pointer"
                  aria-label={`${label} colormap`}
                >
                  {COLORMAP_OPTIONS.map(({ value, label: optionLabel }) => (
                    <option key={value} value={value}>
                      {optionLabel}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex flex-row">
              {isEsiLayer && (
                <div className="w-1/2 flex items-center gap-2.5">
                  <span className="text-foreground select-none pointer-events-none">Volume</span>
                  <ToggleSwitch
                    checked={settings.isEsiVolume}
                    onChange={(value) => onSettingChange(index, 'isEsiVolume', value)}
                    aria-label={`Show ${label} as volume`}
                    title={`Show ${label} as volume`}
                  />
                </div>
              )}
              {/* Invert / Show colorbar — also not applicable to connectome layers */}
              {!isConnectome && (
                <>
                  <div className="w-1/2 flex items-center gap-2.5">
                    <span className="text-foreground select-none pointer-events-none">Invert</span>
                    <ToggleSwitch
                      checked={settings.invert}
                      onChange={(value) => onSettingChange(index, 'invert', value)}
                      aria-label={`Invert ${label} colormap`}
                      title={`Invert ${label} colormap`}
                    />
                  </div>

                  <div className="w-1/2 flex items-center gap-2.5">
                    <span className="text-foreground select-none pointer-events-none">
                      Colorbar
                    </span>
                    <ToggleSwitch
                      checked={settings.showColorbar}
                      onChange={(value) => onSettingChange(index, 'showColorbar', value)}
                      aria-label={`Show ${label} colorbar`}
                      title={`Show ${label} colorbar`}
                    />
                  </div>
                </>
              )}
              {/* Delete layer button */}
              <div className="flex items-center gap-2.5 ml-auto">
                {/* ml-auto pushes the close button to the right edge */}
                <button
                  className="text-foreground hover:text-alert cursor-pointer"
                  type="button"
                  onClick={() => onDeleteLayer(index)}
                  aria-label={`Close ${label} volume`}
                  title={`Close ${label} volume`}
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const ImagingControls = ({
  layers,
  layerSettings,
  onSettingChange,
  onReorder,
  onDeleteLayer,
}) => {
  // Track the expanded card by URL so the expanded state survives reordering
  const [expandedUrl, setExpandedUrl] = useState(null); // only one card can be expanded at a time, so this is either a URL or null

  return (
    // onDragEnd fires when the user releases a drag; we forward it to onReorder (a callback prop from NiiViewer) so the parent can update layer order state and reload NiiVue
    <DragDropProvider onDragEnd={onReorder}>
      <div className="flex flex-col gap-1 py-1 px-1">
        {layers.map((layer, index) => (
          <SortableSettingsCard
            key={layer.url}
            layer={layer}
            index={index}
            settings={layerSettings[index]}
            isExpanded={expandedUrl === layer.url}
            onToggleExpand={() => setExpandedUrl(expandedUrl === layer.url ? null : layer.url)}
            onSettingChange={onSettingChange}
            onDeleteLayer={onDeleteLayer}
          />
        ))}
      </div>
    </DragDropProvider>
  );
};
