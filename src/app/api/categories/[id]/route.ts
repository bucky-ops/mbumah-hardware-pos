// GET/PUT/DELETE /api/categories/[id]
//
// DML AUDIT FIX: categories were the only catalog entity that could be
// created but never updated or deleted (list/create-only API, no [id]
// route). "Anything that can be added must be editable and removable."
//
//   PUT    — update name / description / icon / color / sortOrder / isActive
//            (duplicate-name guard per store, manager-or-above).
//   DELETE — hard delete ONLY when no products reference the category;
//            otherwise 409 with the referencing product count so the caller
//            can reassign or delete products first (keeps referential
//            integrity — products cascade nowhere silently).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { withSessionAuth, MANAGER_PLUS_ROLES } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getCategoryHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const category = await db.productCategory.findUnique({
    where: { id },
    include: {
      _count: { select: { products: { where: { isActive: true } } } },
    },
  });

  if (!category) {
    return Response.json(
      { success: false, error: 'Category not found.' },
      { status: 404 }
    );
  }

  const { _count, ...data } = category;

  return Response.json({
    success: true,
    data: { ...data, productCount: _count?.products ?? 0 },
  });
}

async function updateCategoryHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const existing = await db.productCategory.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Category not found.' },
      { status: 404 }
    );
  }

  const body = await request.json();
  const name = typeof body.name === 'string' ? body.name.trim() : undefined;
  const description =
    body.description === undefined ? undefined : body.description === null ? null : String(body.description);
  const icon = body.icon === undefined ? undefined : body.icon === null ? null : String(body.icon);
  const color = body.color === undefined ? undefined : body.color === null ? null : String(body.color);
  const sortOrder =
    body.sortOrder === undefined || body.sortOrder === null
      ? undefined
      : Number.parseInt(String(body.sortOrder), 10);
  const isActive = typeof body.isActive === 'boolean' ? body.isActive : undefined;

  if (name !== undefined && !name) {
    return Response.json(
      { success: false, error: 'Category name cannot be empty.' },
      { status: 400 }
    );
  }
  if (sortOrder !== undefined && Number.isNaN(sortOrder)) {
    return Response.json(
      { success: false, error: 'sortOrder must be an integer.' },
      { status: 400 }
    );
  }

  // Duplicate-name guard within the same store (mirrors the POST handler).
  if (name !== undefined && name !== existing.name) {
    const duplicate = await db.productCategory.findFirst({
      where: { storeId: existing.storeId, name: { equals: name }, id: { not: id } },
    });
    if (duplicate) {
      return Response.json(
        { success: false, error: 'A category with this name already exists in this store.' },
        { status: 409 }
      );
    }
  }

  const category = await db.productCategory.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(icon !== undefined ? { icon } : {}),
      ...(color !== undefined ? { color } : {}),
      ...(sortOrder !== undefined ? { sortOrder } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    },
  });

  await systemLog({
    action: 'CATEGORY_UPDATED',
    component: LogComponent.INVENTORY,
    severity: LogSeverity.INFO,
    message: `Category "${category.name}" updated`,
    storeId: category.storeId,
    metadata: {
      categoryId: category.id,
      changes: { name, description, icon, color, sortOrder, isActive },
    },
  });

  return Response.json({ success: true, data: category });
}

async function deleteCategoryHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const existing = await db.productCategory.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Category not found.' },
      { status: 404 }
    );
  }

  // Referential-integrity guard: a category still referenced by products
  // cannot be silently dropped (products would be left orphaned).
  const productCount = await db.product.count({ where: { categoryId: id } });
  if (productCount > 0) {
    return Response.json(
      {
        success: false,
        error: `Cannot delete "${existing.name}" — ${productCount} product(s) still reference it. Reassign or delete those products first, or deactivate the category instead.`,
      },
      { status: 409 }
    );
  }

  await db.productCategory.delete({ where: { id } });

  await systemLog({
    action: 'CATEGORY_DELETED',
    component: LogComponent.INVENTORY,
    severity: LogSeverity.WARN,
    message: `Category "${existing.name}" deleted`,
    storeId: existing.storeId,
    metadata: { categoryId: existing.id, name: existing.name },
  });

  return Response.json({ success: true, data: { id } });
}

// AUDIT: GET = any store role; PUT/DELETE (catalog taxonomy writes) =
// manager-or-above, consistent with the list/create route.
export const GET = withErrorBoundary(withSessionAuth(getCategoryHandler), 'CATEGORY_DETAIL');
export const PUT = withErrorBoundary(
  withSessionAuth(updateCategoryHandler, { roles: MANAGER_PLUS_ROLES }),
  'CATEGORY_UPDATE',
);
export const DELETE = withErrorBoundary(
  withSessionAuth(deleteCategoryHandler, { roles: MANAGER_PLUS_ROLES }),
  'CATEGORY_DELETE',
);
