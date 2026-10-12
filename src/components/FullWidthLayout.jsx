// h-svh (not min-h-svh) is required so descendants' flex-1 min-h-0 chains resolve to a
// definite height. With only a min-height floor, content taller than the viewport makes
// this box grow with it, which makes SplitPane's row container grow too — and since flex's
// default align-items: stretch sizes siblings to match each other, one pane overflowing
// (e.g. NiiViewer's canvas resize handle) ends up stretching the other pane along with it.
// Bottom padding on touch devices only (pointer-coarse): at least 1rem, or the device's safe area if
// larger, so the bottom content stays clear of the screen edge and the home gesture area.
export const FullWidthLayout = ({ children }) => (
  <div className="w-full h-svh flex flex-col pointer-coarse:pb-[max(1rem,env(safe-area-inset-bottom))]">
    {children}
  </div>
);
