import { useRef, useState } from 'react';
import { Upload, FileCheck } from 'lucide-react';
import { cn } from '@/utils/utils';

export const FileDropZone = ({
  onFiles,
  accepted_formats,
  label,
  description,
  pendingFiles,
  hint,
  className,
  compact = false,
}) => {
  const inputRef = useRef(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = () => setIsDraggingOver(false);

  const handleDrop = (e) => {
    // Prevent default browser behavior (e.g., opening the file in a new tab) and reset drag state. If files are dropped, call onFiles with the FileList.
    e.preventDefault();
    // Reset drag state. (Even if no files are dropped, we want to reset the visual state of the drop zone.)
    setIsDraggingOver(false);
    // If files are dropped, call onFiles with the FileList. (e.dataTransfer.files is a FileList, which is array-like and can be used directly in onFiles.)
    if (e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files);
  };

  const handleInputChange = (e) => {
    // if files are selected, call onFiles with the FileList. (e.target.files is a FileList, which is array-like and can be used directly in onFiles.)
    if (e.target.files.length > 0) onFiles(e.target.files);
  };

  const hasPending = pendingFiles && pendingFiles.length > 0;

  return (
    <div
      className={cn(
        'border-2 cursor-pointer transition-colors group', // group for linking hover styles to children (=<Upload> icon)
        compact
          ? 'rounded-sm flex flex-row items-center justify-center gap-2 px-3 py-1.5 mx-1'
          : 'rounded-xl flex-1 flex flex-col items-center text-center justify-center gap-3 p-2',
        isDraggingOver
          ? 'border-solid border-primary bg-primary/10'
          : hasPending
            ? 'border-dashed border-alert bg-background'
            : 'border-dashed border-border hover:border-primary/70 bg-background',
        className
      )}
      onClick={() => inputRef.current?.click()} // Trigger file dialog on click in the <input> element below. (?.) is to safely do nothing if inputRef.current is null (e.g., before the component mounts).
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {compact ? (
        <>
          <Upload
            className={cn(
              'h-4 w-4 shrink-0 group-hover:text-primary transition-colors',
              isDraggingOver
                ? 'text-primary'
                : 'text-[color-mix(in_srgb,var(--c-border),var(--c-foreground)_40%)]'
            )}
          />
          {/* The label is the main instruction (e.g., "Drop additional files"). */}
          <p className="text-xs font-medium text-foreground">{label}</p>
        </>
      ) : (
        <>
          <Upload
            className={cn(
              'h-10 w-10 group-hover:text-primary transition-colors',
              isDraggingOver
                ? 'text-primary'
                : 'text-[color-mix(in_srgb,var(--c-border),var(--c-foreground)_40%)]'
            )}
          />
          {/* The label is the main instruction (e.g., "Drop EEG files"). */}
          <p className="text-sm font-medium text-foreground">{label}</p>
          {/* The description provides format details (e.g., "BrainVision: .vhdr + .eeg").*/}
          <p className="text-xs text-foreground/50">{description}</p>
          {/* If there are pending files that are not yet complete, show them here with a checkmark. */}
          {hasPending && (
            <div className="flex flex-col items-center gap-1">
              {pendingFiles.map((f) => (
                <span
                  key={f.name}
                  className="flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400"
                >
                  <FileCheck className="h-4 w-4 shrink-0" />
                  {f.name}
                </span>
              ))}
            </div>
          )}
          {/* The hint is only shown when there are pending files that are not yet complete, providing specific feedback on what's missing. */}
          {hint && (
            <p className="text-xs text-alert font-bold text-center px-4 whitespace-pre-line">
              {hint}
            </p>
          )}
          <p className="text-xs text-foreground/50">Drag & Drop / Click to Browse</p>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accepted_formats}
        className="hidden"
        onChange={handleInputChange}
      />
    </div>
  );
};
