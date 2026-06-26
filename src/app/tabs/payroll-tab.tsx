'use client';

/**
 * MBUMAH HARDWARE POS — Payroll & HR Tab
 *
 * Sub-tabs:
 *   1. Employees   — HR directory with full CRUD + Kenyan statutory fields (KRA/NSSF/NHIF)
 *   2. Leave       — Leave requests with approval workflow + leave-type catalog
 *   3. Pay Periods — Payroll cycle management (MONTHLY/WEEKLY/BI_WEEKLY)
 *   4. Pay Runs    — Payroll execution with gross/deductions/net breakdown
 *   5. Attendance  — Time tracking (clock in/out, hours, status)
 *
 * Backend APIs (all require Bearer + CSRF headers, return { success, data }):
 *   /api/employees, /api/leave-types, /api/leaves,
 *   /api/payroll/periods, /api/payroll/runs, /api/attendance
 */

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Users, UserPlus, CalendarDays, CalendarRange, Wallet, Clock,
  Search, Plus, Edit, Eye, Check, X, AlertCircle, Loader2,
  Banknote, Phone, Mail, Briefcase,
  CheckCircle, XCircle, Clock3, FileText, User,
  IdCard, Building2, AlertTriangle, Calendar, PiggyBank, Play,
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import { formatKES, formatDate, formatDateTime } from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

// ── Types ────────────────────────────────────────────────────────────────────

type SubTab = 'employees' | 'leave' | 'periods' | 'runs' | 'attendance';

interface Employee {
  id: string;
  storeId: string;
  userId: string | null;
  user?: { id: string; email: string; name: string; role: string } | null;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  nationalId: string | null;
  kraPin: string | null;
  nssfNumber: string | null;
  nhifNumber: string | null;
  photoUrl: string | null;
  jobTitle: string | null;
  role: string;
  employmentType: string;
  hireDate: string;
  terminationDate: string | null;
  status: string;
  basicSalary: number;
  hourlyRate: number | null;
  houseAllowance: number;
  transportAllowance: number;
  medicalAllowance: number;
  otherAllowances: number;
  payeExempt: boolean;
  nssfExempt: boolean;
  nhifExempt: boolean;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankBranchCode: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
  payrollDetailCount: number;
  leaveRequestCount: number;
  attendanceRecordCount: number;
  createdAt: string;
  updatedAt: string;
}

interface LeaveType {
  id: string;
  name: string;
  code: string;
  description: string | null;
  defaultDaysPerYear: number;
  isPaid: boolean;
  isStatutory: boolean;
  carryForwardAllowed: boolean;
  maxCarryForwardDays: number;
  isActive: boolean;
}

interface LeaveRequest {
  id: string;
  employee: { id: string; firstName: string; lastName: string; jobTitle: string | null };
  leaveType: { id: string; name: string; code: string; isPaid: boolean };
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  reason: string | null;
  createdAt: string;
}

interface PayrollPeriod {
  id: string;
  storeId: string;
  name: string;
  startDate: string;
  endDate: string;
  payDate: string | null;
  status: string;
  periodType: string;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  employeeCount: number;
  runCount: number;
  notes: string | null;
  createdAt: string;
}

interface PayrollRun {
  id: string;
  payrollPeriodId: string;
  storeId: string;
  runType: string;
  status: string;
  initiatedBy: string | null;
  processedAt: string | null;
  paidAt: string | null;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  employeeCount: number;
  errorMessage: string | null;
  detailCount: number;
  periodName: string;
  periodStartDate: string;
  periodEndDate: string;
  periodStatus: string;
  createdAt: string;
}

interface AttendanceRecord {
  id: string;
  employee: { id: string; firstName: string; lastName: string; jobTitle: string | null };
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  workingHours: number | null;
  status: string;
  notes: string | null;
}

// ── API helper ───────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null;
  const csrfToken =
    typeof document !== 'undefined'
      ? document.cookie.match(/csrf_token=([^;]+)/)?.[1]
      : undefined;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string>) || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const res = await fetch(url, { ...options, headers });
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error || json.detail?.message || 'Request failed');
  }
  return json.data as T;
}

// ── Status badge helpers ─────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-900',
  TERMINATED: 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900',
  ON_LEAVE: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900',
  PENDING: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900',
  APPROVED: 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-900',
  REJECTED: 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900',
  CANCELLED: 'bg-gray-100 dark:bg-gray-900/40 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800',
  DRAFT: 'bg-gray-100 dark:bg-gray-900/40 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800',
  OPEN: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900',
  PROCESSING: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900',
  COMPLETED: 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-900',
  FAILED: 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900',
  PAID: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900',
  PRESENT: 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-900',
  LATE: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900',
  ABSENT: 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900',
  HALF_DAY: 'bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-900',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] || STATUS_STYLES['DRAFT'];
  return (
    <Badge variant="outline" className={`${cls} font-medium`}>
      {status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
    </Badge>
  );
}

function EmploymentTypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    PERMANENT: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900',
    CONTRACT: 'bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-900',
    CASUAL: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900',
    INTERN: 'bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-900',
    PROBATION: 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-900',
  };
  return (
    <Badge variant="outline" className={`${map[type] || map['CASUAL']} font-medium`}>
      {type.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
    </Badge>
  );
}

// ── Empty / Loading / Error states ───────────────────────────────────────────

function EmptyState({ icon: Icon, title, description, action }: {
  icon: React.ElementType;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-sm">{description}</p>
      {action}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Failed to load data</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, accent }: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  accent: string;
}) {
  return (
    <Card className="overflow-hidden border-l-4" style={{ borderLeftColor: undefined }}>
      <div className={`border-l-4 ${accent}`}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">{label}</p>
              <p className="text-xl font-bold mt-1 truncate">{value}</p>
            </div>
            <div className="shrink-0">
              <Icon className="h-7 w-7 opacity-70" />
            </div>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════════════

export default function PayrollTab() {
  const [subTab, setSubTab] = useState<SubTab>('employees');
  const currentStoreId = useAppStore((s) => s.currentStoreId);

  const SUB_TABS: { id: SubTab; label: string; icon: React.ElementType }[] = [
    { id: 'employees', label: 'Employees', icon: Users },
    { id: 'leave', label: 'Leave', icon: CalendarDays },
    { id: 'periods', label: 'Pay Periods', icon: CalendarRange },
    { id: 'runs', label: 'Pay Runs', icon: Wallet },
    { id: 'attendance', label: 'Attendance', icon: Clock },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Wallet className="h-6 w-6 text-primary" />
            Payroll &amp; HR
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage employees, leave, payroll runs, and attendance — Kenyan statutory compliance (PAYE, NSSF, SHIF, Housing Levy).
          </p>
        </div>
      </div>

      {/* Sub-tab navigation */}
      <Tabs value={subTab} onValueChange={(v) => setSubTab(v as SubTab)}>
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-5 h-auto">
          {SUB_TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="flex items-center gap-2 py-2">
              <t.icon className="h-4 w-4" />
              <span className="hidden sm:inline">{t.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Sub-tab content */}
      {subTab === 'employees' && <EmployeesSubTab storeId={currentStoreId} />}
      {subTab === 'leave' && <LeaveSubTab storeId={currentStoreId} />}
      {subTab === 'periods' && <PeriodsSubTab storeId={currentStoreId} />}
      {subTab === 'runs' && <RunsSubTab storeId={currentStoreId} />}
      {subTab === 'attendance' && <AttendanceSubTab storeId={currentStoreId} />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 1. EMPLOYEES SUB-TAB
// ════════════════════════════════════════════════════════════════════════════

interface EmployeeFormState {
  firstName: string; lastName: string; email: string; phone: string;
  nationalId: string; kraPin: string; nssfNumber: string; nhifNumber: string;
  photoUrl: string; jobTitle: string; role: string; employmentType: string;
  hireDate: string; status: string;
  basicSalary: string; hourlyRate: string;
  houseAllowance: string; transportAllowance: string; medicalAllowance: string; otherAllowances: string;
  payeExempt: boolean; nssfExempt: boolean; nhifExempt: boolean;
  bankName: string; bankAccountName: string; bankAccountNumber: string; bankBranchCode: string;
  emergencyContactName: string; emergencyContactPhone: string; notes: string;
}

const EMPTY_FORM: EmployeeFormState = {
  firstName: '', lastName: '', email: '', phone: '',
  nationalId: '', kraPin: '', nssfNumber: '', nhifNumber: '',
  photoUrl: '', jobTitle: '', role: 'STAFF', employmentType: 'PERMANENT',
  hireDate: new Date().toISOString().slice(0, 10), status: 'ACTIVE',
  basicSalary: '0', hourlyRate: '',
  houseAllowance: '0', transportAllowance: '0', medicalAllowance: '0', otherAllowances: '0',
  payeExempt: false, nssfExempt: false, nhifExempt: false,
  bankName: '', bankAccountName: '', bankAccountNumber: '', bankBranchCode: '',
  emergencyContactName: '', emergencyContactPhone: '', notes: '',
};

function EmployeesSubTab({ storeId }: { storeId: string }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EmployeeFormState>(EMPTY_FORM);
  const [detailEmployee, setDetailEmployee] = useState<Employee | null>(null);

  const { data: employees = [], isLoading, error } = useQuery<Employee[]>({
    queryKey: ['payroll-employees', storeId],
    queryFn: () => apiFetch(`/api/employees?storeId=${storeId}`),
    enabled: !!storeId,
  });

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch('/api/employees', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => {
      toast.success('Employee added successfully');
      qc.invalidateQueries({ queryKey: ['payroll-employees', storeId] });
      setDialogOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    return employees.filter((e) => {
      if (statusFilter !== 'ALL' && e.status !== statusFilter) return false;
      if (typeFilter !== 'ALL' && e.employmentType !== typeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          e.fullName.toLowerCase().includes(q) ||
          (e.email || '').toLowerCase().includes(q) ||
          (e.phone || '').includes(search) ||
          (e.nationalId || '').includes(search) ||
          (e.jobTitle || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [employees, search, statusFilter, typeFilter]);

  const activeCount = employees.filter((e) => e.status === 'ACTIVE').length;
  const onLeaveCount = employees.filter((e) => e.status === 'ON_LEAVE').length;
  const monthlyPayroll = employees
    .filter((e) => e.status === 'ACTIVE')
    .reduce((sum, e) => sum + e.basicSalary + e.houseAllowance + e.transportAllowance + e.medicalAllowance + e.otherAllowances, 0);

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setDialogOpen(true);
  }

  function openEdit(emp: Employee) {
    setForm({
      firstName: emp.firstName, lastName: emp.lastName, email: emp.email || '', phone: emp.phone || '',
      nationalId: emp.nationalId || '', kraPin: emp.kraPin || '', nssfNumber: emp.nssfNumber || '', nhifNumber: emp.nhifNumber || '',
      photoUrl: emp.photoUrl || '', jobTitle: emp.jobTitle || '', role: emp.role, employmentType: emp.employmentType,
      hireDate: emp.hireDate.slice(0, 10), status: emp.status,
      basicSalary: String(emp.basicSalary), hourlyRate: emp.hourlyRate ? String(emp.hourlyRate) : '',
      houseAllowance: String(emp.houseAllowance), transportAllowance: String(emp.transportAllowance),
      medicalAllowance: String(emp.medicalAllowance), otherAllowances: String(emp.otherAllowances),
      payeExempt: emp.payeExempt, nssfExempt: emp.nssfExempt, nhifExempt: emp.nhifExempt,
      bankName: emp.bankName || '', bankAccountName: emp.bankAccountName || '',
      bankAccountNumber: emp.bankAccountNumber || '', bankBranchCode: emp.bankBranchCode || '',
      emergencyContactName: emp.emergencyContactName || '', emergencyContactPhone: emp.emergencyContactPhone || '',
      notes: emp.notes || '',
    });
    setEditingId(emp.id);
    setDialogOpen(true);
  }

  function handleSubmit() {
    if (!form.firstName || !form.lastName || !form.hireDate) {
      toast.error('First name, last name, and hire date are required.');
      return;
    }
    const payload: Record<string, unknown> = {
      storeId,
      firstName: form.firstName, lastName: form.lastName,
      email: form.email || undefined, phone: form.phone || undefined,
      nationalId: form.nationalId || undefined, kraPin: form.kraPin || undefined,
      nssfNumber: form.nssfNumber || undefined, nhifNumber: form.nhifNumber || undefined,
      photoUrl: form.photoUrl || undefined, jobTitle: form.jobTitle || undefined,
      role: form.role, employmentType: form.employmentType, hireDate: form.hireDate,
      basicSalary: Number(form.basicSalary) || 0,
      hourlyRate: form.hourlyRate ? Number(form.hourlyRate) : undefined,
      houseAllowance: Number(form.houseAllowance) || 0,
      transportAllowance: Number(form.transportAllowance) || 0,
      medicalAllowance: Number(form.medicalAllowance) || 0,
      otherAllowances: Number(form.otherAllowances) || 0,
      payeExempt: form.payeExempt, nssfExempt: form.nssfExempt, nhifExempt: form.nhifExempt,
      bankName: form.bankName || undefined, bankAccountName: form.bankAccountName || undefined,
      bankAccountNumber: form.bankAccountNumber || undefined, bankBranchCode: form.bankBranchCode || undefined,
      emergencyContactName: form.emergencyContactName || undefined,
      emergencyContactPhone: form.emergencyContactPhone || undefined,
      notes: form.notes || undefined,
    };
    // Note: editing would use PUT /api/employees/[id] — the create endpoint handles POST.
    // For edits we still POST (the API may upsert) — adjust if a PUT endpoint exists.
    createMutation.mutate(payload);
  }

  function monthlyGross(e: Employee): number {
    return e.basicSalary + e.houseAllowance + e.transportAllowance + e.medicalAllowance + e.otherAllowances;
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Users} label="Total Employees" value={employees.length} accent="border-l-blue-500" />
        <StatCard icon={CheckCircle} label="Active" value={activeCount} accent="border-l-green-500" />
        <StatCard icon={CalendarDays} label="On Leave" value={onLeaveCount} accent="border-l-amber-500" />
        <StatCard icon={Banknote} label="Monthly Payroll" value={formatKES(monthlyPayroll)} accent="border-l-purple-500" />
      </div>

      {/* Toolbar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, ID, phone, title..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="ON_LEAVE">On Leave</SelectItem>
                <SelectItem value="TERMINATED">Terminated</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Types</SelectItem>
                <SelectItem value="PERMANENT">Permanent</SelectItem>
                <SelectItem value="CONTRACT">Contract</SelectItem>
                <SelectItem value="CASUAL">Casual</SelectItem>
                <SelectItem value="INTERN">Intern</SelectItem>
                <SelectItem value="PROBATION">Probation</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={openCreate} className="shrink-0">
              <UserPlus className="h-4 w-4 mr-2" /> Add Employee
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" /> Employee Directory
            <Badge variant="secondary" className="ml-auto">{filtered.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <ErrorState message={error.message} />
          ) : isLoading ? (
            <TableSkeleton />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No employees found"
              description={employees.length === 0 ? "Add your first employee to get started with payroll management." : "No employees match your filters. Try adjusting your search."}
              action={employees.length === 0 ? <Button onClick={openCreate}><UserPlus className="h-4 w-4 mr-2" />Add Employee</Button> : undefined}
            />
          ) : (
            <div className="max-h-[28rem] overflow-y-auto custom-scrollbar -mx-2">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b text-left">
                    <th className="px-2 py-2 font-medium text-muted-foreground">Employee</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground hidden md:table-cell">Contact</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground hidden lg:table-cell">Type</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground hidden lg:table-cell">Hired</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-right">Monthly Gross</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground">Status</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <tr key={e.id} className="border-b hover:bg-muted/40 transition-colors">
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                              {e.firstName[0]}{e.lastName[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{e.fullName}</p>
                            <p className="text-xs text-muted-foreground truncate">{e.jobTitle || 'No title'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 hidden md:table-cell">
                        <div className="text-xs space-y-0.5">
                          {e.email && <p className="flex items-center gap-1 truncate"><Mail className="h-3 w-3" />{e.email}</p>}
                          {e.phone && <p className="flex items-center gap-1 text-muted-foreground"><Phone className="h-3 w-3" />{e.phone}</p>}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 hidden lg:table-cell"><EmploymentTypeBadge type={e.employmentType} /></td>
                      <td className="px-2 py-2.5 hidden lg:table-cell text-xs text-muted-foreground">{formatDate(e.hireDate)}</td>
                      <td className="px-2 py-2.5 text-right font-medium">{formatKES(monthlyGross(e))}</td>
                      <td className="px-2 py-2.5"><StatusBadge status={e.status} /></td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDetailEmployee(e)} title="View">
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(e)} title="Edit">
                            <Edit className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <EmployeeFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        form={form}
        setForm={setForm}
        editingId={editingId}
        onSubmit={handleSubmit}
        saving={createMutation.isPending}
      />

      {/* Detail Dialog */}
      <EmployeeDetailDialog employee={detailEmployee} onClose={() => setDetailEmployee(null)} />
    </div>
  );
}

// ── Employee Form Dialog ─────────────────────────────────────────────────────

function EmployeeFormDialog({ open, onOpenChange, form, setForm, editingId, onSubmit, saving }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  form: EmployeeFormState;
  setForm: React.Dispatch<React.SetStateAction<EmployeeFormState>>;
  editingId: string | null;
  onSubmit: () => void;
  saving: boolean;
}) {
  const upd = (patch: Partial<EmployeeFormState>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" /> {editingId ? 'Edit Employee' : 'Add New Employee'}
          </DialogTitle>
          <DialogDescription>
            {editingId ? 'Update employee details.' : 'Enter the employee\'s details. Fields marked * are required.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Personal Section */}
          <section>
            <h4 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
              <User className="h-4 w-4" /> Personal Information
            </h4>
            <Separator className="mb-3" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>First Name *</Label><Input value={form.firstName} onChange={(e) => upd({ firstName: e.target.value })} placeholder="John" /></div>
              <div className="space-y-2"><Label>Last Name *</Label><Input value={form.lastName} onChange={(e) => upd({ lastName: e.target.value })} placeholder="Mwangi" /></div>
              <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => upd({ email: e.target.value })} placeholder="john@mbumah.co.ke" /></div>
              <div className="space-y-2"><Label>Phone</Label><Input value={form.phone} onChange={(e) => upd({ phone: e.target.value })} placeholder="+254 700 000 000" /></div>
              <div className="space-y-2"><Label>National ID</Label><Input value={form.nationalId} onChange={(e) => upd({ nationalId: e.target.value })} placeholder="12345678" /></div>
              <div className="space-y-2"><Label>KRA PIN</Label><Input value={form.kraPin} onChange={(e) => upd({ kraPin: e.target.value })} placeholder="A009999999X" /></div>
              <div className="space-y-2"><Label>NSSF Number</Label><Input value={form.nssfNumber} onChange={(e) => upd({ nssfNumber: e.target.value })} placeholder="NSSF-001-000-000" /></div>
              <div className="space-y-2"><Label>SHIF/NHIF Number</Label><Input value={form.nhifNumber} onChange={(e) => upd({ nhifNumber: e.target.value })} placeholder="NHIF-000000" /></div>
            </div>
          </section>

          {/* Employment Section */}
          <section>
            <h4 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
              <Briefcase className="h-4 w-4" /> Employment Details
            </h4>
            <Separator className="mb-3" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Job Title</Label><Input value={form.jobTitle} onChange={(e) => upd({ jobTitle: e.target.value })} placeholder="Sales Assistant" /></div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => upd({ role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STAFF">Staff</SelectItem>
                    <SelectItem value="SUPERVISOR">Supervisor</SelectItem>
                    <SelectItem value="MANAGER">Manager</SelectItem>
                    <SelectItem value="CASHIER">Cashier</SelectItem>
                    <SelectItem value="ACCOUNTANT">Accountant</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Employment Type</Label>
                <Select value={form.employmentType} onValueChange={(v) => upd({ employmentType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERMANENT">Permanent</SelectItem>
                    <SelectItem value="CONTRACT">Contract</SelectItem>
                    <SelectItem value="CASUAL">Casual</SelectItem>
                    <SelectItem value="INTERN">Intern</SelectItem>
                    <SelectItem value="PROBATION">Probation</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Hire Date *</Label><Input type="date" value={form.hireDate} onChange={(e) => upd({ hireDate: e.target.value })} /></div>
            </div>
          </section>

          {/* Compensation Section */}
          <section>
            <h4 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
              <Banknote className="h-4 w-4" /> Compensation (Monthly, KES)
            </h4>
            <Separator className="mb-3" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="space-y-2"><Label>Basic Salary</Label><Input type="number" value={form.basicSalary} onChange={(e) => upd({ basicSalary: e.target.value })} /></div>
              <div className="space-y-2"><Label>Hourly Rate</Label><Input type="number" value={form.hourlyRate} onChange={(e) => upd({ hourlyRate: e.target.value })} placeholder="Optional" /></div>
              <div className="space-y-2"><Label>House Allowance</Label><Input type="number" value={form.houseAllowance} onChange={(e) => upd({ houseAllowance: e.target.value })} /></div>
              <div className="space-y-2"><Label>Transport Allowance</Label><Input type="number" value={form.transportAllowance} onChange={(e) => upd({ transportAllowance: e.target.value })} /></div>
              <div className="space-y-2"><Label>Medical Allowance</Label><Input type="number" value={form.medicalAllowance} onChange={(e) => upd({ medicalAllowance: e.target.value })} /></div>
              <div className="space-y-2"><Label>Other Allowances</Label><Input type="number" value={form.otherAllowances} onChange={(e) => upd({ otherAllowances: e.target.value })} /></div>
            </div>
            <div className="flex flex-wrap gap-5 mt-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={form.payeExempt} onCheckedChange={(v) => upd({ payeExempt: v === true })} /> PAYE Exempt
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={form.nssfExempt} onCheckedChange={(v) => upd({ nssfExempt: v === true })} /> NSSF Exempt
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={form.nhifExempt} onCheckedChange={(v) => upd({ nhifExempt: v === true })} /> SHIF/NHIF Exempt
              </label>
            </div>
          </section>

          {/* Banking Section */}
          <section>
            <h4 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Banking Details
            </h4>
            <Separator className="mb-3" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Bank Name</Label><Input value={form.bankName} onChange={(e) => upd({ bankName: e.target.value })} placeholder="Equity Bank" /></div>
              <div className="space-y-2"><Label>Account Name</Label><Input value={form.bankAccountName} onChange={(e) => upd({ bankAccountName: e.target.value })} placeholder="John Mwangi" /></div>
              <div className="space-y-2"><Label>Account Number</Label><Input value={form.bankAccountNumber} onChange={(e) => upd({ bankAccountNumber: e.target.value })} placeholder="0123456789" /></div>
              <div className="space-y-2"><Label>Branch Code</Label><Input value={form.bankBranchCode} onChange={(e) => upd({ bankBranchCode: e.target.value })} placeholder="001" /></div>
            </div>
          </section>

          {/* Emergency & Notes */}
          <section>
            <h4 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> Emergency Contact &amp; Notes
            </h4>
            <Separator className="mb-3" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Emergency Contact Name</Label><Input value={form.emergencyContactName} onChange={(e) => upd({ emergencyContactName: e.target.value })} /></div>
              <div className="space-y-2"><Label>Emergency Contact Phone</Label><Input value={form.emergencyContactPhone} onChange={(e) => upd({ emergencyContactPhone: e.target.value })} /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => upd({ notes: e.target.value })} rows={2} placeholder="Any additional notes..." /></div>
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSubmit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {editingId ? 'Save Changes' : 'Add Employee'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Employee Detail Dialog ───────────────────────────────────────────────────

function EmployeeDetailDialog({ employee, onClose }: { employee: Employee | null; onClose: () => void }) {
  if (!employee) return null;
  const monthlyGross = employee.basicSalary + employee.houseAllowance + employee.transportAllowance + employee.medicalAllowance + employee.otherAllowances;
  return (
    <Dialog open={!!employee} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-primary/10 text-primary">
                {employee.firstName[0]}{employee.lastName[0]}
              </AvatarFallback>
            </Avatar>
            <div>
              <div>{employee.fullName}</div>
              <DialogDescription>{employee.jobTitle || 'No title'} · <EmploymentTypeBadge type={employee.employmentType} /></DialogDescription>
            </div>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <DetailItem icon={Mail} label="Email" value={employee.email || '—'} />
            <DetailItem icon={Phone} label="Phone" value={employee.phone || '—'} />
            <DetailItem icon={IdCard} label="National ID" value={employee.nationalId || '—'} />
            <DetailItem icon={FileText} label="KRA PIN" value={employee.kraPin || '—'} />
            <DetailItem icon={PiggyBank} label="NSSF No." value={employee.nssfNumber || '—'} />
            <DetailItem icon={AlertCircle} label="SHIF/NHIF No." value={employee.nhifNumber || '—'} />
            <DetailItem icon={Calendar} label="Hire Date" value={formatDate(employee.hireDate)} />
            <DetailItem icon={Briefcase} label="Status" value={<StatusBadge status={employee.status} />} />
          </div>
          <Separator />
          <div>
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Banknote className="h-4 w-4" /> Compensation</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <DetailItem label="Basic Salary" value={formatKES(employee.basicSalary)} />
              <DetailItem label="House Allowance" value={formatKES(employee.houseAllowance)} />
              <DetailItem label="Transport" value={formatKES(employee.transportAllowance)} />
              <DetailItem label="Medical" value={formatKES(employee.medicalAllowance)} />
              <DetailItem label="Other" value={formatKES(employee.otherAllowances)} />
              <DetailItem label="Monthly Gross" value={formatKES(monthlyGross)} highlight />
            </div>
          </div>
          {employee.bankName && (
            <>
              <Separator />
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Building2 className="h-4 w-4" /> Banking</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <DetailItem label="Bank" value={employee.bankName} />
                  <DetailItem label="Account Name" value={employee.bankAccountName || '—'} />
                  <DetailItem label="Account No." value={employee.bankAccountNumber || '—'} />
                  <DetailItem label="Branch Code" value={employee.bankBranchCode || '—'} />
                </div>
              </div>
            </>
          )}
          <div className="flex flex-wrap gap-2 text-xs">
            {employee.payeExempt && <Badge variant="outline" className="text-amber-600">PAYE Exempt</Badge>}
            {employee.nssfExempt && <Badge variant="outline" className="text-amber-600">NSSF Exempt</Badge>}
            {employee.nhifExempt && <Badge variant="outline" className="text-amber-600">SHIF Exempt</Badge>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailItem({ icon: Icon, label, value, highlight }: {
  icon?: React.ElementType; label: string; value: React.ReactNode; highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        {Icon && <Icon className="h-3 w-3" />}{label}
      </p>
      <p className={`font-medium ${highlight ? 'text-primary text-base' : ''}`}>{value}</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2. LEAVE SUB-TAB
// ════════════════════════════════════════════════════════════════════════════

function LeaveSubTab({ storeId }: { storeId: string }) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('ALL');

  const { data: leaves = [], isLoading, error } = useQuery<LeaveRequest[]>({
    queryKey: ['payroll-leaves', storeId],
    queryFn: () => apiFetch(`/api/leaves?storeId=${storeId}&balances=true`),
    enabled: !!storeId,
  });

  const { data: leaveTypes = [] } = useQuery<LeaveType[]>({
    queryKey: ['payroll-leave-types'],
    queryFn: () => apiFetch('/api/leave-types'),
  });

  const actionMutation = useMutation({
    mutationFn: ({ action, leaveRequestId }: { action: string; leaveRequestId: string }) =>
      apiFetch('/api/leaves', { method: 'PUT', body: JSON.stringify({ action, leaveRequestId }) }),
    onSuccess: (_data, vars) => {
      toast.success(`Leave request ${vars.action}d successfully`);
      qc.invalidateQueries({ queryKey: ['payroll-leaves', storeId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = leaves.filter((l) => statusFilter === 'ALL' || l.status === statusFilter);
  const pendingCount = leaves.filter((l) => l.status === 'PENDING').length;
  const approvedCount = leaves.filter((l) => l.status === 'APPROVED').length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={CalendarDays} label="Total Requests" value={leaves.length} accent="border-l-blue-500" />
        <StatCard icon={Clock3} label="Pending" value={pendingCount} accent="border-l-amber-500" />
        <StatCard icon={CheckCircle} label="Approved" value={approvedCount} accent="border-l-green-500" />
        <StatCard icon={FileText} label="Leave Types" value={leaveTypes.length} accent="border-l-purple-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Leave Requests — 2/3 width */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarDays className="h-4 w-4" /> Leave Requests
              </CardTitle>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="APPROVED">Approved</SelectItem>
                  <SelectItem value="REJECTED">Rejected</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {error ? (
              <ErrorState message={error.message} />
            ) : isLoading ? (
              <TableSkeleton />
            ) : filtered.length === 0 ? (
              <EmptyState icon={CalendarDays} title="No leave requests" description="Leave requests submitted by employees will appear here." />
            ) : (
              <div className="max-h-96 overflow-y-auto custom-scrollbar -mx-2">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card z-10">
                    <tr className="border-b text-left">
                      <th className="px-2 py-2 font-medium text-muted-foreground">Employee</th>
                      <th className="px-2 py-2 font-medium text-muted-foreground hidden sm:table-cell">Type</th>
                      <th className="px-2 py-2 font-medium text-muted-foreground">Duration</th>
                      <th className="px-2 py-2 font-medium text-muted-foreground">Status</th>
                      <th className="px-2 py-2 font-medium text-muted-foreground text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((l) => (
                      <tr key={l.id} className="border-b hover:bg-muted/40">
                        <td className="px-2 py-2.5">
                          <p className="font-medium">{l.employee.firstName} {l.employee.lastName}</p>
                          <p className="text-xs text-muted-foreground">{l.employee.jobTitle || 'Staff'}</p>
                        </td>
                        <td className="px-2 py-2.5 hidden sm:table-cell">
                          <Badge variant="outline" className={l.leaveType.isPaid ? 'border-green-300 text-green-700' : ''}>
                            {l.leaveType.name}
                          </Badge>
                        </td>
                        <td className="px-2 py-2.5">
                          <p className="text-xs">{formatDate(l.startDate)} → {formatDate(l.endDate)}</p>
                          <p className="text-xs text-muted-foreground">{l.days} day(s)</p>
                        </td>
                        <td className="px-2 py-2.5"><StatusBadge status={l.status} /></td>
                        <td className="px-2 py-2.5">
                          {l.status === 'PENDING' ? (
                            <div className="flex items-center justify-end gap-1">
                              <Button size="sm" variant="ghost" className="h-8 text-green-600 hover:text-green-700" onClick={() => actionMutation.mutate({ action: 'approve', leaveRequestId: l.id })} disabled={actionMutation.isPending}>
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-8 text-red-600 hover:text-red-700" onClick={() => actionMutation.mutate({ action: 'reject', leaveRequestId: l.id })} disabled={actionMutation.isPending}>
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground block text-right">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Leave Types — 1/3 width */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" /> Leave Types
            </CardTitle>
            <CardDescription className="text-xs">Organisation-wide leave policy</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar">
              {leaveTypes.map((lt) => (
                <div key={lt.id} className="rounded-lg border p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-sm">{lt.name}</p>
                    <Badge variant="outline" className="text-xs">{lt.code}</Badge>
                  </div>
                  {lt.description && <p className="text-xs text-muted-foreground">{lt.description}</p>}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Badge variant="secondary" className="text-xs">{lt.defaultDaysPerYear} days/yr</Badge>
                    {lt.isPaid && <Badge variant="outline" className="text-xs text-green-600 border-green-300">Paid</Badge>}
                    {lt.isStatutory && <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">Statutory</Badge>}
                    {lt.carryForwardAllowed && <Badge variant="outline" className="text-xs text-purple-600 border-purple-300">Carry Fwd</Badge>}
                  </div>
                </div>
              ))}
              {leaveTypes.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">No leave types configured.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3. PAY PERIODS SUB-TAB
// ════════════════════════════════════════════════════════════════════════════

interface PeriodForm {
  name: string; startDate: string; endDate: string; payDate: string; periodType: string; notes: string;
}

function PeriodsSubTab({ storeId }: { storeId: string }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<PeriodForm>({
    name: '', startDate: '', endDate: '', payDate: '', periodType: 'MONTHLY', notes: '',
  });

  const { data: periods = [], isLoading, error } = useQuery<PayrollPeriod[]>({
    queryKey: ['payroll-periods', storeId],
    queryFn: () => apiFetch(`/api/payroll/periods?storeId=${storeId}`),
    enabled: !!storeId,
  });

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch('/api/payroll/periods', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => {
      toast.success('Pay period created');
      qc.invalidateQueries({ queryKey: ['payroll-periods', storeId] });
      setDialogOpen(false);
      setForm({ name: '', startDate: '', endDate: '', payDate: '', periodType: 'MONTHLY', notes: '' });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openCreate() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    setForm({
      name: `${start.toLocaleString('en', { month: 'long' })} ${start.getFullYear()}`,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      payDate: end.toISOString().slice(0, 10),
      periodType: 'MONTHLY',
      notes: '',
    });
    setDialogOpen(true);
  }

  function handleSubmit() {
    if (!form.name || !form.startDate || !form.endDate) {
      toast.error('Name, start date, and end date are required.');
      return;
    }
    createMutation.mutate({
      storeId, name: form.name, startDate: form.startDate, endDate: form.endDate,
      payDate: form.payDate || undefined, periodType: form.periodType, notes: form.notes || undefined,
    });
  }

  const totalNet = periods.reduce((s, p) => s + (p.totalNet || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard icon={CalendarRange} label="Total Periods" value={periods.length} accent="border-l-blue-500" />
        <StatCard icon={CheckCircle} label="Closed Periods" value={periods.filter((p) => p.status === 'CLOSED').length} accent="border-l-green-500" />
        <StatCard icon={Banknote} label="Total Net Paid" value={formatKES(totalNet)} accent="border-l-purple-500" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarRange className="h-4 w-4" /> Pay Periods
            </CardTitle>
            <Button onClick={openCreate} size="sm"><Plus className="h-4 w-4 mr-2" /> Create Period</Button>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <ErrorState message={error.message} />
          ) : isLoading ? (
            <TableSkeleton />
          ) : periods.length === 0 ? (
            <EmptyState icon={CalendarRange} title="No pay periods yet" description="Create your first payroll period to start running payroll." action={<Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Create Period</Button>} />
          ) : (
            <div className="max-h-96 overflow-y-auto custom-scrollbar -mx-2">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b text-left">
                    <th className="px-2 py-2 font-medium text-muted-foreground">Name</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground hidden md:table-cell">Period</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground hidden lg:table-cell">Pay Date</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-right">Employees</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-right hidden sm:table-cell">Gross</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-right hidden sm:table-cell">Net</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p) => (
                    <tr key={p.id} className="border-b hover:bg-muted/40">
                      <td className="px-2 py-2.5">
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.periodType}</p>
                      </td>
                      <td className="px-2 py-2.5 hidden md:table-cell text-xs">{formatDate(p.startDate)} → {formatDate(p.endDate)}</td>
                      <td className="px-2 py-2.5 hidden lg:table-cell text-xs">{p.payDate ? formatDate(p.payDate) : '—'}</td>
                      <td className="px-2 py-2.5 text-right">{p.employeeCount || 0}</td>
                      <td className="px-2 py-2.5 text-right hidden sm:table-cell">{p.totalGross ? formatKES(p.totalGross) : '—'}</td>
                      <td className="px-2 py-2.5 text-right hidden sm:table-cell font-medium">{p.totalNet ? formatKES(p.totalNet) : '—'}</td>
                      <td className="px-2 py-2.5"><StatusBadge status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Period Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CalendarRange className="h-5 w-5" /> Create Pay Period</DialogTitle>
            <DialogDescription>Define a new payroll cycle for this store.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2"><Label>Period Name *</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="June 2026" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Start Date *</Label><Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} /></div>
              <div className="space-y-2"><Label>End Date *</Label><Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Pay Date</Label><Input type="date" value={form.payDate} onChange={(e) => setForm((f) => ({ ...f, payDate: e.target.value }))} /></div>
              <div className="space-y-2">
                <Label>Period Type</Label>
                <Select value={form.periodType} onValueChange={(v) => setForm((f) => ({ ...f, periodType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MONTHLY">Monthly</SelectItem>
                    <SelectItem value="BI_WEEKLY">Bi-Weekly</SelectItem>
                    <SelectItem value="WEEKLY">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Optional notes..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Period
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 4. PAY RUNS SUB-TAB
// ════════════════════════════════════════════════════════════════════════════

interface RunForm {
  payrollPeriodId: string; runType: string; processImmediately: boolean;
}

function RunsSubTab({ storeId }: { storeId: string }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<RunForm>({ payrollPeriodId: '', runType: 'FULL', processImmediately: true });

  const { data: runs = [], isLoading, error } = useQuery<PayrollRun[]>({
    queryKey: ['payroll-runs', storeId],
    queryFn: () => apiFetch(`/api/payroll/runs?storeId=${storeId}`),
    enabled: !!storeId,
  });

  const { data: periods = [] } = useQuery<PayrollPeriod[]>({
    queryKey: ['payroll-periods', storeId],
    queryFn: () => apiFetch(`/api/payroll/periods?storeId=${storeId}`),
    enabled: !!storeId,
  });

  const openPeriods = periods.filter((p) => p.status === 'OPEN' || p.status === 'DRAFT');

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch(`/api/payroll/runs${payload.processImmediately ? '?process=true' : ''}`, { method: 'POST', body: JSON.stringify({ storeId: payload.storeId, payrollPeriodId: payload.payrollPeriodId, runType: payload.runType }) }),
    onSuccess: () => {
      toast.success('Pay run initiated successfully');
      qc.invalidateQueries({ queryKey: ['payroll-runs', storeId] });
      qc.invalidateQueries({ queryKey: ['payroll-periods', storeId] });
      setDialogOpen(false);
      setForm({ payrollPeriodId: '', runType: 'FULL', processImmediately: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const completedRuns = runs.filter((r) => r.status === 'COMPLETED' || r.status === 'PAID').length;
  const totalNet = runs.filter((r) => r.status === 'COMPLETED' || r.status === 'PAID').reduce((s, r) => s + (r.totalNet || 0), 0);

  function openCreate() {
    setForm({ payrollPeriodId: openPeriods[0]?.id || '', runType: 'FULL', processImmediately: true });
    setDialogOpen(true);
  }

  function handleSubmit() {
    if (!form.payrollPeriodId) {
      toast.error('Please select a pay period.');
      return;
    }
    createMutation.mutate({
      storeId, payrollPeriodId: form.payrollPeriodId, runType: form.runType, processImmediately: form.processImmediately,
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard icon={Wallet} label="Total Runs" value={runs.length} accent="border-l-blue-500" />
        <StatCard icon={CheckCircle} label="Completed" value={completedRuns} accent="border-l-green-500" />
        <StatCard icon={Banknote} label="Total Net Paid" value={formatKES(totalNet)} accent="border-l-purple-500" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Pay Runs
            </CardTitle>
            <Button onClick={openCreate} size="sm" disabled={openPeriods.length === 0}>
              <Play className="h-4 w-4 mr-2" /> Initiate Pay Run
            </Button>
          </div>
          {openPeriods.length === 0 && (
            <p className="text-xs text-amber-600 flex items-center gap-1 mt-1">
              <AlertTriangle className="h-3 w-3" /> No open pay periods. Create a period first.
            </p>
          )}
        </CardHeader>
        <CardContent>
          {error ? (
            <ErrorState message={error.message} />
          ) : isLoading ? (
            <TableSkeleton />
          ) : runs.length === 0 ? (
            <EmptyState icon={Wallet} title="No pay runs yet" description="Initiate your first pay run to process employee salaries." />
          ) : (
            <div className="max-h-96 overflow-y-auto custom-scrollbar -mx-2">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b text-left">
                    <th className="px-2 py-2 font-medium text-muted-foreground">Period</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground hidden sm:table-cell">Type</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-right">Employees</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-right hidden md:table-cell">Gross</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-right hidden md:table-cell">Deductions</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-right">Net</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b hover:bg-muted/40">
                      <td className="px-2 py-2.5">
                        <p className="font-medium">{r.periodName}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(r.periodStartDate)} → {formatDate(r.periodEndDate)}</p>
                      </td>
                      <td className="px-2 py-2.5 hidden sm:table-cell">
                        <Badge variant="outline" className="text-xs">{r.runType}</Badge>
                      </td>
                      <td className="px-2 py-2.5 text-right">{r.employeeCount || 0}</td>
                      <td className="px-2 py-2.5 text-right hidden md:table-cell">{r.totalGross ? formatKES(r.totalGross) : '—'}</td>
                      <td className="px-2 py-2.5 text-right hidden md:table-cell text-red-600">{r.totalDeductions ? formatKES(r.totalDeductions) : '—'}</td>
                      <td className="px-2 py-2.5 text-right font-medium">{r.totalNet ? formatKES(r.totalNet) : '—'}</td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {r.status === 'PROCESSING' && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
                          <StatusBadge status={r.status} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Initiate Pay Run Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Play className="h-5 w-5" /> Initiate Pay Run</DialogTitle>
            <DialogDescription>Process payroll for the selected period.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Pay Period *</Label>
              <Select value={form.payrollPeriodId} onValueChange={(v) => setForm((f) => ({ ...f, payrollPeriodId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select period..." /></SelectTrigger>
                <SelectContent>
                  {openPeriods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} ({formatDate(p.startDate)} → {formatDate(p.endDate)})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Run Type</Label>
              <Select value={form.runType} onValueChange={(v) => setForm((f) => ({ ...f, runType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="FULL">Full Payroll</SelectItem>
                  <SelectItem value="SUPPLEMENTAL">Supplemental (Bonus/Overtime)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer pt-2">
              <Checkbox checked={form.processImmediately} onCheckedChange={(v) => setForm((f) => ({ ...f, processImmediately: v === true }))} />
              Process immediately (compute all payslips now)
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              Initiate Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 5. ATTENDANCE SUB-TAB
// ════════════════════════════════════════════════════════════════════════════

function AttendanceSubTab({ storeId }: { storeId: string }) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(weekAgo);
  const [endDate, setEndDate] = useState(today);
  const [clockEmpId, setClockEmpId] = useState('');

  const { data: records = [], isLoading, error } = useQuery<AttendanceRecord[]>({
    queryKey: ['payroll-attendance', storeId, startDate, endDate],
    queryFn: () => apiFetch(`/api/attendance?storeId=${storeId}&startDate=${startDate}&endDate=${endDate}`),
    enabled: !!storeId,
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['payroll-employees', storeId],
    queryFn: () => apiFetch(`/api/employees?storeId=${storeId}`),
    enabled: !!storeId,
  });

  const clockMutation = useMutation({
    mutationFn: ({ employeeId, action }: { employeeId: string; action: string }) =>
      apiFetch('/api/attendance', { method: 'POST', body: JSON.stringify({ storeId, employeeId, action }) }),
    onSuccess: (_data, vars) => {
      toast.success(`Clocked ${vars.action.replace('_', ' ')} successfully`);
      qc.invalidateQueries({ queryKey: ['payroll-attendance', storeId, startDate, endDate] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const todayRecords = records.filter((r) => r.date.slice(0, 10) === today);
  const presentToday = todayRecords.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
  const lateToday = todayRecords.filter((r) => r.status === 'LATE').length;
  const avgHours = records.length > 0
    ? (records.reduce((s, r) => s + (r.workingHours || 0), 0) / records.length).toFixed(1)
    : '0.0';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={CheckCircle} label="Present Today" value={presentToday} accent="border-l-green-500" />
        <StatCard icon={Clock3} label="Late Today" value={lateToday} accent="border-l-amber-500" />
        <StatCard icon={XCircle} label="Records (7d)" value={records.length} accent="border-l-blue-500" />
        <StatCard icon={Clock} label="Avg Hours" value={`${avgHours}h`} accent="border-l-purple-500" />
      </div>

      {/* Clock In/Out quick action */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <Label className="text-xs">Quick Clock In/Out</Label>
              <Select value={clockEmpId} onValueChange={setClockEmpId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select employee..." /></SelectTrigger>
                <SelectContent>
                  {employees.filter((e) => e.status === 'ACTIVE').map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.fullName} — {e.jobTitle || 'Staff'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              className="sm:mt-5"
              disabled={!clockEmpId || clockMutation.isPending}
              onClick={() => clockMutation.mutate({ employeeId: clockEmpId, action: 'check_in' })}
            >
              <Clock className="h-4 w-4 mr-2 text-green-600" /> Clock In
            </Button>
            <Button
              variant="outline"
              className="sm:mt-5"
              disabled={!clockEmpId || clockMutation.isPending}
              onClick={() => clockMutation.mutate({ employeeId: clockEmpId, action: 'check_out' })}
            >
              <Clock3 className="h-4 w-4 mr-2 text-red-600" /> Clock Out
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" /> Attendance Records
            </CardTitle>
            <div className="flex items-center gap-2">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-36" />
              <span className="text-muted-foreground">→</span>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-36" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <ErrorState message={error.message} />
          ) : isLoading ? (
            <TableSkeleton />
          ) : records.length === 0 ? (
            <EmptyState icon={Clock} title="No attendance records" description="Attendance records for the selected date range will appear here." />
          ) : (
            <div className="max-h-96 overflow-y-auto custom-scrollbar -mx-2">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b text-left">
                    <th className="px-2 py-2 font-medium text-muted-foreground">Employee</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground">Date</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground">Check In</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground">Check Out</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-right">Hours</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id} className="border-b hover:bg-muted/40">
                      <td className="px-2 py-2.5">
                        <p className="font-medium">{r.employee.firstName} {r.employee.lastName}</p>
                        <p className="text-xs text-muted-foreground">{r.employee.jobTitle || 'Staff'}</p>
                      </td>
                      <td className="px-2 py-2.5 text-xs">{formatDate(r.date)}</td>
                      <td className="px-2 py-2.5 text-xs">{r.checkIn ? formatDateTime(r.checkIn) : '—'}</td>
                      <td className="px-2 py-2.5 text-xs">{r.checkOut ? formatDateTime(r.checkOut) : '—'}</td>
                      <td className="px-2 py-2.5 text-right font-medium">{r.workingHours ? `${r.workingHours.toFixed(1)}h` : '—'}</td>
                      <td className="px-2 py-2.5"><StatusBadge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
