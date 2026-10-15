// MBUMAH HARDWARE POS - Payroll route error mapping (v2.18.9)

import { PayrollLifecycleError } from './run-service';
import { PayrollGuardrailError } from './types';

export function payrollErrorResponse(error: unknown): Response | null {
  if (error instanceof PayrollLifecycleError) {
    return Response.json(
      {
        success: false,
        error: error.message.replace(/^[A-Z_]+: /, ''),
        code: error.code,
        issues: error.issues,
      },
      { status: error.status },
    );
  }
  if (error instanceof PayrollGuardrailError) {
    return Response.json(
      {
        success: false,
        error: error.message.replace(/^[A-Z_]+: /, ''),
        code: error.code,
      },
      { status: 422 },
    );
  }
  return null;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}
