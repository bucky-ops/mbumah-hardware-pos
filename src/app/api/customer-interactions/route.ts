// GET/POST /api/customer-interactions

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getCustomerInteractionsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const customerId = searchParams.get('customerId');
  const interactionType = searchParams.get('interactionType');
  const status = searchParams.get('status');
  const priority = searchParams.get('priority');
  const assignedTo = searchParams.get('assignedTo');
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const search = searchParams.get('search') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  const where: Record<string, unknown> = { storeId };

  if (customerId) {
    where.customerId = customerId;
  }

  if (interactionType) {
    where.interactionType = interactionType;
  }

  if (status) {
    where.status = status;
  }

  if (priority) {
    where.priority = priority;
  }

  if (assignedTo) {
    where.assignedTo = assignedTo;
  }

  if (dateFrom || dateTo) {
    const createdAt: Record<string, Date> = {};
    if (dateFrom) createdAt.gte = new Date(dateFrom);
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      createdAt.lte = to;
    }
    where.createdAt = createdAt;
  }

  if (search) {
    where.OR = [
      { subject: { contains: search, mode: 'insensitive' } },
      { content: { contains: search, mode: 'insensitive' } },
    ];
  }

  const validSortFields = ['createdAt', 'interactionType', 'status', 'priority', 'followUpDate'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  const [interactions, total] = await Promise.all([
    db.customerInteraction.findMany({
      where,
      include: {
        customer: {
          select: { id: true, name: true, phone: true, email: true },
        },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.customerInteraction.count({ where }),
  ]);

  // Summary stats
  const openCount = await db.customerInteraction.count({
    where: { ...where, status: { in: ['OPEN', 'IN_PROGRESS'] } },
  });

  const highPriorityCount = await db.customerInteraction.count({
    where: { ...where, priority: { in: ['HIGH', 'URGENT'] }, status: { in: ['OPEN', 'IN_PROGRESS'] } },
  });

  return Response.json({
    success: true,
    data: interactions,
    summary: {
      openCount,
      highPriorityCount,
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createCustomerInteractionHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    customerId,
    interactionType,
    subject,
    content,
    followUpDate,
    status,
    priority,
    assignedTo,
    createdBy,
  } = body;

  if (!storeId || !customerId || !content) {
    return Response.json(
      { success: false, error: 'storeId, customerId, and content are required.' },
      { status: 400 }
    );
  }

  const validTypes = ['NOTE', 'CALL', 'EMAIL', 'VISIT', 'WHATSAPP', 'COMPLAINT', 'FEEDBACK'];
  const iType = interactionType || 'NOTE';
  if (!validTypes.includes(iType)) {
    return Response.json(
      { success: false, error: `Invalid interactionType. Must be one of: ${validTypes.join(', ')}` },
      { status: 400 }
    );
  }

  const validStatuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
  const iStatus = status || 'OPEN';
  if (!validStatuses.includes(iStatus)) {
    return Response.json(
      { success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
      { status: 400 }
    );
  }

  const validPriorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
  const iPriority = priority || 'MEDIUM';
  if (!validPriorities.includes(iPriority)) {
    return Response.json(
      { success: false, error: `Invalid priority. Must be one of: ${validPriorities.join(', ')}` },
      { status: 400 }
    );
  }

  // Verify customer exists
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    return Response.json(
      { success: false, error: 'Customer not found.' },
      { status: 404 }
    );
  }

  const interaction = await db.customerInteraction.create({
    data: {
      storeId,
      customerId,
      interactionType: iType,
      subject: subject || null,
      content,
      followUpDate: followUpDate ? new Date(followUpDate) : null,
      status: iStatus,
      priority: iPriority,
      assignedTo: assignedTo || null,
      createdBy: createdBy || null,
    },
    include: {
      customer: {
        select: { id: true, name: true, phone: true, email: true },
      },
    },
  });

  await systemLog({
    action: 'CUSTOMER_INTERACTION_CREATED',
    component: LogComponent.POS,
    severity: LogSeverity.INFO,
    message: `${iType} interaction created for customer ${customer.name}`,
    storeId,
    userId: createdBy || undefined,
    metadata: {
      interactionId: interaction.id,
      customerId,
      interactionType: iType,
      priority: iPriority,
    },
  });

  return Response.json({ success: true, data: interaction }, { status: 201 });
}

export const GET = withErrorBoundary(getCustomerInteractionsHandler, 'CUSTOMER_INTERACTIONS_LIST');
export const POST = withErrorBoundary(createCustomerInteractionHandler, 'CUSTOMER_INTERACTIONS_CREATE');
