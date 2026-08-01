'use client';

import { useState, useMemo } from 'react';
import { QrCode, Download, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { generateQrPattern } from '@/lib/etims-utils';

interface QrCodeDisplayProps {
  data: string;
  size?: number;
  downloadable?: boolean;
  invoiceNumber?: string;
  className?: string;
}

export function QrCodeDisplay({
  data,
  size = 120,
  downloadable = true,
  invoiceNumber,
  className = '',
}: QrCodeDisplayProps) {
  const [copied, setCopied] = useState(false);

  const pattern = useMemo(() => generateQrPattern(data, 21), [data]);
  const moduleSize = size / 21;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(data);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  };

  const handleDownload = () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" fill="white"/>
      ${pattern
        .flatMap((row, r) =>
          row.map((cell, c) =>
            cell
              ? `<rect x="${c * moduleSize}" y="${r * moduleSize}" width="${moduleSize}" height="${moduleSize}" fill="black"/>`
              : ''
          )
        )
        .join('')}
    </svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qr-${invoiceNumber || 'code'}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <div className="relative bg-white p-2 rounded-lg border-2 border-emerald-500/20 shadow-sm">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="block"
          role="img"
          aria-label="eTIMS QR code"
        >
          <rect width={size} height={size} fill="white" />
          {pattern.map((row, r) =>
            row.map((cell, c) =>
              cell ? (
                <rect
                  key={`${r}-${c}`}
                  x={c * moduleSize}
                  y={r * moduleSize}
                  width={moduleSize}
                  height={moduleSize}
                  fill="#0f172a"
                />
              ) : null
            )
          )}
        </svg>
        <div className="absolute -top-1 -right-1 bg-emerald-500 text-white rounded-full p-0.5 shadow">
          <QrCode className="h-3 w-3" />
        </div>
      </div>
      {invoiceNumber && (
        <div className="text-xs font-mono text-muted-foreground text-center break-all max-w-[140px]">
          {invoiceNumber}
        </div>
      )}
      {downloadable && (
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={handleDownload}
          >
            <Download className="h-3 w-3 mr-1" />
            SVG
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={handleCopy}
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 mr-1 text-emerald-600" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3 mr-1" />
                Copy
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
