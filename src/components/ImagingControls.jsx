import { useState, useEffect } from 'react';
import * as Slider from '@radix-ui/react-slider';
import { Eye, EyeOff, ChevronDown, ChevronUp, GripVertical, Lock } from 'lucide-react';
import { DragDropProvider } from '@dnd-kit/react';
import { useSortable } from '@dnd-kit/react/sortable';
import { X } from 'lucide-react';
import { ESI_LAYER_URL, isImageVolumeLayer } from '@/utils/NiiViewer.utils';

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
  // Only image volumes are reorderable — meshes and connectomes render as 3D objects with no
  // z-order relative to the 2D slices, so reordering them has no visual effect. Disable the
  // sortable for those (and swap the grab handle for a fixed indicator below) so the card
  // doesn't advertise a drag it can't honour. They're also pinned to the bottom of the list.
  const isReorderable = isImageVolumeLayer(layer);
  const { ref, handleRef, isDragging } = useSortable({
    id: layer.url,
    index,
    disabled: !isReorderable,
  });
  // Label is either "type - subtype" (e.g. "MRI - T1") or just "type" if no subtype, or "Layer {index}" as a fallback if no type
  const label = layer.type
    ? layer.type + (layer.subtype ? ` - ${layer.subtype}` : '')
    : `Layer ${index + 1}`;
  // Connectome layers (e.g. intracranial electrodes) are colored by their own baked-in
  // node/edge colormap, not a NiiVue volume colormap — the intensity colormap dropdown,
  // invert toggle, and colorbar toggle don't apply to them.
  const isConnectome = layer.kind === 'connectome';
  // File-loaded surface meshes (GIFTI/PLY/OBJ/…) render with their own vertex colors and
  // have no NiiVue volume colormap or intensity range either, so — like connectomes — they
  // expose only opacity/visibility, not the colormap/threshold/invert/colorbar controls.
  const isMesh = layer.kind === 'mesh';
  // Image volumes have an adjustable intensity range/colormap and can be reordered;
  // connectomes and meshes don't/can't, but get their own Mesh Xray control instead.
  const isImageVolume = isImageVolumeLayer(layer);
  // ESI layers have their own toggle for ESI Volume / ESI Connectome
  const isEsiLayer = layer.url === ESI_LAYER_URL;

  // Local string state — allows typing a partial value (e.g. empty string) without breaking the numeric opacity
  const [opacityStr, setOpacityStr] = useState(() => String(Math.round(settings.opacity * 100)));

  // Typing must stay permissive: mirror the raw text as-is so partial/empty input isn't
  // clobbered mid-edit. Only forward a value upstream once it parses to a real number —
  // commitOpacity below is the backstop for the number field once it loses focus.
  const handleOpacityChange = (e) => {
    setOpacityStr(e.target.value);
    const val = Number(e.target.value);
    if (e.target.value !== '' && !isNaN(val))
      onSettingChange(index, 'opacity', Math.max(0, Math.min(100, Math.round(val))) / 100);
  };

  // Radix's Slider always yields a single valid value in range, so unlike the typing handler
  // above there's no parsing/clamping to do here.
  const handleOpacitySliderChange = ([val]) => {
    setOpacityStr(String(val));
    onSettingChange(index, 'opacity', val / 100);
  };

  // Blur-time commit: unlike the typing handler above, this always forces a valid
  // 0-100 value and snaps the display back, however invalid what's currently shown is.
  const commitOpacity = (raw) => {
    const clamped = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
    setOpacityStr(String(clamped));
    onSettingChange(index, 'opacity', clamped / 100);
  };

  // Local string state — allows typing a partial value (e.g. empty string) without breaking the numeric opacity
  const [meshXRayStr, setMeshXRayStr] = useState(() => String(Math.round(settings.meshXRay * 100)));

  // Unlike opacity/cal_min/cal_max, meshXRay maps to a single value shared across every
  // mesh/connectome layer (see handleSettingChange in NiiViewer.jsx), so this card's own
  // settings.meshXRay can change from a slider on a *different* card. The local string state
  // above is only ever written by this card's own handlers, so without this effect it would
  // silently go stale whenever another card is the one that changed the value.
  useEffect(() => {
    setMeshXRayStr(String(Math.round(settings.meshXRay * 100)));
  }, [settings.meshXRay]);

  // Typing must stay permissive: mirror the raw text as-is so partial/empty input isn't
  // clobbered mid-edit. Only forward a value upstream once it parses to a real number —
  // commitMeshXRay below is the backstop for the number field once it loses focus.
  const handleMeshXRayChange = (e) => {
    setMeshXRayStr(e.target.value);
    const val = Number(e.target.value);
    if (e.target.value !== '' && !isNaN(val))
      onSettingChange(index, 'meshXRay', Math.max(0, Math.min(100, Math.round(val))) / 100);
  };

  // Radix's Slider always yields a single valid value in range, so unlike the typing handler
  // above there's no parsing/clamping to do here.
  const handleMeshXRaySliderChange = ([val]) => {
    setMeshXRayStr(String(val));
    onSettingChange(index, 'meshXRay', val / 100);
  };

  // Blur-time commit: unlike the typing handler above, this always forces a valid
  // 0-100 value and snaps the display back, however invalid what's currently shown is.
  const commitMeshXRay = (raw) => {
    const clamped = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
    setMeshXRayStr(String(clamped));
    onSettingChange(index, 'meshXRay', clamped / 100);
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

  // Radix's Slider handles the min/max clamp itself (thumbs can't cross), so unlike the number
  // inputs above there's no manual clamping to do here — just forward both values and mirror
  // them into the display strings. Sent as a single 'cal_range' update rather than two separate
  // 'cal_min'/'cal_max' calls — NiiViewer's handleSettingChange applies each call against a
  // layerSettings snapshot taken at call time, so two synchronous calls in a row would have the
  // second one silently discard the first (see the 'cal_range' comment in NiiViewer.jsx).
  const handleThresholdSliderChange = ([min, max]) => {
    setCalMinStr(String(min));
    setCalMaxStr(String(max));
    onSettingChange(index, 'cal_range', [min / 100, max / 100]);
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
        {/* Drag handle for reorderable (image-volume) layers — span rather than SVG (icon) so
            it can be focusable and gives a reliable pointer-event target. Fixed layers
            (meshes/connectomes) show a lock instead, at the same size so cards stay aligned. */}
        {isReorderable ? (
          <span
            ref={handleRef}
            className="cursor-grab active:cursor-grabbing touch-none shrink-0"
            aria-label={`Drag to reorder ${label}`}
            title={`Drag to reorder ${label} relative to other layers`}
          >
            <GripVertical
              size={16}
              className="text-border hover:text-secondary active:text-primary"
            />
          </span>
        ) : (
          <span
            className="cursor-not-allowed touch-none shrink-0"
            aria-label={`${label} is fixed and cannot be reordered`}
            title={`${label} is fixed in place — meshes and connectomes can't be reordered`}
          >
            <Lock size={14} className="text-border" />
          </span>
        )}

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
          aria-label={`${settings.visible ? 'Hide' : 'Show'} layer: ${label}`}
          title={`${settings.visible ? 'Hide' : 'Show'} layer: ${label}`}
          aria-pressed={settings.visible}
        >
          {settings.visible ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>

        {/* Expand/collapse toggle */}
        <button
          type="button"
          onClick={onToggleExpand}
          className="button button-icon"
          title={isExpanded ? `Collapse layer: ${label}` : `Expand layer: ${label}`}
          aria-label={isExpanded ? `Collapse layer: ${label}` : `Expand layer: ${label}`}
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
            {/* Opacity — meaningful for volumes*/}
            {isImageVolume && (
              <div
                className="flex items-center gap-3"
                title="Adjust the transparency of this layer (0% = invisible, 100% = fully opaque)"
              >
                <span className="w-20 shrink-0 text-foreground select-none pointer-events-none">
                  Opacity
                </span>
                <Slider.Root
                  className="relative flex-1 min-w-0 h-4 flex touch-none select-none items-center"
                  min={0}
                  max={100}
                  step={1}
                  value={[Math.round(settings.opacity * 100)]}
                  onValueChange={handleOpacitySliderChange}
                >
                  <Slider.Track className="relative h-1 grow rounded bg-border">
                    <Slider.Range className="absolute h-full rounded bg-primary" />
                  </Slider.Track>
                  <Slider.Thumb
                    className="block h-3 w-3 rounded-full bg-primary cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50"
                    aria-label={`${label} opacity slider`}
                  />
                </Slider.Root>
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
            )}

            {/* MeshXRay — meaningful for mesh and commectomes */}
            {!isImageVolume && (
              <div
                className="flex items-center gap-3 whitespace-pre-wrap"
                title={
                  'Adjust the transparency of all meshes/connectomes so structures behind it can show through\n(Note this global setting applies to all meshes/connectomes)'
                }
              >
                <span className="w-20 shrink-0 text-foreground select-none pointer-events-none">
                  Mesh Xray
                </span>
                <Slider.Root
                  className="relative flex-1 min-w-0 h-4 flex touch-none select-none items-center"
                  min={0}
                  max={100}
                  step={1}
                  value={[Math.round(settings.meshXRay * 100)]}
                  onValueChange={handleMeshXRaySliderChange}
                >
                  <Slider.Track className="relative h-1 grow rounded bg-border">
                    <Slider.Range className="absolute h-full rounded bg-primary" />
                  </Slider.Track>
                  <Slider.Thumb
                    className="block h-3 w-3 rounded-full bg-primary cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50"
                    aria-label={`${label} meshXRay slider`}
                  />
                </Slider.Root>
                <div className="flex items-center">
                  <input
                    type="number"
                    value={meshXRayStr}
                    min={0}
                    max={100}
                    step={1}
                    style={{ width: 'calc(3ch + 1.5rem)' }}
                    onChange={handleMeshXRayChange}
                    onBlur={() => commitMeshXRay(meshXRayStr)}
                    className="text-center border border-border rounded px-1 py-0.5 text-xs bg-background text-foreground [appearance:textfield]"
                    aria-label={`${label} meshXRay`}
                  />
                  <span className="text-foreground pl-0.5 select-none pointer-events-none">%</span>
                </div>
              </div>
            )}

            {/* Threshold — meaningful for image volumes and the ESI layer (in either mode,
                since it colors its mesh from these same fractions), but not for the
                intracranial electrode connectome or file-loaded meshes, which have no
                user-adjustable range. */}
            {(isImageVolume || isEsiLayer) && (
              <div
                className="flex items-center gap-3"
                title="Set the minimum and maximum intensity values that get colored — values below are hidden, above get capped"
              >
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
                <Slider.Root
                  className="relative flex-1 min-w-0 h-4 flex touch-none select-none items-center"
                  min={0}
                  max={100}
                  step={1}
                  value={[Math.round(settings.cal_min * 100), Math.round(settings.cal_max * 100)]}
                  onValueChange={handleThresholdSliderChange}
                >
                  <Slider.Track className="relative h-1 grow rounded bg-border">
                    <Slider.Range className="absolute h-full rounded bg-primary" />
                  </Slider.Track>
                  <Slider.Thumb
                    className="block h-3 w-3 rounded-full bg-primary cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50"
                    aria-label={`${label} Threshold minimum slider`}
                  />
                  <Slider.Thumb
                    className="block h-3 w-3 rounded-full bg-primary cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50"
                    aria-label={`${label} Threshold maximum slider`}
                  />
                </Slider.Root>
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

            {/* Colormap — not applicable to connectome or mesh layers, which colour themselves
                via baked-in node/edge/vertex colors rather than a NiiVue volume colormap */}
            {isImageVolume && (
              <div
                className="flex items-center gap-3"
                title="Choose the color scheme for this layer"
              >
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
                <div
                  className="w-1/2 flex items-center gap-2.5"
                  title="Switch this ESI layer between a 3D volume rendering and a connectome rendering"
                >
                  <span className="text-foreground select-none pointer-events-none">Volume</span>
                  <ToggleSwitch
                    checked={settings.isEsiVolume}
                    onChange={(value) => onSettingChange(index, 'isEsiVolume', value)}
                    aria-label={`Show ${label} as volume`}
                    title="Switch this ESI layer between a 3D volume rendering and a connectome rendering"
                  />
                </div>
              )}
              {/* Invert / Show colorbar — also not applicable to connectome or mesh layers */}
              {isImageVolume && (
                <>
                  <div
                    className="w-1/2 flex items-center gap-2.5"
                    title="Flip the colormap direction, reversing which color represents high vs. low intensity"
                  >
                    <span className="text-foreground select-none pointer-events-none">Invert</span>
                    <ToggleSwitch
                      checked={settings.invert}
                      onChange={(value) => onSettingChange(index, 'invert', value)}
                      aria-label={`Invert ${label} colormap`}
                      title="Flip the colormap direction, reversing which color represents high vs. low intensity"
                    />
                  </div>

                  <div
                    className="w-1/2 flex items-center gap-2.5"
                    title="Show or hide the color scale legend for this layer"
                  >
                    <span className="text-foreground select-none pointer-events-none">
                      Colorbar
                    </span>
                    <ToggleSwitch
                      checked={settings.showColorbar}
                      onChange={(value) => onSettingChange(index, 'showColorbar', value)}
                      aria-label={`Show ${label} colorbar`}
                      title="Show or hide the color scale legend for this layer"
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
                  aria-label={`Close layer: ${label}`}
                  title={`Close layer: ${label}`}
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
