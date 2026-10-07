'use client';

import { useRef, useState } from 'react';
import { QrCode, Download, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QRCodeCanvas } from 'qrcode.react';

// v2.8.0 SCANNING FIX: this component used to draw a HASH-BASED lookalike
// grid (generateQrPattern) that a phone could NEVER scan — KRA eTIMS invoice
// cards "displayed" a QR that wasn't one. It now renders a REAL QR code
// (qrcode.react — the same library as the working receipt QR) encoding the
// actual KRA verification payload, so "scan to verify" genuinely works.

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
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(data);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  };

  // Export the REAL rendered QR canvas as a PNG (replaces the old fake-SVG
  // download — the PNG is scannable too).
  const handleDownload = () => {
    const wrap = canvasWrapRef.current;
    const canvas = wrap?.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `qr-${invoiceNumber || 'code'}.png`;
    a.click();
  };

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <div className="relative bg-white p-2 rounded-lg border-2 border-emerald-500/20 shadow-sm">
        <div ref={canvasWrapRef} aria-label="eTIMS QR code" role="img">
          {/* Real, scannable QR of the KRA payload (high error correction so
              it survives label printers and crumpled paper). */}
          <QRCodeCanvas
            value={data || ' '}
            size={size}
            level="H"
            includeMargin={false}
            bgColor="#ffffff"
            fgColor="#0f172a"
          />
        </div>
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
            PNG
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
