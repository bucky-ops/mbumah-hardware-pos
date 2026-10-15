import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateEmployeesCsv } from '@/lib/data-export-utils';

/**
 * Privacy contract for the employee CSV export: statutory identifiers and
 * bank details must be masked unless the caller is explicitly permitted to
 * include them (route-level role gate). The db module is mocked so no real
 * database is required.
 */

const findMany = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    employee: {
      findMany: (...args: unknown[]) => findMany(...args),
    },
  },
}));

const sampleEmployee = {
  id: 'emp-1',
  firstName: 'Jane',
  lastName: 'Wanjiku',
  email: 'jane@mbumahhardware.co.ke',
  phone: '+254700000001',
  nationalId: '12345678',
  kraPin: 'A009999999X',
  nssfNumber: 'NSSF1234567',
  nhifNumber: 'SHIF7654321',
  jobTitle: 'Cashier',
  role: 'CASHIER',
  employmentType: 'PERMANENT',
  status: 'ACTIVE',
  hireDate: new Date('2024-01-15'),
  terminationDate: null,
  basicSalary: 30000,
  houseAllowance: 5000,
  transportAllowance: 2000,
  medicalAllowance: 1000,
  otherAllowances: 0,
  hourlyRate: null,
  bankName: 'Equity Bank',
  bankAccountName: 'J. Wanjiku Account',
};

describe('employee export privacy masking', () => {
  beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([{ ...sampleEmployee }]);
  });

  it('masks statutory identifiers and bank details by default', async () => {
    const result = await generateEmployeesCsv('store-1');
    expect(result.recordCount).toBe(1);
    expect(result.csv).toContain('[REDACTED]');
    expect(result.csv).not.toContain('12345678');
    expect(result.csv).not.toContain('A009999999X');
    expect(result.csv).not.toContain('NSSF1234567');
    expect(result.csv).not.toContain('SHIF7654321');
    expect(result.csv).not.toContain('J. Wanjiku Account');
  });

  it('keeps names, contacts, job and salary data readable while masking only PII', async () => {
    const result = await generateEmployeesCsv('store-1');
    expect(result.csv).toContain('Jane');
    expect(result.csv).toContain('Wanjiku');
    expect(result.csv).toContain('Cashier');
    expect(result.csv).toContain('Equity Bank');
    expect(result.csv).toContain('30000.00');
  });

  it('includes unmasked PII only when includeSensitivePii is true', async () => {
    const result = await generateEmployeesCsv('store-1', { includeSensitivePii: true });
    expect(result.csv).toContain('12345678');
    expect(result.csv).toContain('A009999999X');
    expect(result.csv).toContain('NSSF1234567');
    expect(result.csv).toContain('SHIF7654321');
    expect(result.csv).toContain('J. Wanjiku Account');
    expect(result.csv).not.toContain('[REDACTED]');
  });

  it('never masks empty PII cells into noise', async () => {
    findMany.mockResolvedValue([{ ...sampleEmployee, nationalId: null, kraPin: null }]);
    const result = await generateEmployeesCsv('store-1');
    const rowLine: string | undefined = result.csv.split('\n').find((line) => line.includes('Jane'));
    expect(rowLine).toBeDefined();
    if (!rowLine) return;
    const nationalIdCell = rowLine.split(',')[5];
    const kraPinCell = rowLine.split(',')[6];
    expect(nationalIdCell).toBe('');
    expect(kraPinCell).toBe('');
  });
});
