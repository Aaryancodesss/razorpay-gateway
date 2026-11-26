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

    const razorpay = getRazorpayInstance();
    const options = {
      amount: Math.round(parsedAmount * 100), // paise
      currency: 'INR',
      receipt: `receipt_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    };

    const order = await razorpay.orders.create(options);

    return res.status(200).json({
      order,
      key_id: process.env.RAZORPAY_KEY_ID || 'dummy_key_id',
    });
  } catch (error) {
    console.error('Error creating order:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to create order' });
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
