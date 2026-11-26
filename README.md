# Razorpay Node.js + Express Backend

Minimal, production-ready Node.js + Express backend with Razorpay payment processing and cryptographically secure signature verification (checkout payment verification and raw-body webhook verification).

---

## Features

- **Order Creation**: `POST /create-order` creates orders using the Razorpay SDK (converts INR to paise).
- **Payment Verification**: `POST /verify-payment` verifies payment signatures using SHA256 HMAC and `crypto.timingSafeEqual`.
- **Webhook Handling**: `POST /webhook` captures raw request bodies via `express.raw({ type: "application/json" })` prior to JSON parsing and validates the `x-razorpay-signature` header against timing attacks.
- **Frontend Test Page**: Minimal static checkout page served at `/` with Razorpay Checkout integration.
- **Automated Tests**: Comprehensive test suite testing all endpoints, timing-safe signatures, tampering detection, and edge cases with zero external network or key dependencies.

---

## Project Structure

```
.
├── .env.example
├── .gitignore
├── README.md
├── package.json
├── public
│   └── index.html
├── server.js
└── test
    └── verify.test.js
```

---

## Setup Instructions

### 1. Prerequisites
- Node.js (v18+)
- npm (v9+)
- Razorpay account (test mode keys)

### 2. Installation
Clone the repository and install dependencies:
```bash
git clone <YOUR_REPO_URL>
cd razorpay-gateway
npm install
```

### 3. Environment Variables
Copy the sample environment file and configure your Razorpay API keys:
```bash
cp .env.example .env
```

Edit `.env`:
```env
RAZORPAY_KEY_ID=rzp_test_YourKeyIdHere
RAZORPAY_KEY_SECRET=YourKeySecretHere
RAZORPAY_WEBHOOK_SECRET=YourWebhookSecretHere
PORT=3000
```

---

## Running the Application

### Start Server
```bash
npm start
```
The server will start at `http://localhost:3000`. Open this URL in your browser to test checkout.

### Run Automated Tests
```bash
npm test
```
Runs unit and integration tests using Node's native test runner (`node:test`). Tests run in isolation with dummy credentials and require no internet access or active Razorpay keys.

---

## API Endpoints

### 1. Create Order
Creates a Razorpay order in paise (`amount * 100`).

- **Endpoint**: `POST /create-order`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "amount": 500
  }
  ```
- **Response** (`200 OK`):
  ```json
  {
    "order": {
      "id": "order_EKwxwAgItmmXdp",
      "entity": "order",
      "amount": 50000,
      "amount_paid": 0,
      "amount_due": 50000,
      "currency": "INR",
      "receipt": "receipt_1732612345_123",
      "status": "created"
    },
    "key_id": "rzp_test_YourKeyIdHere"
  }
  ```

---

### 2. Verify Payment
Verifies the signature returned by Razorpay Checkout (`order_id|payment_id` signed with `RAZORPAY_KEY_SECRET`).

- **Endpoint**: `POST /verify-payment`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "razorpay_order_id": "order_9A33XWu170gUtm",
    "razorpay_payment_id": "pay_29Ae07uhdu9w50",
    "razorpay_signature": "9ef57b3b45a0b784a0d9...f4a7c"
  }
  ```
- **Response** (`200 OK`):
  ```json
  {
    "success": true
  }
  ```
- **Response on Mismatch or Missing Fields** (`400 Bad Request`):
  ```json
  {
    "success": false,
    "message": "Invalid payment signature"
  }
  ```

---

### 3. Webhook
Receives Razorpay webhook events. Body must be parsed as raw bytes to compute HMAC against the `x-razorpay-signature` header using `RAZORPAY_WEBHOOK_SECRET`.

- **Endpoint**: `POST /webhook`
- **Headers**:
  - `Content-Type: application/json`
  - `x-razorpay-signature: <sha256-hex-digest>`
- **Request Body**: Raw JSON payload from Razorpay
- **Response** (`200 OK`):
  ```json
  {
    "status": "ok"
  }
  ```
- **Response on Tampering / Invalid Signature** (`400 Bad Request`):
  ```json
  {
    "success": false,
    "message": "Invalid webhook signature"
  }
  ```

---

## How to Test

### 1. Testing Checkout via UI
1. Ensure `.env` contains valid Razorpay test keys (`RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`).
2. Run `npm start`.
3. Open `http://localhost:3000` in your browser.
4. Enter an amount and click **Pay with Razorpay**.
5. Use test card credentials from the Razorpay dashboard (e.g. Card, Netbanking, or UPI).
6. The frontend receives payment details and automatically calls `/verify-payment`.

### 2. Testing Webhook Locally
You can simulate Razorpay webhook calls locally with `curl`:
```bash
# Calculate HMAC SHA256 of the payload using your RAZORPAY_WEBHOOK_SECRET
PAYLOAD='{"event":"payment.captured"}'
SIGNATURE=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "YourWebhookSecretHere" | sed 's/^.* //')

# Send webhook request
curl -i -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "x-razorpay-signature: $SIGNATURE" \
  -d "$PAYLOAD"
```
