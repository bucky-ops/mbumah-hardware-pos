import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Global API Error Handler — wraps every Next.js route handler.
//
// SECURITY NOTES
//  • Never leaks stack traces, Prisma internals or file paths to clients.
//  • Maps known error domains to precise, sanitized status codes:
//      ZodError                        → 400 with field-level messages
//      P2025 (record not found)        → 404
//      P2002 (unique constraint)       → 400
//      other PrismaClientKnownRequest  → 400
//      ApiError                        → its own status code
//      anything else                   → generic 500 + opaque requestId
//  • Full details go to server logs ONLY, tagged with a short requestId.
// ─────────────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
  static badRequest(msg = "Bad request") { return new ApiError(400, msg); }
  static unauthorized(msg = "Authentication required") { return new ApiError(401, msg); }
  static forbidden(msg = "Insufficient permissions") { return new ApiError(403, msg); }
  static notFound(msg = "Resource not found") { return new ApiError(404, msg); }
  static conflict(msg = "Conflict") { return new ApiError(409, msg); }
  static tooMany(msg = "Too many requests", retryAfter = 60) {
    const e = new ApiError(429, msg);
    e.code = `retryAfter:${retryAfter}`;
    return e;
  }
}

let counter = 0;
function requestId(): string {
  counter = (counter + 1) % 100000;
  return `req_${Date.now().toString(36)}${counter.toString(36)}`;
}

function zodMessage(err: ZodError): string {
  const issue = err.issues[0];
  const path = issue?.path?.length ? issue.path.join(".") : "body";
  return issue ? `${path}: ${issue.message}` : "Invalid request payload";
}

/** Central error mapper — the ONLY place that converts exceptions to HTTP. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: zodMessage(err),
        issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 400 }
    );
  }
  if (err instanceof ApiError) {
    const headers: Record<string, string> = {};
    if (err.code?.startsWith("retryAfter:")) headers["Retry-After"] = err.code.split(":")[1];
    return NextResponse.json({ error: err.message }, { status: err.status, headers });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2025: "An operation failed because it depends on one or more records
    // that were required but was not found" → 404.
    if (err.code === "P2025") {
      return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    }
    // P2002: unique constraint violation → 400 (client supplied a duplicate).
    if (err.code === "P2002") {
      return NextResponse.json({ error: "Duplicate value for a unique field" }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid database operation" }, { status: 400 });
  }
  // Unknown — log server-side, return generic 500 (no stack, no driver text).
  const rid = requestId();
  console.error(`[api-error:${rid}]`, err);
  return NextResponse.json({ error: "Internal server error", requestId: rid }, { status: 500 });
}

type Handler<Ctx> = (req: Request, ctx: Ctx) => Promise<Response> | Response;

/** Wrap a route handler: try/catch + uniform sanitized error mapping. */
export function withErrorHandler<Ctx = unknown>(handler: Handler<Ctx>): Handler<Ctx> {
  return async (req: Request, ctx: Ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
