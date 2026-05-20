import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

export const FileDropZone = ({ onFiles, accepted_formats, label, description }) => {
  const inputRef = useRef(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = () => setIsDraggingOver(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files);
  };

  const handleInputChange = (e) => {
    if (e.target.files.length > 0) onFiles(e.target.files);
  };

  return (
    <div
      className={cn(
        'flex-1 flex flex-col items-center justify-center gap-3 m-2 rounded-lg',
        'border-2 cursor-pointer transition-colors',
        'group', // for linking hover styles to children (=<Upload> icon)
        isDraggingOver ? 'border-solid border-primary bg-primary/10' : 'border-dashed border-border hover:border-primary/70 bg-surface'
      )}
      onClick={() => inputRef.current?.click()} // Trigger file dialog on click in the <input> element below. (?.) is to safely do nothing if inputRef.current is null (e.g., before the component mounts).
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Upload className="h-10 w-10 text-foreground/50 group-hover:text-primary/80 transition-colors" />
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="text-xs text-foreground/50">{description}</p>
      <p className="text-xs text-foreground/50">Drag & Drop /  Click to Browse</p>
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
