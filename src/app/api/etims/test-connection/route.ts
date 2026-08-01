import { NextResponse } from 'next/server';
import { getEtimsConfig, initializeEtimsClient } from '@/lib/etims-service';

export const dynamic = 'force-dynamic';

// POST /api/etims/test-connection — Test eTIMS API connection
export async function POST() {
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
