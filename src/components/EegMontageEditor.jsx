import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { TrafficLightButtons } from './TrafficLightButtons';
import {} from '@/utils/eegViewerUtils';
import { EyeDashed } from 'lucide-react';
import { cn } from '@/utils/utils';

// ─── EEG Montage settings ────────────────────────────────────────

// ─── Window sizing constants ────────────────────────────────────────────────

// Default/minimum window size in px — default matches the previous fixed w-96 h-80 (24rem x 20rem)
const DEFAULT_WINDOW_SIZE = { width: 1000, height: 800 };
const MIN_WINDOW_WIDTH = 600;
const MIN_WINDOW_HEIGHT = 450;
const RESIZE_DIRECTIONS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

export function EegMontageEditor({
  electrodes,
  matched,
  voltages,
  totalChannels,
  onClose,
  isStandardElectrodes = true,
  onElecPosFile,
  channelNames,
  voltagesByChannel,
  customFileName = null, // filename (no extension) of the loaded custom positions file — owned by PatientView, passed down
  montage,
}) {
  // ─── Refs ───────────────────────────────────────────────────────────────────
  const fileInputRef = useRef(null);
  const dragOffset = useRef(null);

  // ─── State ──────────────────────────────────────────────────────────────────
  const [isMaximized, setIsMaximized] = useState(false);
  const [position, setPosition] = useState({ x: 80, y: 80 });
  const [size, setSize] = useState(DEFAULT_WINDOW_SIZE);
  const [isApplied, setIsApplied] = useState(false);
  const [isChanged, setIsChanged] = useState(false);

  // ─── Handlers: window drag/resize ──────────────────────────────────────────────
  // Drag the floating window by its title bar. Position is clamped to the viewport so the
  // window (and its title bar drag handle) can never be dragged out of view and get stranded.
  const handleDragStart = useCallback(
    (e) => {
      dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y };
      const onMove = (e) => {
        const maxX = Math.max(0, window.innerWidth - size.width);
        const maxY = Math.max(0, window.innerHeight - size.height);
        setPosition({
          x: Math.min(Math.max(e.clientX - dragOffset.current.x, 0), maxX),
          y: Math.min(Math.max(e.clientY - dragOffset.current.y, 0), maxY),
        });
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [position, size]
  );

  // Resize the floating window by dragging an edge or corner. direction is a combination of
  // 'n'/'s'/'e'/'w' identifying which edges move; dragging n/w also shifts position so the
  // opposite edge stays anchored in place, matching how OS window resizing behaves.
  const handleResizeStart = useCallback(
    (e, direction) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = size.width;
      const startHeight = size.height;
      const startPosition = position;

      const onMove = (e) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const nextSize = { width: startWidth, height: startHeight };
        const nextPosition = { ...startPosition };

        if (direction.includes('e')) nextSize.width = Math.max(MIN_WINDOW_WIDTH, startWidth + dx);
        if (direction.includes('s'))
          nextSize.height = Math.max(MIN_WINDOW_HEIGHT, startHeight + dy);
        if (direction.includes('w')) {
          nextSize.width = Math.max(MIN_WINDOW_WIDTH, startWidth - dx);
          nextPosition.x = startPosition.x + (startWidth - nextSize.width);
        }
        if (direction.includes('n')) {
          nextSize.height = Math.max(MIN_WINDOW_HEIGHT, startHeight - dy);
          nextPosition.y = startPosition.y + (startHeight - nextSize.height);
        }

        setSize(nextSize);
        setPosition(nextPosition);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [size, position]
  );

  // ─── Render helpers ─────────────────────────────────────────────────────────
  const resizeCursor = {
    n: 'cursor-ns-resize',
    s: 'cursor-ns-resize',
    e: 'cursor-ew-resize',
    w: 'cursor-ew-resize',
    ne: 'cursor-nesw-resize',
    sw: 'cursor-nesw-resize',
    nw: 'cursor-nwse-resize',
    se: 'cursor-nwse-resize',
  };

  // Edge handles run the full length of their side; corner handles are small squares
  // layered on top so diagonal resizing takes priority right at the corners.
  const resizePosition = {
    n: 'inset-x-0 top-0 h-1.5',
    s: 'inset-x-0 bottom-0 h-1.5',
    e: 'inset-y-0 right-0 w-1.5',
    w: 'inset-y-0 left-0 w-1.5',
    ne: 'top-0 right-0 w-2.5 h-2.5',
    nw: 'top-0 left-0 w-2.5 h-2.5',
    se: 'bottom-0 right-0 w-2.5 h-2.5',
    sw: 'bottom-0 left-0 w-2.5 h-2.5',
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className={
        isMaximized
          ? 'fixed inset-0 z-50 flex flex-col bg-surface'
          : 'fixed z-50 flex flex-col rounded-lg border border-border bg-surface'
      }
      style={
        isMaximized
          ? { boxShadow: 'none' }
          : {
              left: position.x,
              top: position.y,
              width: size.width,
              height: size.height,
              boxShadow: 'var(--c-shadow)',
            }
      }
    >
      {/* Title bar — drag handle; explicit bg-surface so NiiVue's black canvas doesn't bleed through */}
      <div
        data-testid="montage-title-bar"
        className="flex items-center justify-between px-2 py-1 border-b border-border cursor-grab select-none shrink-0 bg-surface"
        onMouseDown={handleDragStart}
      >
        <span className="text-sm font-medium text-heading">
          {isChanged && !isApplied ? 'Montage Editor *' : 'Montage Editor'}
        </span>
        <TrafficLightButtons
          onMaximize={() => setIsMaximized((v) => !v)}
          isMaximized={isMaximized}
          onClose={onClose}
        />
      </div>

      {/* Resize handles — hidden while maximized since the window already fills the screen.
          Rendered last so they paint above the title/footer content and stay grabbable at the edges. */}
      {!isMaximized &&
        RESIZE_DIRECTIONS.map((direction) => (
          <div
            key={direction}
            data-testid={`topo-resize-${direction}`}
            className={`absolute ${resizePosition[direction]} ${resizeCursor[direction]}`}
            onMouseDown={(e) => handleResizeStart(e, direction)}
          />
        ))}
    </div>
  );
}
