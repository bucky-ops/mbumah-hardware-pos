// GET/POST /api/messages

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary, systemLog } from '@/lib/logger';

export const dynamic = 'force-dynamic';

async function getMessagesHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId') || '';
  const customerId = searchParams.get('customerId') || '';
  const channel = searchParams.get('channel') || '';
  const messageType = searchParams.get('messageType') || '';
  const status = searchParams.get('status') || '';
  const limit = parseInt(searchParams.get('limit') || '50');

  const where: Record<string, unknown> = {};

  if (storeId) where.storeId = storeId;
  if (customerId) where.customerId = customerId;
  if (channel) where.channel = channel;
  if (messageType) where.messageType = messageType;
  if (status) where.status = status;

  const messages = await db.message.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      store: { select: { id: true, name: true } },
    },
  });

  return Response.json({
    success: true,
    data: messages,
  });
}

async function sendMessageHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const { storeId, customerId, channel, messageType, subject, content, phone, createdBy } = body;

  if (!storeId || !content) {
    return Response.json(
      { success: false, error: 'storeId and content are required.' },
      { status: 400 }
    );
  }

  const resolvedChannel = channel || 'WHATSAPP';
  const resolvedMessageType = messageType || 'CUSTOM';

  let waLink: string | null = null;
  let resolvedPhone = phone || '';

  // If customerId is provided but no phone, look up the customer
  if (customerId && !resolvedPhone) {
    const customer = await db.customer.findUnique({
      where: { id: customerId },
      select: { phone: true, name: true },
    });
    if (customer?.phone) {
      resolvedPhone = customer.phone;
    }
  }

  // Generate WhatsApp link for WHATSAPP or BOTH channels
  if ((resolvedChannel === 'WHATSAPP' || resolvedChannel === 'BOTH') && resolvedPhone) {
    // Normalize phone number (same logic as /api/whatsapp/send)
    let normalizedPhone = resolvedPhone.replace(/[\s\-()]/g, '');

    // If phone starts with 0, replace with Kenya country code 254
    if (normalizedPhone.startsWith('0')) {
      normalizedPhone = '254' + normalizedPhone.substring(1);
    }

    // If phone starts with +, remove the +
    if (normalizedPhone.startsWith('+')) {
      normalizedPhone = normalizedPhone.substring(1);
    }

    const encodedMessage = encodeURIComponent(content);
    waLink = `https://wa.me/${normalizedPhone}?text=${encodedMessage}`;
  }

  // For SMS channel, log as placeholder
  if (resolvedChannel === 'SMS' || resolvedChannel === 'BOTH') {
    await systemLog({
      action: 'SMS_SEND_PLACEHOLDER',
      component: 'MESSAGING',
      severity: 'INFO',
      message: `SMS message queued (placeholder - no SMS provider configured): "${(subject || content).substring(0, 80)}"`,
      storeId,
      metadata: {
        customerId: customerId || null,
        phone: resolvedPhone,
        messageType: resolvedMessageType,
        channel: resolvedChannel,
      },
    });
  }

  // Create the Message record
  const message = await db.message.create({
    data: {
      storeId,
      customerId: customerId || null,
      channel: resolvedChannel,
      messageType: resolvedMessageType,
      subject: subject || null,
      content,
      status: waLink ? 'SENT' : (resolvedChannel === 'SMS' ? 'PENDING' : 'PENDING'),
      waLink: waLink || null,
      sentAt: waLink ? new Date() : null,
      createdBy: createdBy || null,
    },
  });

  await systemLog({
    action: 'MESSAGE_CREATED',
    component: 'MESSAGING',
    severity: 'INFO',
    message: `Message created: ${resolvedMessageType} via ${resolvedChannel}${waLink ? ' (wa.me link generated)' : ''}`,
    storeId,
    metadata: {
      messageId: message.id,
      channel: resolvedChannel,
      messageType: resolvedMessageType,
      customerId: customerId || null,
      hasWaLink: !!waLink,
    },
  });

  return Response.json({
    success: true,
    data: {
      ...message,
      waLink,
    },
  }, { status: 201 });
}

export const GET = withErrorBoundary(getMessagesHandler, 'MESSAGES_LIST');
export const POST = withErrorBoundary(sendMessageHandler, 'MESSAGES_SEND');
