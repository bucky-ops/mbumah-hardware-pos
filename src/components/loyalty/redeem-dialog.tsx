'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Gift,
  HandCoins,
  CheckCircle2,
  Loader2,
  Sparkles,
  Info,
} from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';

import {
  MIN_REDEMPTION_POINTS,
  REDEMPTION_RATE_KES_PER_100_POINTS,
  calculateRedemptionValue,
  TIER_CONFIG,
  type LoyaltyTierName,
} from '@/lib/loyalty-utils';
import { formatKES } from '@/lib/api';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface RedeemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerName: string;
  currentPoints: number;
  tier: LoyaltyTierName;
  isRedeeming?: boolean;
  onConfirm: (points: number) => Promise<void>;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RedeemDialog({
  open,
  onOpenChange,
  customerName,
  currentPoints,
  tier,
  isRedeeming = false,
  onConfirm,
}: RedeemDialogProps) {
  // Round the user's balance down to the nearest 100 — they can only redeem
  // in multiples of 100 points (the redemption unit).
  const maxRedeemable = Math.max(0, Math.floor(currentPoints / 100) * 100);
  const canRedeem = maxRedeemable >= MIN_REDEMPTION_POINTS;

  // State: number of points to redeem (always a multiple of 100).
  const [pointsInput, setPointsInput] = useState<number>(Math.min(MIN_REDEMPTION_POINTS, maxRedeemable));
  const [successResult, setSuccessResult] = useState<{
    redeemedPoints: number;
    discountAmount: number;
    newBalance: number;
  } | null>(null);

  // Reset state whenever the dialog opens (or the customer balance changes).
  // Deferred via requestAnimationFrame so we don't trigger a cascading
  // re-render synchronously inside the effect (react-hooks/next rule).
  useEffect(() => {
    if (!open) return;
    const handle = requestAnimationFrame(() => {
      setSuccessResult(null);
      setPointsInput(Math.min(MIN_REDEMPTION_POINTS, maxRedeemable));
    });
    return () => cancelAnimationFrame(handle);
  }, [open, maxRedeemable]);

  // Clamp the slider value between MIN and max.
  const clampedPoints = useMemo(() => {
    if (!canRedeem) return 0;
    const rounded = Math.round(pointsInput / 100) * 100;
    return Math.max(MIN_REDEMPTION_POINTS, Math.min(rounded, maxRedeemable));
  }, [pointsInput, canRedeem, maxRedeemable]);

  const discountValue = useMemo(() => calculateRedemptionValue(clampedPoints), [clampedPoints]);
  const remainingAfter = Math.max(0, currentPoints - clampedPoints);

  // Slider works in [0, maxRedeemable] range, snapped to 100s.
  const sliderValue = canRedeem ? Math.min(clampedPoints, maxRedeemable) : 0;

  const handleConfirm = async () => {
    if (!canRedeem) {
      toast.error(`Minimum redemption is ${MIN_REDEMPTION_POINTS} points.`);
      return;
    }
    try {
      // The parent handles the actual API call (so it can invalidate its own
      // query cache). We just surface a success state once it resolves.
      const before = currentPoints;
      await onConfirm(clampedPoints);
      setSuccessResult({
        redeemedPoints: clampedPoints,
        discountAmount: discountValue,
        newBalance: Math.max(0, before - clampedPoints),
      });
    } catch {
      // Parent surfaces the toast; nothing to do here.
    }
  };

  const tierCfg = TIER_CONFIG[tier];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-amber-500" />
            Redeem Loyalty Points
          </DialogTitle>
          <DialogDescription>
            Convert <span className="font-semibold text-foreground">{customerName}</span>'s
            points into a discount voucher.
          </DialogDescription>
        </DialogHeader>

        {successResult ? (
          // ── Success state ──
          <div className="space-y-4 py-2">
            <div className="flex flex-col items-center text-center gap-2 py-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-lg font-bold text-green-700 dark:text-green-400">
                Redemption Successful!
              </h3>
              <p className="text-sm text-muted-foreground">
                Redeemed <span className="font-semibold text-foreground">{successResult.redeemedPoints.toLocaleString()}</span> points for a{' '}
                <span className="font-semibold text-foreground">{formatKES(successResult.discountAmount)}</span> discount.
              </p>
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  New Balance
                </div>
                <div className="text-xl font-bold tabular-nums">
                  {successResult.newBalance.toLocaleString()}
                </div>
                <div className="text-[10px] text-muted-foreground">points</div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Discount Value
                </div>
                <div className="text-xl font-bold tabular-nums text-green-600 dark:text-green-400">
                  {formatKES(successResult.discountAmount)}
                </div>
                <div className="text-[10px] text-muted-foreground">applied at checkout</div>
              </div>
            </div>
          </div>
        ) : (
          // ── Redemption form ──
          <div className="space-y-5 py-1">
            {/* ── Available points banner ── */}
            <div className={`rounded-lg bg-gradient-to-br ${tierCfg.gradient} p-4 text-white`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-wider opacity-90">
                    Available Points
                  </div>
                  <div className="text-3xl font-extrabold tabular-nums">
                    {currentPoints.toLocaleString()}
                  </div>
                </div>
                <div className="text-right">
                  <Badge className="bg-white/20 text-white border-0 backdrop-blur-sm">
                    {tierCfg.name}
                  </Badge>
                  <div className="text-xs opacity-90 mt-1.5">
                    ≈ {formatKES((currentPoints / 100) * REDEMPTION_RATE_KES_PER_100_POINTS)}
                  </div>
                </div>
              </div>
            </div>

            {!canRedeem ? (
              <div className="rounded-lg border border-dashed bg-amber-50 dark:bg-amber-950/20 p-4 text-center space-y-1">
                <Info className="mx-auto h-5 w-5 text-amber-500" />
                <p className="text-sm font-medium">Not enough points yet</p>
                <p className="text-xs text-muted-foreground">
                  Minimum redemption is <span className="font-semibold">{MIN_REDEMPTION_POINTS} points</span>{' '}
                  ({formatKES(REDEMPTION_RATE_KES_PER_100_POINTS)}). Earn{' '}
                  <span className="font-semibold text-foreground">
                    {(MIN_REDEMPTION_POINTS - currentPoints).toLocaleString()}
                  </span>{' '}
                  more points to unlock redemption.
                </p>
              </div>
            ) : (
              <>
                {/* ── Slider ── */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="loyalty-slider" className="text-xs uppercase tracking-wide text-muted-foreground">
                      Points to Redeem
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      Min: {MIN_REDEMPTION_POINTS} · Max: {maxRedeemable.toLocaleString()}
                    </span>
                  </div>
                  <Slider
                    id="loyalty-slider"
                    min={MIN_REDEMPTION_POINTS}
                    max={maxRedeemable}
                    step={100}
                    value={[sliderValue]}
                    onValueChange={(val) => setPointsInput(val[0] ?? MIN_REDEMPTION_POINTS)}
                    className="py-2"
                  />
                </div>

                {/* ── Manual input ── */}
                <div className="space-y-1.5">
                  <Label htmlFor="loyalty-points-input" className="text-xs text-muted-foreground">
                    Or enter exact points (multiple of 100)
                  </Label>
                  <Input
                    id="loyalty-points-input"
                    type="number"
                    min={MIN_REDEMPTION_POINTS}
                    max={maxRedeemable}
                    step={100}
                    value={clampedPoints}
                    onChange={(e) => {
                      const v = parseInt(e.target.value || '0', 10);
                      setPointsInput(Number.isFinite(v) ? v : 0);
                    }}
                    className="tabular-nums"
                  />
                </div>

                {/* ── Real-time discount summary ── */}
                <div className="rounded-lg border bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <HandCoins className="h-3.5 w-3.5" /> Redeeming
                    </span>
                    <span className="text-sm font-semibold tabular-nums">
                      {clampedPoints.toLocaleString()} pts
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Discount Value</span>
                    <span className="text-lg font-bold text-green-700 dark:text-green-400 tabular-nums">
                      {formatKES(discountValue)}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Balance After</span>
                    <span className="text-sm font-medium tabular-nums">
                      {remainingAfter.toLocaleString()} pts
                    </span>
                  </div>
                </div>

                {/* ── Quick-select chips ── */}
                <div className="flex flex-wrap gap-2">
                  {[100, 500, 1000].map((preset) =>
                    preset <= maxRedeemable ? (
                      <Button
                        key={preset}
                        type="button"
                        variant={clampedPoints === preset ? 'default' : 'outline'}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setPointsInput(preset)}
                      >
                        {preset} pts
                      </Button>
                    ) : null,
                  )}
                  {maxRedeemable >= MIN_REDEMPTION_POINTS && maxRedeemable > 0 && (
                    <Button
                      type="button"
                      variant={clampedPoints === maxRedeemable ? 'default' : 'outline'}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setPointsInput(maxRedeemable)}
                    >
                      Max ({maxRedeemable.toLocaleString()})
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {successResult ? (
            <Button
              onClick={() => onOpenChange(false)}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" /> Done
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isRedeeming}>
                Cancel
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={!canRedeem || isRedeeming}
                className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
              >
                {isRedeeming ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Redeeming...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" /> Redeem {clampedPoints > 0 ? `${clampedPoints.toLocaleString()} pts` : ''}
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
