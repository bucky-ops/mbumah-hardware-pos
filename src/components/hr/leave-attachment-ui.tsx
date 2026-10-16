'use client';

// LEAVE ATTACHMENT UI (v2.42.0) — shared picker + display chip.
//
// One controlled picker serves all three filing surfaces (HR on-behalf
// dialog, HR correction window, portal self-service dialog); one chip
// serves every read surface (desk detail dialog, desk rows, portal cards).
// Styling lives here so the UX is identical everywhere: a dashed dropzone
// card while empty, a kind-coded chip once a file is chosen, kind-coded
// accents (pdf rose, image sky, link indigo) in both light and dark modes.

import { useCallback, useId, useRef, useState } from 'react';
import { FileText, Image as ImageIcon, Link2, Loader2, Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ALLOWED_LEAVE_ATTACHMENT_MIME,
  formatBytes,
  parseLeaveAttachmentMeta,
  readFileAsDataUrl,
  validateLeaveAttachmentFile,
  type LeaveAttachmentMeta,
} from '@/lib/hr/leave-attachment';

/** Human list of the accepted types, for the picker hint. */
const ACCEPT_HINT = 'PDF, PNG, JPEG or WebP · up to 500 KB';
const INPUT_ACCEPT = ALLOWED_LEAVE_ATTACHMENT_MIME.join(',');

const KIND_STYLES: Record<LeaveAttachmentMeta['kind'], { chip: string; iconClass: string }> = {
  pdf: {
    chip: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300',
    iconClass: 'text-rose-500 dark:text-rose-400',
  },
  image: {
    chip: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300',
    iconClass: 'text-sky-500 dark:text-sky-400',
  },
  link: {
    chip: 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300',
    iconClass: 'text-indigo-500 dark:text-indigo-400',
  },
};

function KindIcon({ meta, className }: { meta: LeaveAttachmentMeta; className?: string }) {
  if (meta.kind === 'pdf') return <FileText className={className} aria-hidden />;
  if (meta.kind === 'image') return <ImageIcon className={className} aria-hidden />;
  return <Link2 className={className} aria-hidden />;
}

/** Read-only chip for a stored attachmentUrl (null renders nothing). */
export function LeaveAttachmentChip({ value, className }: { value: string | null | undefined; className?: string }) {
  const meta = parseLeaveAttachmentMeta(value);
  if (!meta) return null;
  const styles = KIND_STYLES[meta.kind];
  const href = meta.kind === 'link' ? value ?? undefined : value ?? '#';
  const isDownload = meta.kind !== 'link';
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      download={isDownload ? meta.label : undefined}
      data-testid="leave-attachment-chip"
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:brightness-[0.97] dark:hover:brightness-110 ${styles.chip} ${className ?? ''}`}
      title={meta.kind === 'link' ? `Open link: ${meta.label}` : `Open attachment: ${meta.label}`}
    >
      <KindIcon meta={meta} className={`h-3.5 w-3.5 shrink-0 ${styles.iconClass}`} />
      <span className="truncate">{meta.label}</span>
      {meta.bytes !== null ? (
        <span className="shrink-0 rounded-full bg-white/60 px-1.5 text-[10px] font-semibold tabular-nums dark:bg-black/30">
          {formatBytes(meta.bytes)}
        </span>
      ) : null}
    </a>
  );
}

export interface LeaveAttachmentPickerProps {
  /** Current value: a data URL, an http(s) link, or null/'' for none. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Disable the whole picker (e.g. while the parent mutation is in flight). */
  disabled?: boolean;
  /** Test hook for the hidden file input. */
  testId?: string;
}

/**
 * Controlled attachment picker: a clickable dashed dropzone card when empty,
 * a kind-coded chip with Remove / Replace actions once a file is attached.
 * Validation runs client-side with the same rules the API enforces.
 */
export function LeaveAttachmentPicker({ value, onChange, disabled = false, testId }: LeaveAttachmentPickerProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const meta = parseLeaveAttachmentMeta(value);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError('');
      const check = validateLeaveAttachmentFile(file);
      if (!check.ok) {
        setError(check.message);
        return;
      }
      setReading(true);
      try {
        const dataUrl = await readFileAsDataUrl(file);
        onChange(dataUrl);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The file could not be read.');
      } finally {
        setReading(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [onChange],
  );

  return (
    <div className="space-y-1.5" data-testid={testId ? `${testId}-picker` : undefined}>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={INPUT_ACCEPT}
        className="sr-only"
        data-testid={testId}
        disabled={disabled || reading}
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      {!meta ? (
        <label
          htmlFor={inputId}
          className={`group flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 py-3 transition-colors ${
            disabled || reading
              ? 'cursor-not-allowed opacity-60'
              : 'hover:border-violet-400 hover:bg-violet-50/50 dark:hover:border-violet-600 dark:hover:bg-violet-950/20'
          } border-muted-foreground/30`}
        >
          {reading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-600 dark:text-violet-400" aria-hidden />
          ) : (
            <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-violet-600 dark:group-hover:text-violet-400" aria-hidden />
          )}
          <span className="min-w-0 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground/80">Attach a supporting document</span> — optional. {ACCEPT_HINT}
          </span>
        </label>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <LeaveAttachmentChip value={value} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={disabled || reading}
            onClick={() => inputRef.current?.click()}
          >
            Replace
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40"
            disabled={disabled || reading}
            onClick={() => {
              setError('');
              onChange(null);
            }}
          >
            <X className="h-3 w-3" aria-hidden /> Remove
          </Button>
        </div>
      )}

      {error ? (
        <p className="text-xs font-medium text-rose-600 dark:text-rose-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
