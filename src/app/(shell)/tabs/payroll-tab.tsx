'use client';

/**
 * MBUMAH HARDWARE POS - Payroll & HR Tab
 *
 * Sub-tabs:
 *   1. Employees - HR directory with full CRUD + Kenyan statutory fields (KRA/NSSF/NHIF)
 *   2. Leave - Leave requests with approval workflow + leave-type catalog
 *   3. Pay Periods - Payroll cycle management (MONTHLY/WEEKLY/BI_WEEKLY)
 *   4. Pay Runs - Payroll execution with gross/deductions/net breakdown
 *   5. Attendance - Time tracking (clock in/out, hours, status)
 *
 * Backend APIs (all require Bearer + CSRF headers, return { success, data }):
 *   /api/employees, /api/leave-types, /api/leaves,
 *   /api/payroll/periods, /api/payroll/runs, /api/attendance
 *
 * CONTRACT NOTE (v2.30.0): GET /api/leaves and GET /api/attendance return
 * FLAT DTOs (employeeName / employeeJobTitle / leaveTypeName at the top
 * level — NO nested `employee` / `leaveType` objects). The Leave + Attendance
 * sub-tabs used to read the nested shape and crashed the whole tab on the
 * first row of data; the static contract test
 * src/tests/lib/payroll-tab-contracts.test.ts pins this. PUT /api/leaves
 * requires UPPERCASE actions ('APPROVE' | 'REJECT') and persists
 * rejectionReason on reject. Balance side-payloads ride outside `data`, so
 * that query uses apiFetchEnvelope.
 */

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Users, UserPlus, CalendarDays, CalendarRange, Wallet, Clock,
  Search, Plus, Edit, Eye, Check, X, AlertCircle, Loader2,
  Banknote, Phone, Mail, Briefcase,
  CheckCircle, XCircle, Clock3, FileText, User,
  IdCard, Building2, AlertTriangle, Calendar, PiggyBank, Play, UserX, Ban,
  CalendarPlus, UserCheck, Info,
  UserCog, Link2, Unlink, ShieldCheck,
} from 'lucide-react';

import { leaveTypeStyle, balanceTone, balanceUtilization, initialsOf, previewWorkingDays } from '@/lib/leave-tab';

import { useAppStore } from '@/lib/stores';
import { formatKES, formatDate, formatDateTime } from '@/lib/api';

// MONEY GUARD (v2.3.1): salary fields were typed as number in the contract but
// the API (before the v2.3.1 boundary fix) delivered Prisma Decimals as
// strings, so `+` concatenated them into 18-digit "salaries". toNum() makes
// every arithmetic site robust regardless of what the API returns.
function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}

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

// Types

type SubTab = 'employees' | 'leave' | 'periods' | 'runs' | 'attendance';

interface Employee {
  id: string;
  storeId: string;
  employeeCode: string | null;
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

// Matches the FLAT DTO returned by GET /api/leaves (employeeName/
// leaveTypeName at the top level — there is no nested `employee` object;
// reading one was the v2.29.x Payroll-tab crash).
interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeJobTitle: string | null;
  photoUrl: string | null;
  leaveTypeId: string;
  leaveTypeName: string;
  leaveTypeCode: string;
  isPaid: boolean;
  isStatutory: boolean;
  startDate: string;
  endDate: string;
  returnDate: string | null;
  workingDays: number;
  halfDay: boolean;
  status: string;
  reason: string | null;
  rejectionReason: string | null;
  approvedAt: string | null;
  emergencyContact: string | null;
  createdAt: string;
  /** v2.38.0: HR filer display name when entered on behalf (null = self-filed). */
  enteredByName?: string | null;
  /** v2.40.0: edit-window provenance (null = never corrected in place). */
  editedAt?: string | null;
  editedByName?: string | null;
  editNote?: string | null;
}

// Matches the per-employee balance rows returned as `balances` by
// GET /api/leaves?balances=true.
interface LeaveBalance {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  leaveTypeCode: string;
  leaveYear: number;
  allocatedDays: number;
  usedDays: number;
  pendingDays: number;
  carryForwardDays: number;
  encashedDays: number;
  availableDays: number;
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

// Matches the FLAT DTO returned by GET /api/attendance (employeeName at the
// top level — no nested `employee` object). Decimal columns (workingHours /
// overtimeHours / lateMinutes) serialize as STRINGS through Response.json —
// read them through toNum(), never .toFixed() them directly (the v2.30.0
// QA round caught `workingHours.toFixed is not a function` crashing the
// whole Payroll tab on the first attendance record).
interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeJobTitle: string | null;
  photoUrl: string | null;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  breakHours: number | string | null;
  workingHours: number | string | null;
  overtimeHours: number | string | null;
  lateMinutes: number | string | null;
  status: string;
  source: string | null;
  notes: string | null;
}

// API helper

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

// Like apiFetch but returns the FULL response envelope ({ success, data,
// ...sidePayloads }). Needed for endpoints that return more than `data` —
// GET /api/leaves?balances=true also carries `balances` + `leaveTypes`.
async function apiFetchEnvelope<T extends { success?: boolean }>(url: string, options?: RequestInit): Promise<T> {
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
  return json as T;
}

// Status badge helpers

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
  VOIDED: 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-900 line-through',
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

// Empty / Loading / Error states

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

// Stat Card

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

// MAIN COMPONENT

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
            Manage employees, leave, payroll runs, and attendance - Kenyan statutory compliance (PAYE, NSSF, SHIF, Housing Levy).
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

// 1. EMPLOYEES SUB-TAB

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
  // v2.39.0: governed portal-account linking — the dialog binds a portal User
  // to an Employee so personal leave/payroll bells actually reach someone.
  const [linkTarget, setLinkTarget] = useState<Employee | null>(null);

  const { data: employeesData, isLoading, error } = useQuery<Employee[]>({
    queryKey: ['payroll-employees', storeId],
    queryFn: () => apiFetch(`/api/employees?storeId=${storeId}`),
    enabled: !!storeId,
  });
  const employees = Array.isArray(employeesData) ? employeesData : [];

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

  // EMPLOYEE-CRUD FIX (2026-09-10): editing previously re-POSTed the form -
  // creating a DUPLICATE employee instead of updating the record (the old
  // comment admitted "editing would use PUT /api/employees/[id]", which did
  // not exist). Edits now PATCH /api/employees/[id]; termination (delete)
  // soft-deletes via DELETE /api/employees/[id] so payroll history survives.
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      apiFetch(`/api/employees/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    onSuccess: () => {
      toast.success('Employee updated successfully');
      qc.invalidateQueries({ queryKey: ['payroll-employees', storeId] });
      setDialogOpen(false);
      setEditingId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const terminateMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/employees/${id}`, { method: 'DELETE' }),
    onSuccess: (res: { message?: string; data?: { fullName?: string } }) => {
      toast.success(res?.message || 'Employee terminated - payroll history preserved');
      qc.invalidateQueries({ queryKey: ['payroll-employees', storeId] });
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
  // v2.39.0: portal-link coverage — how many of the directory's employees
  // actually receive in-app notifications today.
  const portalLinkedCount = employees.filter((e) => e.userId).length;
  // userIds currently bound to ANY employee — the picker greys these out
  // (1:1 is enforced server-side; this mirrors it client-side). Deps stay on
  // the raw query result (stable reference), not the conditional array.
  const linkedUserIds = useMemo(
    () =>
      new Set(
        (Array.isArray(employeesData) ? employeesData : [])
          .map((e) => e.userId)
          .filter(Boolean) as string[],
      ),
    [employeesData],
  );
  const monthlyPayroll = employees
    .filter((e) => e.status === 'ACTIVE')
    .reduce((sum, e) => sum + toNum(e.basicSalary) + toNum(e.houseAllowance) + toNum(e.transportAllowance) + toNum(e.medicalAllowance) + toNum(e.otherAllowances), 0);

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
    if (editingId) {
      // EMPLOYEE-CRUD FIX: real update via PATCH /api/employees/[id]
      // (storeId is immutable on the detail route - strip it from the payload).
      const patchBody: Record<string, unknown> = { ...payload };
      delete patchBody.storeId;
      updateMutation.mutate({ id: editingId, payload: patchBody });
    } else {
      createMutation.mutate(payload);
    }
  }

  function monthlyGross(e: Employee): number {
    return toNum(e.basicSalary) + toNum(e.houseAllowance) + toNum(e.transportAllowance) + toNum(e.medicalAllowance) + toNum(e.otherAllowances);
  }

  return (
    <div className="space-y-4">
      {/* Stats — v2.39.0 adds the portal-coverage card */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard icon={Users} label="Total Employees" value={employees.length} accent="border-l-blue-500" />
        <StatCard icon={CheckCircle} label="Active" value={activeCount} accent="border-l-green-500" />
        <StatCard icon={CalendarDays} label="On Leave" value={onLeaveCount} accent="border-l-amber-500" />
        <StatCard icon={Link2} label="Portal Linked" value={portalLinkedCount} accent="border-l-emerald-500" />
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
            {/* v2.39.0: notification-reach badge — linked vs total. */}
            <span
              className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900"
              title="Employees whose portal account is linked — they receive in-app leave and payroll notifications"
            >
              <Link2 className="h-3 w-3" aria-hidden /> {portalLinkedCount}/{employees.length} portal
            </span>
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
                    <th className="px-2 py-2 font-medium text-muted-foreground hidden xl:table-cell">Staff No.</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground hidden md:table-cell">Contact</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground hidden lg:table-cell">Type</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground hidden lg:table-cell">Hired</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-right">Monthly Gross</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground">Status</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground hidden xl:table-cell">Portal</th>
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
                      <td className="px-2 py-2.5 hidden xl:table-cell">
                        {e.employeeCode ? (
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground tracking-wide whitespace-nowrap">{e.employeeCode}</span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">-</span>
                        )}
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
                      {/* v2.39.0: portal-access column — who actually gets bells. */}
                      <td className="px-2 py-2.5 hidden xl:table-cell">
                        {e.user && e.userId ? (
                          <span
                            className="inline-flex max-w-40 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900"
                            title={`Portal account: ${e.user.email}`}
                          >
                            <UserCheck className="h-3 w-3 shrink-0" aria-hidden />
                            <span className="truncate">{e.user.email}</span>
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border"
                            title="No portal account linked — this employee cannot receive in-app notifications"
                          >
                            <Unlink className="h-3 w-3" aria-hidden /> No portal
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDetailEmployee(e)} title="View">
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(e)} title="Edit">
                            <Edit className="h-4 w-4" />
                          </Button>
                          {/* v2.39.0: governed link/unlink of the portal account. */}
                          <Button
                            size="icon"
                            variant="ghost"
                            className={`h-8 w-8 ${e.userId ? 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10' : 'text-muted-foreground hover:text-foreground'}`}
                            onClick={() => setLinkTarget(e)}
                            title={e.userId ? 'Manage portal account link' : 'Link portal account'}
                            aria-label={`${e.userId ? 'Manage' : 'Link'} portal account for ${e.fullName}`}
                          >
                            <UserCog className="h-4 w-4" />
                          </Button>
                          {e.status !== 'TERMINATED' && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                              disabled={terminateMutation.isPending}
                              onClick={() => {
                                if (window.confirm(`Terminate ${e.fullName}? Their record and payroll history are kept (status becomes TERMINATED).`)) {
                                  terminateMutation.mutate(e.id);
                                }
                              }}
                              title="Terminate (soft delete)"
                            >
                              {terminateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserX className="h-4 w-4" />}
                            </Button>
                          )}
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

      {/* v2.39.0: governed portal-account link dialog */}
      <PortalLinkDialog
        open={!!linkTarget}
        employee={linkTarget}
        storeId={storeId}
        linkedUserIds={linkedUserIds}
        onClose={() => setLinkTarget(null)}
      />
    </div>
  );
}

// v2.39.0: Portal Account Linking Dialog — binds a portal User to an
// Employee through POST/DELETE /api/employees/[id]/portal-link. The leave
// lifecycle (decision fan-out, on-behalf bells) resolves this link at fire
// time, so linking is what turns "HR filed for me" into an actual bell row.
function PortalLinkDialog({ open, employee, storeId, linkedUserIds, onClose }: {
  open: boolean;
  employee: Employee | null;
  storeId: string;
  linkedUserIds: Set<string>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [pickUserId, setPickUserId] = useState('');
  const [userSearch, setUserSearch] = useState('');

  const { data: usersEnv, isLoading: usersLoading } = useQuery<
    Array<{ id: string; name: string; email: string; role: string; isActive: boolean; store?: { name: string } | null }>
  >({
    queryKey: ['portal-link-users', storeId],
    queryFn: () => apiFetch(`/api/users?storeId=${storeId}&isActive=true&limit=200`),
    enabled: open && !!employee && !employee.userId,
  });
  const allUsers = Array.isArray(usersEnv) ? usersEnv : [];

  const candidates = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return (Array.isArray(usersEnv) ? usersEnv : []).filter((u) => {
      if (linkedUserIds.has(u.id) && u.id !== employee?.userId) return false;
      if (!q) return true;
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q);
    });
  }, [usersEnv, linkedUserIds, userSearch, employee?.userId]);

  const linkMutation = useMutation({
    mutationFn: async (userId: string): Promise<{ message?: string }> =>
      apiFetch(`/api/employees/${employee?.id}/portal-link`, { method: 'POST', body: JSON.stringify({ userId }) }),
    onSuccess: (res: { message?: string }) => {
      toast.success(res?.message || 'Portal account linked');
      qc.invalidateQueries({ queryKey: ['payroll-employees', storeId] });
      qc.invalidateQueries({ queryKey: ['payroll-leave-roster', storeId] });
      setPickUserId('');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unlinkMutation = useMutation({
    mutationFn: async (): Promise<{ message?: string }> => apiFetch(`/api/employees/${employee?.id}/portal-link`, { method: 'DELETE' }),
    onSuccess: (res: { message?: string }) => {
      toast.success(res?.message || 'Portal account unlinked');
      qc.invalidateQueries({ queryKey: ['payroll-employees', storeId] });
      qc.invalidateQueries({ queryKey: ['payroll-leave-roster', storeId] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = linkMutation.isPending || unlinkMutation.isPending;

  function handleUnlink() {
    if (!employee?.user) return;
    if (window.confirm(`Unlink ${employee.user.email} from ${employee.fullName}? They will stop receiving in-app leave and payroll notifications.`)) {
      unlinkMutation.mutate();
    }
  }

  const roleTone = (role: string): string =>
    role === 'SUPER_ADMIN' || role === 'STORE_OWNER'
      ? 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900'
      : role === 'BRANCH_MANAGER' || role === 'HR_MANAGER'
        ? 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900'
        : 'bg-muted text-muted-foreground ring-border';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <UserCog className="h-4 w-4 text-emerald-600" aria-hidden /> Portal account
          </DialogTitle>
          <DialogDescription>
            {employee
              ? <>Bind a login to <span className="font-medium text-foreground">{employee.fullName}</span> — linked accounts receive personal leave and payroll notifications in the app.</>
              : 'Bind a login to this employee.'}
          </DialogDescription>
        </DialogHeader>

        {employee && (
          <div className="space-y-3.5">
            {/* Current binding */}
            {employee.user && employee.userId ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
                      <ShieldCheck className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{employee.user.name || employee.user.email}</p>
                      <p className="truncate text-xs text-muted-foreground">{employee.user.email}</p>
                    </div>
                    <Badge variant="outline" className={`ml-1 shrink-0 text-[10px] ring-1 ${roleTone(employee.user.role)}`}>
                      {employee.user.role.replace('_', ' ')}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={handleUnlink}
                    className="h-8 shrink-0 gap-1.5 border-rose-200 px-2.5 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40"
                  >
                    {unlinkMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" aria-hidden />}
                    Unlink
                  </Button>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-emerald-800/80 dark:text-emerald-300/80">
                  This account gets a bell row whenever leave is filed for, decided on, or cancelled for {employee.firstName} — plus payroll run notifications.
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                  <span className="font-semibold">Not linked.</span> Without a linked account this employee never sees in-app notifications — HR filings on their behalf are silent for them (email still goes out if an address is on file).
                </div>

                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search active users by name, email or role..."
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      className="pl-9 h-9"
                    />
                  </div>

                  {usersLoading ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading users…
                    </div>
                  ) : candidates.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                      {allUsers.length === 0
                        ? 'No active users found for this store. Create user accounts first (Settings → Users).'
                        : 'Every active user in this store already has an employee record. Unlink one first, or create a new user.'}
                    </div>
                  ) : (
                    <div className="max-h-56 space-y-1.5 overflow-y-auto custom-scrollbar pr-1" role="listbox" aria-label="Candidate portal users">
                      {candidates.map((u) => {
                        const selected = pickUserId === u.id;
                        return (
                          <button
                            key={u.id}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onClick={() => setPickUserId(selected ? '' : u.id)}
                            className={`flex w-full items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${
                              selected
                                ? 'border-violet-400 bg-violet-50 ring-1 ring-violet-300 dark:border-violet-700 dark:bg-violet-950/40 dark:ring-violet-800'
                                : 'border-border hover:bg-muted/50'
                            }`}
                          >
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
                                {initialsOf(u.name || u.email)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{u.name}</p>
                              <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                            </div>
                            <Badge variant="outline" className={`shrink-0 text-[10px] ring-1 ${roleTone(u.role)}`}>
                              {u.role.replace('_', ' ')}
                            </Badge>
                            {selected && <Check className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Close</Button>
          {!employee?.userId && (
            <Button
              size="sm"
              disabled={!pickUserId || busy}
              onClick={() => linkMutation.mutate(pickUserId)}
              className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {linkMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" aria-hidden />}
              Link account
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Employee Form Dialog

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
              <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => upd({ email: e.target.value })} placeholder="john@mbumahhardware.co.ke" /></div>
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

// Employee Detail Dialog

function EmployeeDetailDialog({ employee, onClose }: { employee: Employee | null; onClose: () => void }) {
  if (!employee) return null;
  const monthlyGross = toNum(employee.basicSalary) + toNum(employee.houseAllowance) + toNum(employee.transportAllowance) + toNum(employee.medicalAllowance) + toNum(employee.otherAllowances);
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
              <div className="flex items-center gap-1.5 flex-wrap">
                {employee.fullName}
                {employee.employeeCode && (
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground tracking-wide">{employee.employeeCode}</span>
                )}
              </div>
              <DialogDescription>{employee.jobTitle || 'No title'} · <EmploymentTypeBadge type={employee.employmentType} /></DialogDescription>
            </div>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <DetailItem icon={Mail} label="Email" value={employee.email || '-'} />
            <DetailItem icon={Phone} label="Phone" value={employee.phone || '-'} />
            <DetailItem icon={IdCard} label="National ID" value={employee.nationalId || '-'} />
            <DetailItem icon={FileText} label="KRA PIN" value={employee.kraPin || '-'} />
            <DetailItem icon={PiggyBank} label="NSSF No." value={employee.nssfNumber || '-'} />
            <DetailItem icon={AlertCircle} label="SHIF/NHIF No." value={employee.nhifNumber || '-'} />
            <DetailItem icon={Calendar} label="Hire Date" value={formatDate(employee.hireDate)} />
            <DetailItem icon={Briefcase} label="Status" value={<StatusBadge status={employee.status} />} />
          </div>
          <Separator />
          <div>
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Banknote className="h-4 w-4" /> Compensation</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <DetailItem label="Basic Salary" value={formatKES(toNum(employee.basicSalary))} />
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
                  <DetailItem label="Account Name" value={employee.bankAccountName || '-'} />
                  <DetailItem label="Account No." value={employee.bankAccountNumber || '-'} />
                  <DetailItem label="Branch Code" value={employee.bankBranchCode || '-'} />
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

// 2. LEAVE SUB-TAB

function LeaveSubTab({ storeId }: { storeId: string }) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [detail, setDetail] = useState<LeaveRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [cancelTarget, setCancelTarget] = useState<LeaveRequest | null>(null);

  // v2.38.0: on-behalf filing dialog state.
  const [newOpen, setNewOpen] = useState(false);
  const [newEmployeeId, setNewEmployeeId] = useState('');
  const [newTypeId, setNewTypeId] = useState('');
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const [newHalfDay, setNewHalfDay] = useState(false);
  const [newReason, setNewReason] = useState('');

  // v2.40.0: edit-window state — the correction dialog for PENDING requests
  // (dates / half-day / type / reason / emergency contact / note-to-employee).
  const [editTarget, setEditTarget] = useState<LeaveRequest | null>(null);
  const [editTypeId, setEditTypeId] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editHalfDay, setEditHalfDay] = useState(false);
  const [editReason, setEditReason] = useState('');
  const [editEmergency, setEditEmergency] = useState('');
  const [editNote, setEditNote] = useState('');

  // GET /api/leaves returns { success, data: [...], balances?: [...],
  // leaveTypes: [...] } — apiFetch would drop the side payloads, so this
  // query uses apiFetchEnvelope to also read the per-employee balances.
  const { data: leavesEnvelope, isLoading, error } = useQuery({
    queryKey: ['payroll-leaves', storeId],
    queryFn: () =>
      apiFetchEnvelope<{ success: boolean; data: LeaveRequest[]; balances?: LeaveBalance[] }>(
        `/api/leaves?storeId=${storeId}&balances=true`,
      ),
    enabled: !!storeId,
  });
  const leaves = Array.isArray(leavesEnvelope?.data) ? leavesEnvelope.data : [];
  const balances = Array.isArray(leavesEnvelope?.balances) ? leavesEnvelope.balances : [];

  const { data: leaveTypesData } = useQuery<LeaveType[]>({
    queryKey: ['payroll-leave-types'],
    queryFn: () => apiFetch('/api/leave-types'),
  });
  const leaveTypes = Array.isArray(leaveTypesData) ? leaveTypesData : [];

  // v2.38.0: roster for the on-behalf picker — ACTIVE employees of the
  // store, loaded only while the dialog is open. v2.39.0 also carries the
  // portal-link state so the dialog can warn when a bell row will NOT fire.
  const { data: rosterEnv, isLoading: rosterLoading } = useQuery({
    queryKey: ['payroll-leave-roster', storeId],
    queryFn: () =>
      apiFetchEnvelope<{ success: boolean; data: Array<{ id: string; firstName: string; lastName: string; jobTitle: string | null; employeeCode: string | null; userId: string | null }> }>(
        `/api/employees?storeId=${storeId}&status=ACTIVE&limit=500`,
      ),
    enabled: newOpen && !!storeId,
  });
  const roster = Array.isArray(rosterEnv?.data) ? rosterEnv.data : [];
  const rosterLinkState = useMemo(
    () => new Map((Array.isArray(rosterEnv?.data) ? rosterEnv.data : []).map((r) => [r.id, r.userId])),
    [rosterEnv],
  );

  // v2.38.0: live balance preview for the picked employee — the governed
  // /api/leave/balances read (same figure the portal and the service guard
  // use), so the dialog shows EXACTLY what the server will enforce.
  // v2.40.0: the same read now feeds BOTH dialogs — whichever surface is
  // active (edit window first, then the on-behalf filing dialog).
  const activePreviewEmployeeId = editTarget?.employeeId ?? newEmployeeId;
  const { data: previewEnv, isLoading: previewLoading } = useQuery({
    queryKey: ['payroll-leave-balance-preview', activePreviewEmployeeId],
    queryFn: () =>
      apiFetchEnvelope<{ success: boolean; data: Array<{ leaveTypeId: string; allocatedDays: unknown; carryForwardDays: unknown; usedDays: unknown; pendingDays: unknown }> }>(
        `/api/leave/balances?employeeId=${activePreviewEmployeeId}`,
      ),
    enabled: (!!editTarget && !!activePreviewEmployeeId) || (newOpen && !!newEmployeeId),
  });
  const previewBalances = Array.isArray(previewEnv?.data) ? previewEnv.data : [];
  const previewRow = previewBalances.find((b) => b.leaveTypeId === (editTarget ? editTypeId : newTypeId));
  const previewEntitlement = previewRow ? toNum(previewRow.allocatedDays) + toNum(previewRow.carryForwardDays) : null;
  // v2.40.0: inside the edit window the request's OWN pending days count as
  // headroom when the leave type is unchanged — they are re-reserved on
  // save (the recompute rewrites pendingDays from the request table).
  const editSelfHeadroom =
    editTarget && previewRow && previewRow.leaveTypeId === editTarget.leaveTypeId ? toNum(editTarget.workingDays) : 0;
  const previewAvailable =
    previewRow && previewEntitlement !== null
      ? previewEntitlement - toNum(previewRow.usedDays) - toNum(previewRow.pendingDays) + editSelfHeadroom
      : null;
  const previewDays = editTarget
    ? previewWorkingDays(editStart, editEnd, editHalfDay)
    : previewWorkingDays(newStart, newEnd, newHalfDay);
  const previewInsufficient = previewAvailable !== null && previewDays > previewAvailable;
  const newFormReady =
    !editTarget && !!newEmployeeId && !!newTypeId && previewDays > 0 && !!newStart && newStart <= newEnd && !previewInsufficient;
  // v2.40.0: the correction is submittable only when something actually
  // changed (no-op saves would ping the employee for nothing) and the
  // corrected range fits the balance.
  const editChanged =
    !!editTarget &&
    (editTypeId !== editTarget.leaveTypeId ||
      editStart !== editTarget.startDate.slice(0, 10) ||
      editEnd !== editTarget.endDate.slice(0, 10) ||
      editHalfDay !== editTarget.halfDay ||
      editReason !== (editTarget.reason ?? '') ||
      (editEmergency || '') !== (editTarget.emergencyContact ?? '') ||
      editNote.trim().length > 0);
  const editFormReady =
    !!editTarget && editChanged && previewDays > 0 && !!editStart && editStart <= editEnd && !previewInsufficient;

  // PUT /api/leaves requires UPPERCASE actions ('APPROVE' | 'REJECT' |
  // 'CANCEL') — the lowercase values this tab used to send were rejected
  // with 400. v2.33.0 adds CANCEL (manager cancels a pending or approved
  // request; the employee's balance is recomputed and the employee is
  // notified with a violet Cancelled bell row).
  const actionMutation = useMutation({
    mutationFn: ({ action, leaveRequestId, rejectionReason }: { action: 'APPROVE' | 'REJECT' | 'CANCEL'; leaveRequestId: string; rejectionReason?: string }) =>
      apiFetch('/api/leaves', { method: 'PUT', body: JSON.stringify({ action, leaveRequestId, rejectionReason }) }),
    onSuccess: (_data, vars) => {
      toast.success(
        vars.action === 'APPROVE' ? 'Leave request approved — balance updated' :
        vars.action === 'CANCEL' ? 'Leave request cancelled — days returned to the balance and the employee notified' :
        'Leave request rejected',
      );
      qc.invalidateQueries({ queryKey: ['payroll-leaves', storeId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = leaves.filter((l) => statusFilter === 'ALL' || l.status === statusFilter);
  const pendingCount = leaves.filter((l) => l.status === 'PENDING').length;
  const approvedCount = leaves.filter((l) => l.status === 'APPROVED').length;
  const pendingDays = leaves.filter((l) => l.status === 'PENDING').reduce((s, l) => s + toNum(l.workingDays), 0);

  const openReject = (l: LeaveRequest) => {
    setRejectReason('');
    setRejectTarget(l);
  };

  // v2.33.0: manager cancel — confirm first (cancelling an APPROVED request
  // takes leave away the employee may already be planning around).
  const confirmCancel = () => {
    if (!cancelTarget) return;
    actionMutation.mutate(
      { action: 'CANCEL', leaveRequestId: cancelTarget.id },
      { onSuccess: () => setCancelTarget(null) },
    );
  };

  const confirmReject = () => {
    if (!rejectTarget || !rejectReason.trim()) return;
    actionMutation.mutate(
      { action: 'REJECT', leaveRequestId: rejectTarget.id, rejectionReason: rejectReason.trim() },
      { onSuccess: () => { setRejectTarget(null); } },
    );
  };

  // v2.38.0: on-behalf submission — POST /api/leaves now runs through the
  // governed service path; the response 403s for non-decision-capable
  // filers targeting a colleague and 400s INSUFFICIENT_BALANCE (mirrored
  // client-side by the disabled submit + rose preview above).
  const newRequestMutation = useMutation({
    mutationFn: (payload: { employeeId: string; leaveTypeId: string; startDate: string; endDate: string; halfDay: boolean; reason?: string }) =>
      apiFetch('/api/leaves', { method: 'POST', body: JSON.stringify({ storeId, ...payload }) }),
    onSuccess: (_data, vars) => {
      const who = roster.find((r) => r.id === vars.employeeId);
      toast.success(`Leave request filed for ${who ? `${who.firstName} ${who.lastName}` : 'the employee'} — they have been notified`);
      setNewOpen(false);
      setNewEmployeeId('');
      setNewTypeId('');
      setNewStart('');
      setNewEnd('');
      setNewHalfDay(false);
      setNewReason('');
      qc.invalidateQueries({ queryKey: ['payroll-leaves', storeId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openNewRequest = () => {
    setNewEmployeeId('');
    setNewTypeId('');
    setNewStart('');
    setNewEnd('');
    setNewHalfDay(false);
    setNewReason('');
    setNewOpen(true);
  };

  // v2.40.0: open the correction window on a PENDING request — prefilled
  // with the stored values so the manager edits exactly what is on file.
  const openEdit = (l: LeaveRequest) => {
    setEditTypeId(l.leaveTypeId);
    setEditStart(l.startDate.slice(0, 10));
    setEditEnd(l.endDate.slice(0, 10));
    setEditHalfDay(l.halfDay);
    setEditReason(l.reason ?? '');
    setEditEmergency(l.emergencyContact ?? '');
    setEditNote('');
    setEditTarget(l);
  };

  // v2.40.0: save the correction — PUT action EDIT. The server recomputes
  // working days, re-guards the balance (the request's own pending days are
  // headroom when the type is unchanged), stamps the provenance columns and
  // notifies the employee with the before → after summary.
  const editMutation = useMutation({
    mutationFn: (payload: {
      leaveRequestId: string;
      leaveTypeId: string;
      startDate: string;
      endDate: string;
      halfDay: boolean;
      reason: string;
      emergencyContact: string | null;
      editNote: string | null;
      employeeName: string;
    }) =>
      apiFetch('/api/leaves', {
        method: 'PUT',
        body: JSON.stringify({
          action: 'EDIT',
          leaveRequestId: payload.leaveRequestId,
          leaveTypeId: payload.leaveTypeId,
          startDate: payload.startDate,
          endDate: payload.endDate,
          halfDay: payload.halfDay,
          reason: payload.reason,
          emergencyContact: payload.emergencyContact,
          editNote: payload.editNote,
        }),
      }),
    onSuccess: (_data, vars) => {
      toast.success(`Request corrected — ${vars.employeeName} has been notified with the changes`);
      setEditTarget(null);
      qc.invalidateQueries({ queryKey: ['payroll-leaves', storeId] });
      qc.invalidateQueries({ queryKey: ['payroll-leave-balance-preview'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmEdit = () => {
    if (!editTarget || !editFormReady) return;
    editMutation.mutate({
      leaveRequestId: editTarget.id,
      leaveTypeId: editTypeId,
      startDate: new Date(`${editStart}T00:00:00.000Z`).toISOString(),
      endDate: new Date(`${editEnd}T00:00:00.000Z`).toISOString(),
      halfDay: editHalfDay,
      reason: editReason.trim(),
      emergencyContact: editEmergency.trim() || null,
      editNote: editNote.trim() || null,
      employeeName: editTarget.employeeName,
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={CalendarDays} label="Total Requests" value={leaves.length} accent="border-l-blue-500" />
        <StatCard icon={Clock3} label="Pending" value={pendingCount} accent="border-l-amber-500" />
        <StatCard icon={CheckCircle} label="Approved" value={approvedCount} accent="border-l-green-500" />
        <StatCard icon={Clock} label="Days Pending" value={pendingDays % 1 === 0 ? pendingDays : pendingDays.toFixed(1)} accent="border-l-purple-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Leave Requests - 2/3 width */}
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarDays className="h-4 w-4" /> Leave Requests
              </CardTitle>
              <div className="flex items-center gap-2">
                {/* v2.38.0: file a request ON BEHALF of an employee — the
                    walk-up / phone-in path. The employee is notified and
                    every surface marks the request "Entered by HR". */}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 border-violet-300 px-2.5 text-xs text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/40"
                  onClick={openNewRequest}
                >
                  <CalendarPlus className="h-3.5 w-3.5" aria-hidden /> New request
                </Button>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All</SelectItem>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="APPROVED">Approved</SelectItem>
                    <SelectItem value="REJECTED">Rejected</SelectItem>
                    <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
                    {filtered.map((l) => {
                      const statusRail =
                        l.status === 'PENDING' ? 'border-l-2 border-l-amber-400' :
                        l.status === 'APPROVED' ? 'border-l-2 border-l-green-500' :
                        l.status === 'REJECTED' ? 'border-l-2 border-l-red-400' : 'border-l-2 border-l-transparent';
                      return (
                        <tr key={l.id} className={`border-b hover:bg-muted/40 transition-colors ${statusRail}`}>
                          <td className="px-2 py-2.5">
                            <div className="flex items-center gap-2">
                              <Avatar className="h-7 w-7">
                                <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
                                  {initialsOf(l.employeeName)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="font-medium truncate">{l.employeeName}</p>
                                <p className="text-xs text-muted-foreground truncate">{l.employeeJobTitle || 'Staff'}</p>
                                {/* v2.38.0: HR-filer marker — the approvals
                                    desk can always tell entered-for requests
                                    from self-filed ones. */}
                                {l.enteredByName ? (
                                  <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-violet-50 px-1.5 py-px text-[10px] font-semibold text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900">
                                    <UserCheck className="h-2.5 w-2.5" aria-hidden /> HR · {l.enteredByName}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-2.5 hidden sm:table-cell">
                            <Badge variant="outline" className={`text-xs ${leaveTypeStyle(l.leaveTypeCode)}`}>
                              {l.leaveTypeName}
                            </Badge>
                            {l.halfDay && <p className="text-[10px] text-muted-foreground mt-0.5">half day</p>}
                            {/* v2.40.0: at-a-glance correction marker — rows
                                edited in place stay PENDING, so the amber
                                chip is what tells the desk they changed. */}
                            {l.editedByName ? (
                              <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-0.5" title={`Corrected by ${l.editedByName}`}>
                                <Edit className="h-2.5 w-2.5" aria-hidden /> corrected
                              </p>
                            ) : null}
                          </td>
                          <td className="px-2 py-2.5">
                            <p className="text-xs tabular-nums">{formatDate(l.startDate)} → {formatDate(l.endDate)}</p>
                            <p className="text-xs text-muted-foreground tabular-nums">
                              {toNum(l.workingDays) % 1 === 0 ? toNum(l.workingDays) : toNum(l.workingDays).toFixed(1)} day(s)
                              {l.status === 'REJECTED' && l.rejectionReason ? ' · reason given' : ''}
                            </p>
                          </td>
                          <td className="px-2 py-2.5">
                            <StatusBadge status={l.status} />
                            {l.status === 'REJECTED' && l.rejectionReason && (
                              <p className="text-[10px] text-muted-foreground mt-1 max-w-32 truncate" title={l.rejectionReason}>
                                {l.rejectionReason}
                              </p>
                            )}
                          </td>
                          <td className="px-2 py-2.5">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                                title="View details"
                                aria-label={`View details for ${l.employeeName}`}
                                onClick={() => setDetail(l)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              {l.status === 'PENDING' ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-500/10"
                                    title="Approve request"
                                    aria-label={`Approve leave for ${l.employeeName}`}
                                    onClick={() => actionMutation.mutate({ action: 'APPROVE', leaveRequestId: l.id })}
                                    disabled={actionMutation.isPending}
                                  >
                                    {actionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-500/10"
                                    title="Reject request (reason required)"
                                    aria-label={`Reject leave for ${l.employeeName}`}
                                    onClick={() => openReject(l)}
                                    disabled={actionMutation.isPending}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                  {/* v2.40.0: correct a pending request in
                                      place — fix dates / type / reason
                                      without the cancel+refile dance; the
                                      employee is told with a before →
                                      after summary. */}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 text-amber-600 hover:text-amber-700 hover:bg-amber-500/10"
                                    title="Correct request — fix dates, type or reason without cancelling"
                                    aria-label={`Correct leave for ${l.employeeName}`}
                                    onClick={() => openEdit(l)}
                                    disabled={editMutation.isPending}
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  {/* v2.33.0: managers may cancel a pending
                                      request (slot freed, employee notified). */}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 text-violet-600 hover:text-violet-700 hover:bg-violet-500/10"
                                    title="Cancel request — days return to the balance and the employee is notified"
                                    aria-label={`Cancel leave for ${l.employeeName}`}
                                    onClick={() => setCancelTarget(l)}
                                    disabled={actionMutation.isPending}
                                  >
                                    <Ban className="h-4 w-4" />
                                  </Button>
                                </>
                              ) : l.status === 'APPROVED' ? (
                                /* v2.33.0: an approved request can still be
                                    cancelled (plans change) — same confirm
                                    dialog, stronger copy for the taken-away
                                    leave case. */
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0 text-violet-600 hover:text-violet-700 hover:bg-violet-500/10"
                                  title="Cancel approved leave — the employee is notified"
                                  aria-label={`Cancel approved leave for ${l.employeeName}`}
                                  onClick={() => setCancelTarget(l)}
                                  disabled={actionMutation.isPending}
                                >
                                  <Ban className="h-4 w-4" />
                                </Button>
                              ) : (
                                <span className="text-xs text-muted-foreground px-2">—</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Balances + Leave Types - 1/3 width */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <PiggyBank className="h-4 w-4" /> Balances {new Date().getUTCFullYear()}
              </CardTitle>
              <CardDescription className="text-xs">Entitlement usage per employee &amp; type</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar">
                {balances.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No balances provisioned for {new Date().getUTCFullYear()} yet.
                  </p>
                ) : (
                  balances.map((b) => {
                    const tone = balanceTone(toNum(b.usedDays), toNum(b.allocatedDays), toNum(b.carryForwardDays));
                    const util = balanceUtilization(toNum(b.usedDays), toNum(b.allocatedDays), toNum(b.carryForwardDays));
                    const pct = Math.round(util * 100);
                    return (
                      <div key={b.id} className="rounded-lg border p-2.5 space-y-1.5 hover:border-border/80 hover:bg-muted/30 transition-colors">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium truncate">{b.employeeName}</p>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{b.leaveTypeCode}</Badge>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11px] tabular-nums">
                          <span className="text-muted-foreground">
                            {toNum(b.availableDays) % 1 === 0 ? toNum(b.availableDays) : toNum(b.availableDays).toFixed(1)} of{' '}
                            {(toNum(b.allocatedDays) + toNum(b.carryForwardDays)) % 1 === 0
                              ? toNum(b.allocatedDays) + toNum(b.carryForwardDays)
                              : (toNum(b.allocatedDays) + toNum(b.carryForwardDays)).toFixed(1)} d available
                          </span>
                          <span className={tone.text}>{pct}% used</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden" role="presentation">
                          <div className={`h-full rounded-full transition-all ${tone.bar}`} style={{ width: `${Math.max(pct, util > 0 ? 4 : 0)}%` }} />
                        </div>
                        {toNum(b.pendingDays) > 0 && (
                          <p className="text-[10px] text-amber-600 dark:text-amber-400 tabular-nums">
                            {toNum(b.pendingDays)} d pending approval
                          </p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" /> Leave Types
              </CardTitle>
              <CardDescription className="text-xs">Organisation-wide leave policy</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar">
                {leaveTypes.map((lt) => (
                  <div key={lt.id} className="rounded-lg border p-3 space-y-1.5 hover:bg-muted/30 transition-colors">
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

      {/* Request details dialog */}
      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                  {detail ? initialsOf(detail.employeeName) : '?'}
                </AvatarFallback>
              </Avatar>
              <span>Leave request</span>
            </DialogTitle>
            <DialogDescription>
              {detail ? `${detail.employeeName} · ${detail.employeeJobTitle || 'Staff'}` : ''}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <DetailField label="Type" value={detail.leaveTypeName} hint={detail.leaveTypeCode} />
                <DetailField label="Status" value={detail.status} />
                <DetailField label="From" value={formatDate(detail.startDate)} />
                <DetailField label="To" value={formatDate(detail.endDate)} />
                <DetailField label="Working days" value={toNum(detail.workingDays) % 1 === 0 ? String(toNum(detail.workingDays)) : toNum(detail.workingDays).toFixed(1)} />
                <DetailField label="Paid" value={detail.isPaid ? 'Yes' : 'Unpaid'} />
                {detail.halfDay && <DetailField label="Half day" value="Yes" />}
                {detail.returnDate && <DetailField label="Expected return" value={formatDate(detail.returnDate)} />}
                {/* v2.38.0: who actually entered this request. */}
                {detail.enteredByName && (
                  <div className="col-span-2 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-2 dark:border-violet-900 dark:bg-violet-950/30">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
                      <UserCheck className="h-3.5 w-3.5" aria-hidden /> Entered by HR · {detail.enteredByName}
                    </p>
                    <p className="mt-0.5 text-[11px] text-violet-600/80 dark:text-violet-400/80">
                      The employee was notified when this request was filed on their behalf.
                    </p>
                  </div>
                )}
              </div>
              {detail.reason && (
                <div className="rounded-lg border bg-muted/30 p-2.5">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Employee&apos;s reason</p>
                  <p className="text-sm whitespace-pre-wrap break-words">{detail.reason}</p>
                </div>
              )}
              {detail.rejectionReason && (
                <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-2.5">
                  <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">Rejection reason</p>
                  <p className="text-sm whitespace-pre-wrap break-words">{detail.rejectionReason}</p>
                </div>
              )}
              {detail.emergencyContact && (
                <DetailField label="Emergency contact during leave" value={detail.emergencyContact} />
              )}
              {/* v2.40.0: correction provenance — who fixed it, when, and
                  (optionally) why, straight from the edit-window stamp. */}
              {detail.editedByName && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-2.5">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-1 flex items-center gap-1">
                    <Edit className="h-3 w-3" aria-hidden /> Corrected by HR · {detail.editedByName}
                    {detail.editedAt ? <span className="font-normal text-amber-600/80 dark:text-amber-400/80">· {formatDateTime(detail.editedAt)}</span> : null}
                  </p>
                  {detail.editNote ? <p className="text-sm whitespace-pre-wrap break-words">{detail.editNote}</p> : <p className="text-xs text-muted-foreground">Values were corrected in place — see the dates and days on this dialog.</p>}
                </div>
              )}
              {detail.approvedAt && (
                <p className="text-xs text-muted-foreground">Decided {formatDateTime(detail.approvedAt)}</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>
            {detail && (detail.status === 'PENDING' || detail.status === 'APPROVED') && (
              <Button
                variant="outline"
                className="text-violet-600 hover:text-violet-700 hover:bg-violet-500/10"
                disabled={actionMutation.isPending}
                onClick={() => { const target = detail; setDetail(null); setCancelTarget(target); }}
              >
                <Ban className="h-4 w-4 mr-1.5" /> Cancel request
              </Button>
            )}
            {detail && detail.status === 'PENDING' && (
              <>
                <Button
                  variant="outline"
                  className="text-red-600 hover:text-red-700 hover:bg-red-500/10"
                  disabled={actionMutation.isPending}
                  onClick={() => { const target = detail; setDetail(null); openReject(target); }}
                >
                  <X className="h-4 w-4 mr-1.5" /> Reject
                </Button>
                <Button
                  className="bg-green-600 hover:bg-green-700 text-white"
                  disabled={actionMutation.isPending}
                  onClick={() => actionMutation.mutate({ action: 'APPROVE', leaveRequestId: detail.id }, { onSuccess: () => setDetail(null) })}
                >
                  <Check className="h-4 w-4 mr-1.5" /> Approve
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject-reason dialog — the API persists rejectionReason; managers
          must state it so the employee sees WHY (shown on rejected rows). */}
      <Dialog open={!!rejectTarget} onOpenChange={(v) => !v && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject leave request</DialogTitle>
            <DialogDescription>
              {rejectTarget
                ? `${rejectTarget.employeeName} · ${rejectTarget.leaveTypeName} · ${formatDate(rejectTarget.startDate)} → ${formatDate(rejectTarget.endDate)}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="reject-reason">Reason (required)</Label>
              <Textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Year-end stock take — annual leave is frozen for that week."
                rows={3}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                The employee sees this reason next to the rejected request in their portal.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={actionMutation.isPending}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={actionMutation.isPending || !rejectReason.trim()}
              onClick={confirmReject}
            >
              {actionMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <X className="h-4 w-4 mr-1.5" />}
              Reject request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* v2.33.0: Cancel-confirm dialog — cancelling (unlike rejecting) has
          no reason field by design; the copy states the consequences: the
          balance heals via the aggregate recompute and BOTH sides hear about
          it (employee bell row for manager cancels, approvals group for
          self-withdrawals). Stronger wording when the target was APPROVED —
          the employee may already be planning around that leave. */}
      <Dialog open={!!cancelTarget} onOpenChange={(v) => !v && setCancelTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="h-4 w-4 text-violet-600" /> Cancel leave request
            </DialogTitle>
            <DialogDescription>
              {cancelTarget
                ? `${cancelTarget.employeeName} · ${cancelTarget.leaveTypeName} · ${formatDate(cancelTarget.startDate)} → ${formatDate(cancelTarget.endDate)}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-violet-200 dark:border-violet-900 bg-violet-50 dark:bg-violet-950/30 p-3 space-y-1.5">
            <p className="text-sm text-foreground">
              {cancelTarget?.status === 'APPROVED'
                ? 'This leave is APPROVED — cancelling takes it back. Only cancel if plans genuinely changed.'
                : 'This pending request will be withdrawn without a decision.'}
            </p>
            <ul className="text-xs text-muted-foreground space-y-0.5 list-disc pl-4">
              <li>The {toNum(cancelTarget?.workingDays ?? 0)} day(s) return to the employee&apos;s available balance immediately.</li>
              <li>The employee is notified with a Cancelled bell row in their portal.</li>
              <li>The request stays on this desk, marked Cancelled, for the audit trail.</li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={actionMutation.isPending}>Keep request</Button>
            <Button
              disabled={actionMutation.isPending}
              className="bg-violet-600 hover:bg-violet-700 text-white"
              onClick={confirmCancel}
            >
              {actionMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Ban className="h-4 w-4 mr-1.5" />}
              Cancel request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* v2.40.0: the correction window — edit a PENDING request in place
          instead of the lossy cancel + refile dance. Amber governance
          styling (the correction color); the dialog previews the recomputed
          working days against the governed balance figure, shows the
          before → after delta, and the save is disabled until something
          actually changed and the range fits. The employee always gets the
          before → after summary (bell row + email) with the optional note. */}
      <Dialog open={!!editTarget} onOpenChange={(v) => !v && setEditTarget(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="h-4 w-4 text-amber-600" /> Correct pending leave request
            </DialogTitle>
            <DialogDescription>
              {editTarget
                ? `${editTarget.employeeName} · ${editTarget.leaveTypeName} · currently ${formatDate(editTarget.startDate)} → ${formatDate(editTarget.endDate)}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5">
            {/* Governance context card — the three rules of the window. */}
            <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1">
              <p className="text-sm text-foreground">You are correcting this request in place — the status stays PENDING and no re-approval is needed.</p>
              <ul className="text-xs text-muted-foreground space-y-0.5 list-disc pl-4">
                <li>The employee is told immediately: a portal bell row and an email show the before → after values, your name and your note.</li>
                <li>Working days and the balance reservation are recomputed automatically — the corrected range must fit the available balance.</li>
                <li>Only pending requests can be corrected. Decided requests are frozen history — cancel them instead.</li>
              </ul>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-type">Leave type</Label>
              <Select value={editTypeId} onValueChange={setEditTypeId}>
                <SelectTrigger id="edit-type" className="w-full">
                  <SelectValue placeholder="Select leave type" />
                </SelectTrigger>
                <SelectContent>
                  {leaveTypes.map((lt) => (
                    <SelectItem key={lt.id} value={lt.id}>
                      {lt.name} · {lt.defaultDaysPerYear} d/yr{lt.isPaid ? '' : ' · unpaid'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-start">Start date</Label>
                <Input id="edit-start" type="date" value={editStart} onChange={(e) => setEditStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-end">End date</Label>
                <Input id="edit-end" type="date" value={editEnd} min={editStart || undefined} onChange={(e) => setEditEnd(e.target.value)} />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={editHalfDay} onCheckedChange={(v) => setEditHalfDay(v === true)} />
              Half day (the range is credited minus half a day)
            </label>

            <div className="space-y-1.5">
              <Label htmlFor="edit-reason">Reason (recorded for the employee)</Label>
              <Textarea
                id="edit-reason"
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="e.g. Family trip upcountry — phoned in on Monday morning."
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-emergency">Emergency contact during leave (optional)</Label>
              <Input
                id="edit-emergency"
                value={editEmergency}
                onChange={(e) => setEditEmergency(e.target.value)}
                placeholder="Name · phone"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-note">Note to the employee (why the correction)</Label>
              <Textarea
                id="edit-note"
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder="e.g. Dates adjusted — the 2nd clashes with the month-end stock take."
                rows={2}
              />
            </div>

            {/* Before → after strip — the delta is the point of the dialog. */}
            {editTarget ? (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Was</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatDate(editTarget.startDate)} → {formatDate(editTarget.endDate)} ·{' '}
                    {toNum(editTarget.workingDays) % 1 === 0 ? toNum(editTarget.workingDays) : toNum(editTarget.workingDays).toFixed(1)} day(s)
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Now (preview)</span>
                  <span className="font-semibold tabular-nums" data-testid="edit-days-preview">
                    {previewDays % 1 === 0 ? previewDays : previewDays.toFixed(1)} day{previewDays === 1 ? '' : 's'}
                    {editTypeId !== editTarget.leaveTypeId ? ' · type changed' : ''}
                  </span>
                </div>
                {previewRow ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Available balance for this type</span>
                      <span className={`font-semibold tabular-nums ${previewInsufficient ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {previewAvailable !== null && (previewAvailable % 1 === 0 ? previewAvailable : previewAvailable.toFixed(1))} of{' '}
                        {previewEntitlement !== null && (previewEntitlement % 1 === 0 ? previewEntitlement : previewEntitlement.toFixed(1))} d
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden" role="presentation">
                      <div
                        className={`h-full rounded-full transition-all ${previewInsufficient ? 'bg-rose-500' : 'bg-emerald-500'}`}
                        style={{ width: `${previewEntitlement && previewEntitlement > 0 ? Math.min(100, Math.max(0, ((previewAvailable ?? 0) / previewEntitlement) * 100)) : 0}%` }}
                      />
                    </div>
                    {previewInsufficient ? (
                      <p className="flex items-start gap-1.5 text-xs text-rose-600 dark:text-rose-400">
                        <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden />
                        Corrected range needs {previewDays} d but only {previewAvailable} d are available — the server will reject this correction.
                      </p>
                    ) : null}
                  </div>
                ) : previewLoading ? (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading balance…
                  </p>
                ) : (
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Info className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden />
                    No tracked balance for this employee &amp; type yet — the correction is still balance-checked on save.
                  </p>
                )}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={editMutation.isPending}>Discard</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={!editFormReady || editMutation.isPending}
              onClick={confirmEdit}
            >
              {editMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Edit className="h-4 w-4 mr-1.5" />}
              Save correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* v2.38.0: on-behalf filing dialog — HR enters a request in an
          employee's name (walk-up / phone-in). Balance preview reads the
          governed /api/leave/balances figure; working days mirror the
          service's weekend-skipping arithmetic; the submit is disabled
          while the preview exceeds the available balance (the server
          enforces the same rule with INSUFFICIENT_BALANCE). */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarPlus className="h-4 w-4 text-violet-600" /> File a leave request for an employee
            </DialogTitle>
            <DialogDescription>
              For walk-up and phone-in requests. The employee is notified immediately and the request is marked &ldquo;Entered by HR&rdquo; on every surface.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="onbehalf-employee">Employee</Label>
              <Select value={newEmployeeId} onValueChange={setNewEmployeeId}>
                <SelectTrigger id="onbehalf-employee" className="w-full">
                  <SelectValue placeholder={rosterLoading ? 'Loading roster…' : 'Select employee'} />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {roster.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.firstName} {r.lastName}{r.employeeCode ? ` · ${r.employeeCode}` : ''}{r.jobTitle ? ` — ${r.jobTitle}` : ''}{r.userId ? ' · portal linked' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* v2.39.0: set expectations at filing time — no linked account
                  means the employee's bell row is skipped (email only). */}
              {newEmployeeId && rosterLinkState.get(newEmployeeId) == null ? (
                <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50/70 px-2 py-1.5 text-[11px] leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  <span>
                    {roster.find((r) => r.id === newEmployeeId)?.firstName ?? 'This employee'} has no linked portal account — no in-app bell will be sent (email only, if an address is on file). Link one from the Employee directory (UserCog action).
                  </span>
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="onbehalf-type">Leave type</Label>
              <Select value={newTypeId} onValueChange={setNewTypeId}>
                <SelectTrigger id="onbehalf-type" className="w-full">
                  <SelectValue placeholder="Select leave type" />
                </SelectTrigger>
                <SelectContent>
                  {leaveTypes.map((lt) => (
                    <SelectItem key={lt.id} value={lt.id}>
                      {lt.name} · {lt.defaultDaysPerYear} d/yr{lt.isPaid ? '' : ' · unpaid'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="onbehalf-start">Start date</Label>
                <Input id="onbehalf-start" type="date" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="onbehalf-end">End date</Label>
                <Input id="onbehalf-end" type="date" value={newEnd} min={newStart || undefined} onChange={(e) => setNewEnd(e.target.value)} />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={newHalfDay} onCheckedChange={(v) => setNewHalfDay(v === true)} />
              Half day (the range is credited minus half a day)
            </label>

            <div className="space-y-1.5">
              <Label htmlFor="onbehalf-reason">Reason (recorded for the employee)</Label>
              <Textarea
                id="onbehalf-reason"
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
                placeholder="e.g. Family trip upcountry — phoned in on Monday morning."
                rows={2}
              />
            </div>

            {/* Live preview strip — days + balance rail. */}
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">Working days (weekends skipped)</span>
                <span className="font-semibold tabular-nums" data-testid="onbehalf-days-preview">
                  {previewDays % 1 === 0 ? previewDays : previewDays.toFixed(1)} day{previewDays === 1 ? '' : 's'}
                </span>
              </div>
              {newEmployeeId && newTypeId ? (
                previewRow ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Available balance for this type</span>
                      <span className={`font-semibold tabular-nums ${previewInsufficient ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {previewAvailable !== null && (previewAvailable % 1 === 0 ? previewAvailable : previewAvailable.toFixed(1))} of{' '}
                        {previewEntitlement !== null && (previewEntitlement % 1 === 0 ? previewEntitlement : previewEntitlement.toFixed(1))} d
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden" role="presentation">
                      <div
                        className={`h-full rounded-full transition-all ${previewInsufficient ? 'bg-rose-500' : 'bg-emerald-500'}`}
                        style={{ width: `${previewEntitlement && previewEntitlement > 0 ? Math.min(100, Math.max(0, ((previewAvailable ?? 0) / previewEntitlement) * 100)) : 0}%` }}
                      />
                    </div>
                    {previewInsufficient ? (
                      <p className="flex items-start gap-1.5 text-xs text-rose-600 dark:text-rose-400">
                        <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden />
                        Requested {previewDays} d exceeds the {previewAvailable} d available — the server will reject this submission.
                      </p>
                    ) : null}
                  </div>
                ) : previewLoading ? (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading balance…
                  </p>
                ) : (
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Info className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden />
                    No tracked balance for this employee &amp; type yet — the request is still balance-checked on submit.
                  </p>
                )
              ) : (
                <p className="text-xs text-muted-foreground">Pick an employee and a leave type to preview the balance.</p>
              )}
            </div>

            <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 dark:border-violet-900 dark:bg-violet-950/30">
              <p className="flex items-start gap-1.5 text-xs text-violet-700 dark:text-violet-300">
                <UserCheck className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden />
                The employee gets a portal notification and an email — they can withdraw the request while it is pending.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)} disabled={newRequestMutation.isPending}>Cancel</Button>
            <Button
              className="bg-violet-600 hover:bg-violet-700 text-white"
              disabled={!newFormReady || newRequestMutation.isPending}
              onClick={() =>
                newRequestMutation.mutate({
                  employeeId: newEmployeeId,
                  leaveTypeId: newTypeId,
                  startDate: new Date(`${newStart}T00:00:00.000Z`).toISOString(),
                  endDate: new Date(`${newEnd}T00:00:00.000Z`).toISOString(),
                  halfDay: newHalfDay,
                  ...(newReason.trim() ? { reason: newReason.trim() } : {}),
                })
              }
            >
              {newRequestMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CalendarPlus className="h-4 w-4 mr-1.5" />}
              File request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Small label/value row used inside the leave request details dialog. */
function DetailField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-2 min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium truncate" title={value}>{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// 3. PAY PERIODS SUB-TAB

interface PeriodForm {
  name: string; startDate: string; endDate: string; payDate: string; periodType: string; notes: string;
}

function PeriodsSubTab({ storeId }: { storeId: string }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<PeriodForm>({
    name: '', startDate: '', endDate: '', payDate: '', periodType: 'MONTHLY', notes: '',
  });

  const { data: periodsData, isLoading, error } = useQuery<PayrollPeriod[]>({
    queryKey: ['payroll-periods', storeId],
    queryFn: () => apiFetch(`/api/payroll/periods?storeId=${storeId}`),
    enabled: !!storeId,
  });
  const periods = Array.isArray(periodsData) ? periodsData : [];

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

  const totalNet = periods.reduce((s, p) => s + toNum(p.totalNet), 0);

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
                      <td className="px-2 py-2.5 hidden lg:table-cell text-xs">{p.payDate ? formatDate(p.payDate) : '-'}</td>
                      <td className="px-2 py-2.5 text-right">{p.employeeCount || 0}</td>
                      <td className="px-2 py-2.5 text-right hidden sm:table-cell">{p.totalGross ? formatKES(p.totalGross) : '-'}</td>
                      <td className="px-2 py-2.5 text-right hidden sm:table-cell font-medium">{p.totalNet ? formatKES(p.totalNet) : '-'}</td>
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

// 4. PAY RUNS SUB-TAB

interface RunForm {
  payrollPeriodId: string; runType: string; processImmediately: boolean;
}

function RunsSubTab({ storeId }: { storeId: string }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<RunForm>({ payrollPeriodId: '', runType: 'FULL', processImmediately: true });

  const { data: runsData, isLoading, error } = useQuery<PayrollRun[]>({
    queryKey: ['payroll-runs', storeId],
    queryFn: () => apiFetch(`/api/payroll/runs?storeId=${storeId}`),
    enabled: !!storeId,
  });
  const runs = Array.isArray(runsData) ? runsData : [];

  const { data: periodsForDropdownData } = useQuery<PayrollPeriod[]>({
    queryKey: ['payroll-periods', storeId],
    queryFn: () => apiFetch(`/api/payroll/periods?storeId=${storeId}`),
    enabled: !!storeId,
  });
  const periodsForDropdown = Array.isArray(periodsForDropdownData) ? periodsForDropdownData : [];

  const openPeriods = periodsForDropdown.filter((p) => p.status === 'OPEN' || p.status === 'DRAFT');

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

  // QA FIX (June 2026 supplemental run): void a never-paid, never-posted run
  // (the API refuses PAID runs and runs with posted journal entries).
  const voidRunMutation = useMutation({
    mutationFn: ({ runId, reason }: { runId: string; reason: string }) =>
      apiFetch(`/api/payroll/runs/${runId}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      toast.success('Pay run voided');
      qc.invalidateQueries({ queryKey: ['payroll-runs', storeId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleVoid(run: PayrollRun) {
    const reason = window.prompt(
      `Void the ${run.runType} pay run for ${run.periodName}?\n\nTotals stay visible for audit; status becomes VOIDED.\nOnly possible because nothing was paid and nothing was posted to the ledger.\n\nReason:`,
      'Deductions booked without earnings - superseded by corrected run'
    );
    if (reason === null) return;
    voidRunMutation.mutate({ runId: run.id, reason: reason.trim() || 'Voided by admin' });
  }

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
                    <th className="px-2 py-2 font-medium text-muted-foreground text-right">Actions</th>
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
                      <td className="px-2 py-2.5 text-right hidden md:table-cell">{r.totalGross ? formatKES(r.totalGross) : '-'}</td>
                      <td className="px-2 py-2.5 text-right hidden md:table-cell text-red-600">{r.totalDeductions ? formatKES(r.totalDeductions) : '-'}</td>
                      <td className="px-2 py-2.5 text-right font-medium">{r.totalNet ? formatKES(r.totalNet) : '-'}</td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {r.status === 'PROCESSING' && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
                          <StatusBadge status={r.status} />
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        {(r.status === 'COMPLETED' || r.status === 'FAILED') && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-orange-500 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/30"
                            disabled={voidRunMutation.isPending}
                            title="Void run (only when nothing was paid and nothing was posted)"
                            onClick={() => handleVoid(r)}
                          >
                            {voidRunMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                          </Button>
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

// 5. ATTENDANCE SUB-TAB

function AttendanceSubTab({ storeId }: { storeId: string }) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(weekAgo);
  const [endDate, setEndDate] = useState(today);
  const [clockEmpId, setClockEmpId] = useState('');

  const { data: recordsData, isLoading, error } = useQuery<AttendanceRecord[]>({
    queryKey: ['payroll-attendance', storeId, startDate, endDate],
    queryFn: () => apiFetch(`/api/attendance?storeId=${storeId}&startDate=${startDate}&endDate=${endDate}`),
    enabled: !!storeId,
  });
  const records = Array.isArray(recordsData) ? recordsData : [];

  const { data: employeesForAttendanceData } = useQuery<Employee[]>({
    queryKey: ['payroll-employees', storeId],
    queryFn: () => apiFetch(`/api/employees?storeId=${storeId}`),
    enabled: !!storeId,
  });
  const employeesForAttendance = Array.isArray(employeesForAttendanceData) ? employeesForAttendanceData : [];

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
    ? (records.reduce((s, r) => s + toNum(r.workingHours), 0) / records.length).toFixed(1)
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
                  {employeesForAttendance.filter((e) => e.status === 'ACTIVE').map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.fullName} - {e.jobTitle || 'Staff'}</SelectItem>
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
                    <tr key={r.id} className={`border-b hover:bg-muted/40 transition-colors ${r.status === 'LATE' ? 'border-l-2 border-l-amber-400' : 'border-l-2 border-l-transparent'}`}>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
                              {initialsOf(r.employeeName)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{r.employeeName}</p>
                            <p className="text-xs text-muted-foreground truncate">{r.employeeJobTitle || 'Staff'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-xs tabular-nums">{formatDate(r.date)}</td>
                      <td className="px-2 py-2.5 text-xs tabular-nums">{r.checkIn ? formatDateTime(r.checkIn) : '-'}</td>
                      <td className="px-2 py-2.5 text-xs tabular-nums">{r.checkOut ? formatDateTime(r.checkOut) : '-'}</td>
                      <td className="px-2 py-2.5 text-right font-medium tabular-nums">
                        {toNum(r.workingHours) > 0 ? `${toNum(r.workingHours).toFixed(1)}h` : '-'}
                        {toNum(r.overtimeHours) > 0 ? <span className="block text-[10px] text-emerald-600 dark:text-emerald-400">+{toNum(r.overtimeHours).toFixed(1)}h OT</span> : null}
                        {toNum(r.lateMinutes) > 0 ? <span className="block text-[10px] text-amber-600 dark:text-amber-400">{toNum(r.lateMinutes)}m late</span> : null}
                      </td>
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
