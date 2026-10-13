import { NextResponse } from 'next/server';
import { getEtimsConfig, initializeEtimsClient } from '@/lib/etims-service';
// v2.17.8 (Task 44 - security hardening): this route triggered an OUTBOUND
// call to the KRA eTIMS API with no session validation at all (the edge
// proxy checks Bearer PRESENCE, never validity). It now requires a
// manager-or-above session (requireStoreAccess + MANAGER_PLUS_ROLES) -
// connection tests expose integration posture and consume API quota.
import { requireStoreAccess, MANAGER_PLUS_ROLES } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// POST /api/etims/test-connection - Test eTIMS API connection
async function testConnectionHandler(): Promise<Response> {
  try {
    const config = getEtimsConfig();
    const client = initializeEtimsClient(config);
    const result = await client.testConnection();

    return NextResponse.json({
      success: result.success,
      message: result.message,
      sandbox: config.sandbox,
    });
  } catch (error) {
    console.error('[eTIMS test-connection] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to test eTIMS connection' },
      { status: 500 }
    );
  }
}

export const POST = requireStoreAccess(testConnectionHandler, {
  roles: MANAGER_PLUS_ROLES,
});
