import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getEtimsConfig, initializeEtimsClient } from '@/lib/etims-service';

export const dynamic = 'force-dynamic';

// POST /api/etims/register-product — Register a product with KRA eTIMS
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { productId } = body;

    if (!productId) {
      return NextResponse.json(
        { success: false, error: 'Product ID is required' },
        { status: 400 }
      );
    }

    const product = await db.product.findUnique({ where: { id: productId } });
    if (!product) {
      return NextResponse.json(
        { success: false, error: 'Product not found' },
        { status: 404 }
      );
    }

    const config = getEtimsConfig();
    const client = initializeEtimsClient(config);

    const response = await client.registerProduct({
      productId: product.id,
      name: product.name,
      description: product.description || undefined,
      price: Number(product.pricePerUnit),
      taxType: product.etimsTaxType || 'A',
      unit: product.unitType || 'EACH',
      categoryCode: product.categoryId || undefined,
    });

    await db.product.update({
      where: { id: productId },
      data: {
        etimsItemCode: response.itemCode,
        etimsRegisteredAt: response.registeredAt,
        etimsTaxType: product.etimsTaxType || 'A',
      },
    });

    return NextResponse.json({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error('[eTIMS register-product] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to register product with KRA' },
      { status: 500 }
    );
  }
}
