// POST /api/whatsapp/send

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

async function sendWhatsAppHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const { phone, message, storeId, customerId, messageType } = body;

  if (!phone || !message) {
    return Response.json(
      { success: false, error: 'phone and message are required.' },
      { status: 400 }
    );
  }

  // Normalize phone number (remove spaces, dashes, ensure it starts with country code)
  let normalizedPhone = phone.replace(/[\s\-()]/g, '');

  // If phone starts with 0, replace with Kenya country code 254
  if (normalizedPhone.startsWith('0')) {
    normalizedPhone = '254' + normalizedPhone.substring(1);
  }

  // If phone starts with +, remove the +
  if (normalizedPhone.startsWith('+')) {
    normalizedPhone = normalizedPhone.substring(1);
  }

  // Encode the message for URL
  const encodedMessage = encodeURIComponent(message);

  // Generate wa.me link
  const waLink = `https://wa.me/${normalizedPhone}?text=${encodedMessage}`;

  // Log the WhatsApp message attempt
  await systemLog({
    action: 'WHATSAPP_MESSAGE_GENERATED',
    component: LogComponent.POS,
    severity: LogSeverity.INFO,
    message: `WhatsApp link generated for ${normalizedPhone}`,
    storeId: storeId || undefined,
    metadata: {
      phone: normalizedPhone,
      messageType: messageType || 'GENERAL',
      customerId: customerId || null,
      messageLength: message.length,
      waLink,
    },
  });

  return Response.json({
    success: true,
    data: {
      phone: normalizedPhone,
      waLink,
      messageType: messageType || 'GENERAL',
    },
  });
}

export const POST = withErrorBoundary(sendWhatsAppHandler, 'WHATSAPP_SEND');
