import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getEtimsConfig, initializeEtimsClient } from '@/lib/etims-service';
import { generateInvoiceNumber } from '@/lib/etims-utils';

export const dynamic = 'force-dynamic';

// POST /api/etims/issue-invoice — Issue electronic tax invoice for a transaction
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { transactionId } = body;

    if (!transactionId) {
      return NextResponse.json(
        { success: false, error: 'Transaction ID is required' },
        { status: 400 }
      );
    }

    const transaction = await db.salesTransaction.findUnique({
      where: { id: transactionId },
      include: {
        customer: true,
        items: { include: { product: true } },
        store: true,
      },
    });

    if (!transaction) {
      return NextResponse.json(
        { success: false, error: 'Transaction not found' },
        { status: 404 }
      );
    }

    if (transaction.etimsStatus === 'ISSUED') {
      return NextResponse.json(
        { success: false, error: 'Invoice already issued' },
        { status: 400 }
      );
    }

    const config = getEtimsConfig();
    const client = initializeEtimsClient(config);

    const invoiceCount = await db.salesTransaction.count({
      where: { etimsStatus: 'ISSUED' },
    });

    const invoiceNumber = generateInvoiceNumber(
      transaction.store?.code || 'MBM',
      invoiceCount + 1,
      transaction.createdAt
    );

    const response = await client.issueInvoice({
      invoiceNumber,
      date: transaction.createdAt,
      customerTin: transaction.customer?.kraPin || undefined,
      customerName: transaction.customer?.name || 'Walk-in Customer',
      items: transaction.items.map((item) => ({
        itemCode: item.product?.etimsItemCode || 'ITEM00000',
        name: item.product?.name || 'Unknown',
        quantity: Number(item.quantity),
        price: Number(item.pricePerUnit),
        taxRate: 0.16,
        discount: Number(item.discountAmount || 0),
      })),
      payments: [
        {
          method: transaction.paymentMethod,
          amount: Number(transaction.totalAmount),
        },
      ],
      totalAmount: Number(transaction.totalAmount),
      vatAmount: Number(transaction.taxAmount || 0),
    });

    await db.salesTransaction.update({
      where: { id: transactionId },
      data: {
        etimsInvoiceNumber: response.invoiceNumber,
        etimsQrCode: response.qrCode,
        etimsUrl: response.url,
        etimsStatus: response.status,
        etimsIssuedAt: response.issuedAt,
      },
    });

    return NextResponse.json({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error('[eTIMS issue-invoice] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to issue eTIMS invoice' },
      { status: 500 }
    );
  }
}
