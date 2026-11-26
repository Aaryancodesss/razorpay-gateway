const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');

// Set dummy secrets for testing without real keys or network
const TEST_KEY_SECRET = 'dummy_razorpay_key_secret_12345';
const TEST_WEBHOOK_SECRET = 'dummy_razorpay_webhook_secret_67890';
process.env.RAZORPAY_KEY_SECRET = TEST_KEY_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

const app = require('../server');

// In-memory HTTP request dispatcher for Express apps (zero network/socket requirement)
function request(app, { method = 'GET', url = '/', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const req = new http.IncomingMessage();
      req.method = method;
      req.url = url;
      req.headers = Object.fromEntries(
        Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
      );

      const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      if (bodyBuf.length > 0 && !req.headers['content-length']) {
        req.headers['content-length'] = bodyBuf.length;
      }

      const res = new http.ServerResponse(req);
      let resBody = Buffer.alloc(0);

      res.write = function (chunk) {
        if (chunk) {
          resBody = Buffer.concat([resBody, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
        }
        return true;
      };

      res.end = function (chunk) {
        if (chunk) {
          resBody = Buffer.concat([resBody, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
        }
        const text = resBody.toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch (_) {}

        resolve({
          statusCode: res.statusCode,
          headers: res.getHeaders ? res.getHeaders() : {},
          text,
          json,
          buffer: resBody,
        });
      };

      app(req, res);

      if (bodyBuf.length > 0) {
        req.push(bodyBuf);
      }
      req.push(null);
    } catch (err) {
      reject(err);
    }
  });
}

describe('Razorpay Backend Verification Tests', () => {
  describe('Static Page (GET /)', () => {
    test('GET / serves index.html', async () => {
      const res = await request(app, { method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200);
      assert.match(res.text, /Razorpay Test Checkout/);
      assert.match(res.text, /checkout\.razorpay\.com\/v1\/checkout\.js/);
      assert.match(res.text, /\/create-order/);
      assert.match(res.text, /\/verify-payment/);
    });
  });

  describe('POST /verify-payment', () => {
    const orderId = 'order_9A33XWu170gUtm';
    const paymentId = 'pay_29Ae07uhdu9w50';

    test('valid signature -> 200 success true', async () => {
      const payload = `${orderId}|${paymentId}`;
      const validSignature = crypto
        .createHmac('sha256', TEST_KEY_SECRET)
        .update(payload)
        .digest('hex');

      const res = await request(app, {
        method: 'POST',
        url: '/verify-payment',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: validSignature,
        }),
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.json.success, true);
    });

    test('one character altered -> 400', async () => {
      const payload = `${orderId}|${paymentId}`;
      const validSignature = crypto
        .createHmac('sha256', TEST_KEY_SECRET)
        .update(payload)
        .digest('hex');

      // Alter the last character
      const lastChar = validSignature.slice(-1);
      const alteredChar = lastChar === 'a' ? 'b' : 'a';
      const tamperedSignature = validSignature.slice(0, -1) + alteredChar;

      const res = await request(app, {
        method: 'POST',
        url: '/verify-payment',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: tamperedSignature,
        }),
      });

      assert.equal(res.statusCode, 400);
      assert.equal(res.json.success, false);
    });

    test('missing fields -> 400', async () => {
      // Missing signature
      const resMissingSig = await request(app, {
        method: 'POST',
        url: '/verify-payment',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
        }),
      });
      assert.equal(resMissingSig.statusCode, 400);
      assert.equal(resMissingSig.json.success, false);

      // Missing payment_id
      const resMissingPayId = await request(app, {
        method: 'POST',
        url: '/verify-payment',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: orderId,
          razorpay_signature: 'some_sig',
        }),
      });
      assert.equal(resMissingPayId.statusCode, 400);
      assert.equal(resMissingPayId.json.success, false);

      // Missing order_id
      const resMissingOrderId = await request(app, {
        method: 'POST',
        url: '/verify-payment',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          razorpay_payment_id: paymentId,
          razorpay_signature: 'some_sig',
        }),
      });
      assert.equal(resMissingOrderId.statusCode, 400);
      assert.equal(resMissingOrderId.json.success, false);

      // Empty body
      const resEmpty = await request(app, {
        method: 'POST',
        url: '/verify-payment',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(resEmpty.statusCode, 400);
      assert.equal(resEmpty.json.success, false);
    });
  });

  describe('POST /webhook', () => {
    const rawWebhookPayload = JSON.stringify({
      entity: 'event',
      account_id: 'acc_test123',
      event: 'payment.captured',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: 'pay_29Ae07uhdu9w50',
            amount: 50000,
            currency: 'INR',
            status: 'captured',
            order_id: 'order_9A33XWu170gUtm',
          },
        },
      },
      created_at: 1567674323,
    });

    test('valid signature on raw body -> 200', async () => {
      const validSignature = crypto
        .createHmac('sha256', TEST_WEBHOOK_SECRET)
        .update(rawWebhookPayload)
        .digest('hex');

      const res = await request(app, {
        method: 'POST',
        url: '/webhook',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': validSignature,
        },
        body: rawWebhookPayload,
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.json.status, 'ok');
    });

    test('tampered body or bad signature -> 400', async () => {
      const validSignature = crypto
        .createHmac('sha256', TEST_WEBHOOK_SECRET)
        .update(rawWebhookPayload)
        .digest('hex');

      // 1. Tampered body with original signature
      const tamperedPayload = rawWebhookPayload.replace('50000', '99999');
      const resTampered = await request(app, {
        method: 'POST',
        url: '/webhook',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': validSignature,
        },
        body: tamperedPayload,
      });
      assert.equal(resTampered.statusCode, 400);
      assert.equal(resTampered.json.success, false);

      // 2. Original body with bad signature
      const badSignature = validSignature.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
      const resBadSig = await request(app, {
        method: 'POST',
        url: '/webhook',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': badSignature,
        },
        body: rawWebhookPayload,
      });
      assert.equal(resBadSig.statusCode, 400);
      assert.equal(resBadSig.json.success, false);
    });

    test('missing signature header -> 400', async () => {
      const res = await request(app, {
        method: 'POST',
        url: '/webhook',
        headers: {
          'content-type': 'application/json',
        },
        body: rawWebhookPayload,
      });

      assert.equal(res.statusCode, 400);
      assert.equal(res.json.success, false);
    });
  });
});
