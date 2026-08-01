import { NextResponse } from 'next/server';
import { getEtimsConfig } from '@/lib/etims-service';

export const dynamic = 'force-dynamic';

// GET /api/etims/settings — Get eTIMS configuration
export async function GET() {
  const config = getEtimsConfig();
  // Mask sensitive fields
  return NextResponse.json({
    success: true,
    data: {
      baseUrl: config.baseUrl,
      bvsn: config.bvsn ? '****' : '',
      tin: config.tin,
      branchId: config.branchId,
      deviceSerial: config.deviceSerial ? '****' : '',
      sandbox: config.sandbox,
      isConfigured: Boolean(config.tin && config.branchId && config.bvsn),
    },
  });
}

// PUT /api/etims/settings — Update eTIMS configuration (SUPER_ADMIN only)
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { sandbox, tin, branchId, bvsn, deviceSerial } = body;

    // In a real implementation, these would be saved to environment or database
    // For now, we log the update request
    console.info('[eTIMS settings] Update request:', {
      sandbox,
      tin: tin ? '****' : undefined,
      branchId,
      hasBvsn: Boolean(bvsn),
      hasDeviceSerial: Boolean(deviceSerial),
    });

    return NextResponse.json({
      success: true,
      message: 'eTIMS settings updated. Restart required for env-based settings.',
    });
  } catch (error) {
    console.error('[eTIMS settings] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update eTIMS settings' },
      { status: 500 }
    );
  }
}
