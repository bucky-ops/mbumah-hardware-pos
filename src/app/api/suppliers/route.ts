// GET/POST /api/suppliers

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getSuppliersHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const search = searchParams.get('search') || '';
  const isActive = searchParams.get('isActive');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'name';
  const sortOrder = searchParams.get('sortOrder') || 'asc';

  const where: Record<string, unknown> = { storeId };

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { phone: { contains: search } },
      { email: { contains: search } },
      { contactPerson: { contains: search } },
      { city: { contains: search } },
    ];
  }

  if (isActive !== null && isActive !== undefined) {
    where.isActive = isActive === 'true';
  }

  const validSortFields = ['name', 'phone', 'rating', 'paymentTerms', 'createdAt'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'name';
  const orderDirection = sortOrder === 'desc' ? 'desc' : 'asc';

  const [suppliers, total] = await Promise.all([
    db.supplier.findMany({
      where,
      include: {
        _count: {
          select: {
            purchaseOrders: true,
          },
        },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.supplier.count({ where }),
  ]);

  const result = suppliers.map((sup) => {
    const { _count, ...supplierData } = sup;
    return {
      ...supplierData,
      purchaseOrderCount: _count.purchaseOrders,
    };
  });

  return Response.json({
    success: true,
    data: result,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createSupplierHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    name,
    email,
    phone,
    address,
    city,
    contactPerson,
    taxPin,
    paymentTerms,
    rating,
    isActive,
    notes,
  } = body;

  if (!storeId || !name) {
    return Response.json(
      { success: false, error: 'storeId and name are required.' },
      { status: 400 }
    );
  }

  const supplier = await db.supplier.create({
    data: {
      storeId,
      name,
      email: email || null,
      phone: phone || null,
      address: address || null,
      city: city || null,
      contactPerson: contactPerson || null,
      taxPin: taxPin || null,
      paymentTerms: paymentTerms || 'NET_30',
      rating: rating ?? 3,
      isActive: isActive ?? true,
      notes: notes || null,
    },
  });

  await systemLog({
    action: 'SUPPLIER_CREATED',
    component: LogComponent.INVENTORY,
    severity: LogSeverity.INFO,
    message: `Supplier "${name}" created`,
    storeId,
    metadata: { supplierId: supplier.id, phone: phone || null },
  });

  return Response.json({ success: true, data: supplier }, { status: 201 });
}

export const GET = withErrorBoundary(getSuppliersHandler, 'SUPPLIERS_LIST');
export const POST = withErrorBoundary(createSupplierHandler, 'SUPPLIERS_CREATE');
