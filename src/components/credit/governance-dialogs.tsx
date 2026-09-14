// Path: src/components/credit/governance-dialogs.tsx
// Governance dialogs: credit-limit change (approval trail), suspend/reinstate,
// payment reminder, and new-customer registration.

'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { creditApi, kes, type Customer360, type OperatorInfo } from '@/lib/credit-client'

interface ActionProps {
  data: Customer360
  operator: OperatorInfo
  onClose: () => void
  onDone: () => void
}

// ─────────────────────────── Adjust credit limit ───────────────────────────

export function LimitDialog({ data, operator, onClose, onDone }: ActionProps) {
  const [newLimit, setNewLimit] = useState(String(data.assessment.creditLimit))
  const [reason, setReason] = useState('')
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)

  const parsed = Number(newLimit)
  const valid = Number.isFinite(parsed) && parsed >= 0 && parsed !== data.assessment.creditLimit
  const exposure = parsed < data.assessment.outstanding
  const requiresAck = exposure && !ack
  const needsApprover = operator.role !== 'OWNER' && operator.role !== 'MANAGER'

  const submit = async () => {
    setBusy(true)
    try {
      const r = await creditApi.changeLimit(data.customer.id, {
        newLimit: parsed,
        reason: reason.trim(),
        approverId: operator.id,
        acknowledgeExposure: exposure && ack,
      })
      toast.success('Limit changed', { description: r.message })
      onDone()
    } catch (e) {
      toast.error('Limit change refused', {
        description: e instanceof Error ? e.message : 'Unknown error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[96vw]! max-w-[520px]!">
        <DialogHeader>
          <DialogTitle>Adjust credit limit — {data.customer.name}</DialogTitle>
          <DialogDescription>
            Current limit <strong>{kes(data.assessment.creditLimit)}</strong>, outstanding{' '}
            <strong>{kes(data.assessment.outstanding)}</strong>. The change is recorded with your
            approval identity ({operator.role} {operator.name}).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {needsApprover && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs font-semibold text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
              Requires MANAGER or OWNER — switch the operator selector first.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="limit-value">New limit (KES)</Label>
            <Input id="limit-value" type="number" min="0" value={newLimit} onChange={(e) => setNewLimit(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="limit-reason">Reason (audit trail, min 5 chars)</Label>
            <Textarea
              id="limit-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="e.g. Verified contract pipeline; collections restructure…"
            />
          </div>
          {exposure && (
            <label className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs dark:border-rose-900 dark:bg-rose-950/30">
              <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} className="mt-0.5" />
              <span className="text-rose-700 dark:text-rose-300">
                <strong>{kes(parsed)}</strong> is below the outstanding balance{' '}
                {kes(data.assessment.outstanding)}. Acknowledge that the account will be over its
                limit and the engine will refuse all further charges.
              </span>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!valid || requiresAck || needsApprover || reason.trim().length < 5 || busy}
              onClick={() => void submit()}
            >
              {busy ? 'Approving…' : 'Approve change'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────── Suspend / reinstate ───────────────────────────

export function StatusDialog({ data, operator, onClose, onDone }: ActionProps) {
  const current = data.customer.creditStatus
  const suspending = current === 'ACTIVE'
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const target = suspending ? 'SUSPENDED' : 'ACTIVE'

  const submit = async () => {
    setBusy(true)
    try {
      const r = await creditApi.changeStatus(data.customer.id, {
        status: target,
        reason: reason.trim(),
        operatorId: operator.id,
      })
      toast.success('Credit status changed', { description: r.message })
      onDone()
    } catch (e) {
      toast.error('Status change refused', {
        description: e instanceof Error ? e.message : 'Unknown error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[96vw]! max-w-[480px]!">
        <DialogHeader>
          <DialogTitle>
            {suspending ? 'Suspend credit facility' : 'Reinstate credit facility'} — {data.customer.name}
          </DialogTitle>
          <DialogDescription>
            {suspending
              ? 'Suspended accounts are hard-blocked from all new credit sales and appear as DO NOT EXTEND CREDIT.'
              : 'Reinstating unblocks credit sales. The existing balance and score are unchanged.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="status-reason">Reason (recorded in the audit notes)</Label>
            <Textarea
              id="status-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder={suspending ? 'e.g. Bounced cheque — collections hold' : 'e.g. Arrears cleared, owner reinstatement approved'}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              variant={suspending ? 'destructive' : 'default'}
              className={!suspending && 'bg-emerald-600 hover:bg-emerald-700'}
              disabled={reason.trim().length < 5 || busy}
              onClick={() => void submit()}
            >
              {busy ? 'Applying…' : suspending ? 'Suspend facility' : 'Reinstate facility'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────── Send payment reminder ─────────────────────────

export function RemindDialog({ data, operator, onClose, onDone }: ActionProps) {
  const [channel, setChannel] = useState('SMS')
  const [busy, setBusy] = useState(false)
  const a = data.assessment

  const preview =
    a.overdueAmount > 0
      ? `${a.maxDaysOverdue > 60 ? 'URGENT' : a.maxDaysOverdue > 30 ? 'IMPORTANT' : 'Friendly'} reminder: ${data.customer.name.split(' ')[0]}, your Mbumah Hardware account has ${kes(a.overdueAmount)} overdue (${a.maxDaysOverdue} day(s) past due). Total outstanding: ${kes(a.outstanding)}. Please settle to keep your credit facility active. — Mbumah Hardware Credit Desk`
      : `Reminder: ${data.customer.name.split(' ')[0]}, your Mbumah Hardware account balance is ${kes(a.outstanding)}. Kindly settle by the due date to avoid interruption of credit services. — Mbumah Hardware Credit Desk`

  const submit = async () => {
    setBusy(true)
    try {
      const r = await creditApi.remind(data.customer.id, {
        channel,
        operatorId: operator.id,
      })
      toast.success('Reminder dispatched', { description: r.message })
      onDone()
    } catch (e) {
      toast.error('Reminder failed', {
        description: e instanceof Error ? e.message : 'Unknown error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[96vw]! max-w-[520px]!">
        <DialogHeader>
          <DialogTitle>Send payment reminder — {data.customer.name}</DialogTitle>
          <DialogDescription>
            The message is generated from LIVE engine figures. Sends are throttled to one per 6
            hours per customer (audit-trailed).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Channel</Label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SMS">SMS</SelectItem>
                <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                <SelectItem value="EMAIL">Email</SelectItem>
                <SelectItem value="IN_APP">In-app</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border bg-slate-50 p-3 text-xs dark:bg-slate-900">
            <p className="mb-1 flex items-center gap-1 font-bold uppercase tracking-wide text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Message preview
            </p>
            <p className="leading-relaxed">{preview}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? 'Sending…' : `Send via ${channel}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────── Register customer ─────────────────────────────

export function NewCustomerDialog({
  operator,
  onClose,
  onDone,
}: {
  operator: OperatorInfo
  onClose: () => void
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState('COMPANY')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [kraPin, setKraPin] = useState('')
  const [address, setAddress] = useState('')
  const [creditLimit, setCreditLimit] = useState('50000')
  const [busy, setBusy] = useState(false)

  const valid = name.trim().length >= 2 && Number(creditLimit) >= 0
  const needsApprover = operator.role !== 'OWNER' && operator.role !== 'MANAGER'

  const submit = async () => {
    setBusy(true)
    try {
      const r = await creditApi.createCustomer({
        name: name.trim(),
        type,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        kraPin: kraPin.trim() ? kraPin.trim().toUpperCase() : undefined,
        address: address.trim() || undefined,
        creditLimit: Number(creditLimit) || 0,
        approverId: operator.id,
      })
      toast.success(`${r.customer.name} registered`, {
        description: `Credit limit ${kes(Number(creditLimit) || 0)} approved by ${operator.name}`,
      })
      onDone()
    } catch (e) {
      toast.error('Registration failed', {
        description: e instanceof Error ? e.message : 'Unknown error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[96vw]! max-w-[560px]!">
        <DialogHeader>
          <DialogTitle>Register customer</DialogTitle>
          <DialogDescription>
            The credit limit is recorded with your approval identity ({operator.role}{' '}
            {operator.name}).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {needsApprover && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs font-semibold text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
              Approving a credit limit requires MANAGER or OWNER — switch the operator selector.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nc-name">Name *</Label>
              <Input id="nc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. John Contractors Ltd" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="COMPANY">Company</SelectItem>
                  <SelectItem value="INDIVIDUAL">Individual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nc-phone">Phone (Kenyan)</Label>
              <Input id="nc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07XX XXX XXX" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-limit">Credit limit (KES)</Label>
              <Input id="nc-limit" type="number" min="0" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nc-email">Email</Label>
              <Input id="nc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-pin">KRA PIN</Label>
              <Input id="nc-pin" value={kraPin} onChange={(e) => setKraPin(e.target.value)} placeholder="A000000000Z" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nc-address">Address</Label>
            <Input id="nc-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!valid || needsApprover || busy}
              onClick={() => void submit()}
            >
              {busy ? 'Registering…' : 'Register customer'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
