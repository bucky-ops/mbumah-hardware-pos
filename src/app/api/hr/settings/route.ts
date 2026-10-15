// GET /api/hr/settings - read HR module settings
// PUT /api/hr/settings - update the module flag (SUPER_ADMIN only)
//
// The module flag gates every /hr page and /api/hr route. Turning it off is
// a calm kill switch, not a data change.

import { db } from '@/lib/db';
import { hrGuard } from '@/lib/hr/guard';
import { isHrModuleEnabled, setHrModuleEnabled, HR_MODULE_SETTING_KEY } from '@/lib/hr/feature-flag';
import { hrAudit, HrEntityType } from '@/lib/hr/audit';

export const dynamic = 'force-dynamic';

export const GET = hrGuard('hr.employee.read.own_branch')(
  async (_request, session) => {
    const enabled = await isHrModuleEnabled(session.organizationId);
    return Response.json({
      success: true,
      data: {
        moduleEnabled: enabled,
        settingKey: HR_MODULE_SETTING_KEY,
        organizationId: session.organizationId,
      },
    });
  },
);

export const PUT = hrGuard('hr.settings.manage', ['SUPER_ADMIN'])(
  async (request, session) => {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
    }

    if (typeof body.enabled !== 'boolean') {
      return Response.json({ success: false, error: 'enabled (boolean) is required.' }, { status: 400 });
    }

    await setHrModuleEnabled(session.organizationId, body.enabled, session.userId);

    await hrAudit({
      actorId: session.userId,
      actorRole: session.role,
      action: 'CONFIG_CHANGE',
      resourceType: HrEntityType.HR_SETTING,
      resourceId: HR_MODULE_SETTING_KEY,
      storeId: session.storeId,
      reason: `HR module flag set to ${body.enabled}.`,
      metadata: { enabled: body.enabled },
    });

    // Reflect in SystemConfig-style visibility for the settings UI.
    const row = await db.hrSetting.findUnique({
      where: { organizationId_key: { organizationId: session.organizationId, key: HR_MODULE_SETTING_KEY } },
      select: { value: true, updatedAt: true },
    });

    return Response.json({ success: true, data: { moduleEnabled: body.enabled, updatedAt: row?.updatedAt ?? null } });
  },
);
