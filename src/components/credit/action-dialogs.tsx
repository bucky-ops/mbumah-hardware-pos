// Path: src/components/credit/action-dialogs.tsx
// Transaction dialogs: RecordPaymentDialog (with live waterfall preview)
// and NewSaleDialog (VAT breakdown + verdict override flow).

'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Info, Plus, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { creditApi, fmtDate, kes, previewWaterfall, type Customer360, type OperatorInfo } from '@/lib/credit-client'
import { cn } from '@/lib/utils'

interface DialogProps {
  data: Customer360
  operator: OperatorInfo
  onClose: () => void
  onDone: () => void
}

// ─────────────────────────── Record payment ────────────────────────────────

export function RecordPaymentDialog({ data, operator, onClose, onDone }: DialogProps) {
  const [amount, setAmount] = useState(String(data.assessment.outstanding))
  const [method, setMethod] = useState('MPESA')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const parsed = Number(amount)
  const valid = Number.isFinite(parsed) && parsed > 0
  const preview = useMemo(
    () => (valid ? previewWaterfall(data.invoices, parsed) : { slices: [], applied: 0, exceeds: 0 }),
    [data.invoices, parsed, valid],
  )
  const overpay = valid && preview.exceeds > 0

  const submit = async () => {
    setBusy(true)
    try {
      const r = await creditApi.repay(data.customer.id, {
        amount: parsed,
        method,
        reference,
        note,
        operatorId: operator.id,
        allowOverpay: false,
      })
      toast.success('Payment recorded', {
        description: r.message,
      })
      onDone()
    } catch (e) {
      toast.error('Payment failed', {
        description: e instanceof Error ? e.message : 'Unknown error',
      })
    } finally {
      setBusy(false)
    }
  }

  const oldestOverdue = data.invoices
    .filter((i) => i.overdue && i.balance > 0)
    .sort((x, y) => new Date(x.dueDate).getTime() - new Date(y.dueDate).getTime())[0]

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[96vw]! max-w-[560px]!">
        <DialogHeader>
          <DialogTitle>Record payment — {data.customer.name}</DialogTitle>
          <DialogDescription>
            Funds allocate automatically to the OLDEST due invoice first (waterfall). Total
            outstanding: <strong>{kes(data.assessment.outstanding)}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Amount (KES)</Label>
              <Input
                id="pay-amount"
                type="number"
                min="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={!valid}
              />
              <div className="flex flex-wrap gap-1 pt-1">
                {oldestOverdue && (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setAmount(String(oldestOverdue.balance))}>
                    Overdue {kes(oldestOverdue.balance)}
                  </Button>
                )}
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setAmount(String(data.assessment.outstanding))}>
                  Full balance
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-method">Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger id="pay-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MPESA">M-Pesa</SelectItem>
                  <SelectItem value="CASH">Cash</SelectItem>
                  <SelectItem value="BANK">Bank transfer</SelectItem>
                  <SelectItem value="CHEQUE">Cheque</SelectItem>
                </SelectContent>
              </Select>
              <div className="space-y-1.5 pt-1">
                <Label htmlFor="pay-ref">Reference (optional)</Label>
                <Input
                  id="pay-ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="M-Pesa code / cheque no."
                  maxLength={60}
                />
              </div>
            </div>
          </div>

          {/* Waterfall preview */}
          <div className="rounded-lg border bg-slate-50 p-3 dark:bg-slate-900">
            <p className="mb-2 flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              <Info className="h-3.5 w-3.5" aria-hidden /> Waterfall allocation preview
            </p>
            {preview.slices.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Enter an amount to preview allocation.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-left uppercase text-muted-foreground">
                  <tr>
                    <th className="pb-1">Invoice</th>
                    <th className="pb-1">Due</th>
                    <th className="pb-1 text-right">Applied</th>
                    <th className="pb-1 text-right">Balance after</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slices.map((s) => (
                    <tr key={s.number} className="border-t">
                      <td className="py-1.5 font-medium">{s.number}</td>
                      <td className="py-1.5 text-muted-foreground">{fmtDate(s.dueDate)}</td>
                      <td className="py-1.5 text-right font-semibold tabular-nums">{kes(s.applied)}</td>
                      <td className="py-1.5 text-right tabular-nums">{kes(s.balanceAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {overpay && (
              <p className="mt-2 flex items-start gap-1 text-xs font-semibold text-rose-600">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Amount exceeds total debt by {kes(preview.exceeds)} — reduce it to proceed.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pay-note">Note (optional)</Label>
            <Textarea id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!valid || overpay || busy || preview.slices.length === 0}
              onClick={() => void submit()}
            >
              {busy ? 'Posting…' : `Post ${kes(parsed)}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────── New credit sale ───────────────────────────────

interface Line {
  description: string
  qty: string
  unitPrice: string
}

const EMPTY_LINE: Line = { description: '', qty: '', unitPrice: '' }

export function NewSaleDialog({ data, operator, onClose, onDone }: DialogProps) {
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }])
  const [discount, setDiscount] = useState('0')
  const [termsDays, setTermsDays] = useState('30')
  const [override, setOverride] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [busy, setBusy] = useState(false)

  const blocked = data.assessment.verdict.code === 'DO_NOT_EXTEND' || data.customer.creditStatus !== 'ACTIVE'
  const canOverride = operator.role === 'OWNER' || operator.role === 'MANAGER'

  // Live VAT breakdown — mirrors the server: discount BEFORE 16% VAT.
  const subtotal = lines.reduce(
    (s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0),
    0,
  )
  const discountN = Math.min(Math.max(Number(discount) || 0, 0), subtotal)
  const taxable = subtotal - discountN
  const vat = Math.round(taxable * 0.16 * 100) / 100
  const total = Math.round((taxable + vat) * 100) / 100
  const linesValid = lines.every((l) => l.description.trim().length > 0 && Number(l.qty) > 0 && Number(l.unitPrice) >= 0)
  const headroomAfter = Math.round((data.assessment.availableCredit - total) * 100) / 100
  const exceeds = headroomAfter < 0
  const submitBlocked =
    !linesValid || total <= 0 || busy || (blocked && !(override && canOverride && overrideReason.trim().length >= 5))

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))

  const submit = async () => {
    setBusy(true)
    try {
      const r = await creditApi.createInvoice({
        customerId: data.customer.id,
        lines: lines.map((l) => ({
          description: l.description.trim(),
          qty: Number(l.qty),
          unitPrice: Number(l.unitPrice),
        })),
        discount: discountN,
        termsDays: Number(termsDays) || 30,
        operatorId: operator.id,
        override: blocked && override && canOverride,
        overrideReason: overrideReason.trim(),
      })
      toast.success(`Invoice ${r.invoice.number} issued`, { description: r.message })
      onDone()
    } catch (e) {
      toast.error('Credit sale refused', {
        description: e instanceof Error ? e.message : 'Unknown error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[96vw]! max-w-[680px]!">
        <DialogHeader>
          <DialogTitle>New credit sale — {data.customer.name}</DialogTitle>
          <DialogDescription>
            Prices are net of VAT. Discount is applied BEFORE the 16% VAT (Kenyan VAT Act
            presentation). Available credit: <strong>{kes(data.assessment.availableCredit)}</strong>
          </DialogDescription>
        </DialogHeader>

        {blocked && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm dark:border-rose-900 dark:bg-rose-950/30">
            <p className="flex items-center gap-1.5 font-bold text-rose-700 dark:text-rose-400">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              {data.assessment.verdict.dot} {data.assessment.verdict.label}
            </p>
            <p className="mt-1 text-xs text-rose-600 dark:text-rose-300">
              {data.assessment.verdict.reasons[0]}
            </p>
            {canOverride ? (
              <div className="mt-2 space-y-2">
                <label className="flex items-center gap-2 text-xs font-semibold">
                  <Checkbox checked={override} onCheckedChange={(v) => setOverride(v === true)} />
                  Override as {operator.role} (audited)
                </label>
                {override && (
                  <Input
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Documented reason for override (min 5 chars)…"
                    maxLength={300}
                  />
                )}
              </div>
            ) : (
              <p className="mt-1 text-xs font-semibold text-rose-600">
                A MANAGER or OWNER must perform the override.
              </p>
            )}
          </div>
        )}

        <div className="space-y-3">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_84px_104px_32px] items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor={`line-desc-${i}`} className="text-xs">Item {i + 1}</Label>
                <Input
                  id={`line-desc-${i}`}
                  value={l.description}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                  placeholder="e.g. Premier Cement 32.5N 50kg bag"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`line-qty-${i}`} className="text-xs">Qty</Label>
                <Input
                  id={`line-qty-${i}`}
                  type="number"
                  min="0"
                  step="1"
                  value={l.qty}
                  onChange={(e) => setLine(i, { qty: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`line-price-${i}`} className="text-xs">Unit (KES)</Label>
                <Input
                  id={`line-price-${i}`}
                  type="number"
                  min="0"
                  step="0.01"
                  value={l.unitPrice}
                  onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-rose-500"
                aria-label={`Remove line ${i + 1}`}
                disabled={lines.length === 1}
                onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLines((ls) => [...ls, { ...EMPTY_LINE }])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Add line
          </Button>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sale-discount" className="text-xs">Discount (KES, before VAT)</Label>
              <Input id="sale-discount" type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sale-terms" className="text-xs">Payment terms (days)</Label>
              <Input id="sale-terms" type="number" min="0" max="180" value={termsDays} onChange={(e) => setTermsDays(e.target.value)} />
            </div>
          </div>

          <div className="rounded-lg border bg-slate-50 p-3 text-sm dark:bg-slate-900">
            <div className="flex justify-between py-0.5">
              <span className="text-muted-foreground">Subtotal (net)</span>
              <span className="font-semibold tabular-nums">{kes(subtotal)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted-foreground">Discount</span>
              <span className={cn('tabular-nums', discountN > 0 && 'text-amber-600 font-semibold')}>
                −{kes(discountN)}
              </span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted-foreground">Taxable subtotal</span>
              <span className="tabular-nums">{kes(taxable)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted-foreground">VAT 16%</span>
              <span className="tabular-nums">{kes(vat)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t pt-1.5 text-base font-extrabold">
              <span>Grand total</span>
              <span className="tabular-nums">{kes(total)}</span>
            </div>
            <p className={cn('mt-1 text-xs', exceeds ? 'font-semibold text-rose-600' : 'text-muted-foreground')}>
              {exceeds
                ? `Exceeds available credit by ${kes(Math.abs(headroomAfter))} — reduce the order or request a limit change.`
                : `Available credit after sale: ${kes(headroomAfter)}`}
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={submitBlocked}
              onClick={() => void submit()}
            >
              {busy ? 'Issuing…' : `Issue invoice — ${kes(total)}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
