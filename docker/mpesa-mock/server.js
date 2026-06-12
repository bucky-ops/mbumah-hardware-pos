/**
 * Mock M-Pesa Daraja API Server
 * Simulates Safaricom's STK Push and callback functionality
 * for local development and testing
 */

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// In-memory store for STK push requests
const stkRequests = new Map();
let checkoutRequestCounter = 1;

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'mpesa-mock', timestamp: new Date().toISOString() });
});

// OAuth token endpoint - simulates Daraja OAuth
app.get('/oauth/v1/generate', (req, res) => {
  res.json({
    access_token: 'mock_access_token_' + Date.now(),
    expires_in: '3599',
    token_type: 'Bearer'
  });
});

// STK Push endpoint - simulates Lipa Na M-Pesa Online
app.post('/mpesa/stkpush/v1/processrequest', (req, res) => {
  const { BusinessShortCode, Password, Timestamp, TransactionType, Amount, PartyA, PartyB, PhoneNumber, CallBackURL, AccountReference, TransactionDesc } = req.body;

  const checkoutRequestId = 'ws_CO_' + String(checkoutRequestCounter++).padStart(10, '0');
  const merchantRequestId = String(Date.now());

  stkRequests.set(checkoutRequestId, {
    checkoutRequestId,
    merchantRequestId,
    phoneNumber: PhoneNumber,
    amount: Amount,
    businessShortCode: BusinessShortCode,
    accountReference: AccountReference,
    callBackURL: CallBackURL,
    status: 'PROCESSING',
    createdAt: new Date().toISOString()
  });

  // Simulate async callback after 3 seconds
  setTimeout(() => {
    simulateCallback(checkoutRequestId);
  }, 3000);

  res.json({
    MerchantRequestID: merchantRequestId,
    CheckoutRequestID: checkoutRequestId,
    ResponseCode: '0',
    ResponseDescription: 'Success. Request accepted for processing',
    CustomerMessage: 'Success. Request accepted for processing'
  });
});

// STK Push query endpoint
app.get('/mpesa/stkpushquery/v1/query', (req, res) => {
  const { CheckoutRequestID } = req.body || req.query;
  const request = stkRequests.get(CheckoutRequestID);

  if (!request) {
    return res.json({
      ResponseCode: '1',
      ResponseDescription: 'The transaction is being processed',
      MerchantRequestID: 'N/A',
      CheckoutRequestID: CheckoutRequestID || 'N/A',
      ResultCode: '500',
      ResultDesc: 'Request not found'
    });
  }

  if (request.status === 'COMPLETED') {
    res.json({
      ResponseCode: '0',
      ResponseDescription: 'The transaction is being processed',
      MerchantRequestID: request.merchantRequestId,
      CheckoutRequestID: request.checkoutRequestId,
      ResultCode: '0',
      ResultDesc: 'The service request is processed successfully.'
    });
  } else {
    res.json({
      ResponseCode: '0',
      ResponseDescription: 'The transaction is being processed',
      MerchantRequestID: request.merchantRequestId,
      CheckoutRequestID: request.checkoutRequestId,
      ResultCode: '1032',
      ResultDesc: 'The request is still being processed'
    });
  }
});

// C2B register URL endpoint
app.post('/mpesa/c2b/v1/registerurl', (req, res) => {
  res.json({
    ResponseCode: '0',
    ResponseDescription: 'Success',
    OriginatorConversationID: String(Date.now()),
    ConversationID: 'AG_' + Date.now()
  });
});

// C2B simulate endpoint
app.post('/mpesa/c2b/v1/simulate', (req, res) => {
  res.json({
    ConversationID: 'AG_' + Date.now(),
    OriginatorCoversationID: String(Date.now()),
    ResponseCode: '0',
    ResponseDescription: 'Accept the service request successfully.'
  });
});

// Get all STK requests (for debugging)
app.get('/debug/requests', (req, res) => {
  res.json(Array.from(stkRequests.values()));
});

// Manually trigger success callback for a specific request
app.post('/debug/callback/:checkoutRequestId', (req, res) => {
  const request = stkRequests.get(req.params.checkoutRequestId);
  if (!request) {
    return res.status(404).json({ error: 'Request not found' });
  }
  simulateCallback(req.params.checkoutRequestId, true);
  res.json({ message: 'Callback triggered', checkoutRequestId: req.params.checkoutRequestId });
});

// Simulate the callback to the provided URL
async function simulateCallback(checkoutRequestId, forceSuccess = true) {
  const request = stkRequests.get(checkoutRequestId);
  if (!request) return;

  const isSuccess = forceSuccess || Math.random() > 0.1; // 90% success rate

  request.status = isSuccess ? 'COMPLETED' : 'FAILED';
  stkRequests.set(checkoutRequestId, request);

  const mpesaReceiptNumber = 'MBM' + Date.now().toString().slice(-8);

  const callbackPayload = {
    Body: {
      stkCallback: {
        MerchantRequestID: request.merchantRequestId,
        CheckoutRequestID: checkoutRequestId,
        ResultCode: isSuccess ? '0' : '1032',
        ResultDesc: isSuccess ? 'The service request is processed successfully.' : 'Request cancelled by user',
        CallbackMetadata: isSuccess ? {
          Item: [
            { Name: 'Amount', Value: request.amount },
            { Name: 'MpesaReceiptNumber', Value: mpesaReceiptNumber },
            { Name: 'TransactionDate', Value: new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14) },
            { Name: 'PhoneNumber', Value: Number(request.phoneNumber) }
          ]
        } : undefined
      }
    }
  };

  if (request.callBackURL) {
    try {
      const response = await fetch(request.callBackURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(callbackPayload)
      });
      console.log(`Callback sent to ${request.callBackURL}, status: ${response.status}`);
    } catch (error) {
      console.error(`Callback failed for ${checkoutRequestId}:`, error.message);
    }
  }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🔧 Mock M-Pesa Daraja API running on port ${PORT}`);
  console.log(`📋 STK Push: POST http://localhost:${PORT}/mpesa/stkpush/v1/processrequest`);
  console.log(`🔍 Query: GET http://localhost:${PORT}/mpesa/stkpushquery/v1/query`);
  console.log(`🐛 Debug: GET http://localhost:${PORT}/debug/requests`);
});
