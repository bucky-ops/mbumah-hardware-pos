// GET /api/security/csrf-token - Get a CSRF token for the session
// This is a public endpoint that sets a csrf_token cookie

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function generateCSRFToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function GET(request: NextRequest) {
  // Check if csrf_token cookie already exists
  const existingToken = request.cookies.get('csrf_token')?.value;

  if (existingToken) {
    return Response.json({ success: true, data: { token: existingToken } });
  }

  const token = generateCSRFToken();

  const response = NextResponse.json({ success: true, data: { token } });

  response.cookies.set('csrf_token', token, {
    httpOnly: false, // Must be readable by JS to include in X-CSRF-Token header
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24, // 24 hours
  });

  return response;
}
