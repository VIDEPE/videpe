export const CenteredLayout = ({ children, footer }) => (
  <div className="w-full min-h-svh flex flex-col">
    <div className="w-full max-w-[1126px] mx-auto flex-1 flex flex-col box-border">{children}</div>
    {footer}
  </div>
);
