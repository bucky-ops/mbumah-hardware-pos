'use client';

/**
 * ProductImageUpload — file picker + preview + drag-drop for product photos.
 *
 * Converts the selected image to a base64 data URL (resized to max 600x600 to
 * keep payload small) and stores it in the parent form's `imageUrl` field.
 * Also allows manual URL entry as a fallback.
 *
 * No external storage (S3/Vercel Blob) required — the data URL is stored
 * directly in the Product.imageUrl column.
 */

import React, { useRef, useState, useCallback } from 'react';
import { Upload, X, Image as ImageIcon, Link2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface ProductImageUploadProps {
  value: string;
  onChange: (value: string) => void;
  productName?: string;
}

const MAX_DIMENSION = 600;
const JPEG_QUALITY = 0.8;

export function ProductImageUpload({ value, onChange, productName }: ProductImageUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);

  /**
   * Resize + compress the image file to a base64 JPEG data URL.
   * Keeps the payload small (typically <100KB) for DB storage.
   */
  const processFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file (PNG, JPG, WebP).');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image too large. Maximum 10MB.');
      return;
    }

    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Resize to max dimension while preserving aspect ratio
        let { width, height } = img;
        if (width > height && width > MAX_DIMENSION) {
          height = Math.round((height * MAX_DIMENSION) / width);
          width = MAX_DIMENSION;
        } else if (height > MAX_DIMENSION) {
          width = Math.round((width * MAX_DIMENSION) / height);
          height = MAX_DIMENSION;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          toast.error('Could not process image. Try a different file.');
          setIsProcessing(false);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        onChange(dataUrl);
        setIsProcessing(false);
        toast.success('Image uploaded.');
      };
      img.onerror = () => {
        toast.error('Invalid image file.');
        setIsProcessing(false);
      };
      img.src = e.target?.result as string;
    };
    reader.onerror = () => {
      toast.error('Failed to read file.');
      setIsProcessing(false);
    };
    reader.readAsDataURL(file);
  }, [onChange]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleClear = useCallback(() => {
    onChange('');
  }, [onChange]);

  return (
    <div className="space-y-2">
      <Label>Product Photo</Label>
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Preview / Drop zone */}
        <div className="shrink-0">
          {value ? (
            <div className="relative w-32 h-32 rounded-lg overflow-hidden border bg-muted/30 group">
              <img
                src={value}
                alt={productName || 'Product preview'}
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={handleClear}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                title="Remove photo"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`w-32 h-32 rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors ${
                isDragging
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30'
              }`}
            >
              {isProcessing ? (
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              ) : (
                <>
                  <Upload className="h-6 w-6 text-muted-foreground mb-1" />
                  <span className="text-[10px] text-muted-foreground text-center px-1">Click or drop</span>
                </>
              )}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/jpg"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {/* Controls */}
        <div className="flex-1 space-y-2">
          {value ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-1 min-w-0">
                <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {value.startsWith('data:')
                    ? `Embedded image (${Math.round((value.length * 0.75) / 1024)}KB)`
                    : 'URL image'}
                </span>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5 mr-1" /> Replace
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={handleClear}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Upload a product photo (PNG/JPG/WebP, max 10MB). Images are auto-resized to 600×600 for optimal storage.
            </p>
          )}

          {/* Manual URL toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowUrlInput((v) => !v)}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              <Link2 className="h-3 w-3" />
              {showUrlInput ? 'Hide URL input' : 'Or enter image URL manually'}
            </button>
            {showUrlInput && (
              <Input
                value={value.startsWith('data:') ? '' : value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="https://example.com/product.jpg"
                className="mt-1.5"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
