const express = require('express');
const crypto = require('crypto');
const path = require('path');
const Razorpay = require('razorpay');
require('dotenv').config();

const app = express();

function getRazorpayInstance() {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'dummy_key_id',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'dummy_key_secret',
  });
}

// 1. POST /webhook: Must use express.raw and be registered BEFORE express.json()
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!signature || !secret || !req.body) {
    return res.status(400).json({ success: false, message: 'Missing signature, webhook secret, or payload body' });
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const sigBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expectedSignature, 'utf8');

  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    return res.status(400).json({ success: false, message: 'Invalid JSON payload' });
  }

  console.log('Webhook event received:', event.event);
  return res.status(200).json({ status: 'ok' });
});

// JSON body parser registered AFTER /webhook
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// 2. POST /create-order
app.post('/create-order', async (req, res) => {
  try {
    const { amount } = req.body || {};
    const parsedAmount = Number(amount);

    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount in INR is required' });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret || keyId.trim() === '' || keySecret.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Razorpay API keys (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET) are missing or blank in .env. Please configure valid test keys.',
      });
    }

    const razorpay = getRazorpayInstance();
    const options = {
      amount: Math.round(parsedAmount * 100), // paise
      currency: 'INR',
      receipt: `receipt_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    };

    const order = await razorpay.orders.create(options);

    return res.status(200).json({
      order,
      key_id: keyId,
    });
  } catch (error) {
    console.error('Error creating order:', error);
    let message = 'Failed to create order';
    if (error && error.error && error.error.description) {
      message = error.error.description;
    } else if (error && error.message) {
      if (error.message.includes("Cannot read properties of undefined (reading 'status')")) {
        message = 'Razorpay connection failed. Please verify your internet connection and credentials in .env.';
      } else {
        message = error.message;
      }
    }
    return res.status(500).json({ success: false, message });
  }
});

// 3. POST /verify-payment
app.post('/verify-payment', (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  const secret = process.env.RAZORPAY_KEY_SECRET;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !secret) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields or secret (razorpay_order_id, razorpay_payment_id, razorpay_signature)',
    });
  }

  const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  const sigBuf = Buffer.from(razorpay_signature, 'utf8');
  const expectedBuf = Buffer.from(expectedSignature, 'utf8');

  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return res.status(400).json({ success: false, message: 'Invalid payment signature' });
  }

  return res.status(200).json({ success: true });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
