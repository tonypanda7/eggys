# 🥚 EggDrop Backend API

Minimal, high-performance REST API for the campus egg delivery middleman platform. Built with **Node.js**, **TypeScript**, **Fastify**, **PostgreSQL**, and **Drizzle ORM**.

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Setup
The project works out of the box with zero external configuration using built-in embedded PostgreSQL (`PGlite`).

```bash
cp .env.example .env
```

To connect to a production PostgreSQL database (e.g. on your Oracle ARM instance), update `DATABASE_URL` in `.env`:
```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/eggdrop
```

### 3. Seed Demo Data
Populates a default vendor, an active upcoming cycle, and demo student reservations:
```bash
npm run db:seed
```

### 4. Start Development Server
```bash
npm run dev
```
The server will boot at `http://localhost:4000`.

### 5. Run Automated Test Suite
Executes the comprehensive end-to-end integration test suite:
```bash
npm test
```

---

## 🗄️ Database Architecture (4 Tables)

| Table | Purpose |
|:---|:---|
| **`users`** | Student profiles (`phone`, `full_name`, `hostel_block`, `room_number`, `role`) |
| **`vendors`** | Vendor profiles (`name`, `phone`, `price_per_egg`, `commission_per_egg`) |
| **`delivery_cycles`** | Delivery schedules (`delivery_date`, `cutoff_time`, `location`, `status`) |
| **`orders`** | Student reservations & walk-ins (`quantity`, `total_price`, `claim_code`, `status`, `collected_at`) |

---

## 📡 API Reference

### 1. Authentication (`/api/auth`)

#### `POST /api/auth/send-otp`
Sends a 6-digit OTP to a student or vendor phone number.
```json
// Request
{ "phone": "9988776655" }

// Response
{
  "success": true,
  "message": "OTP sent successfully",
  "devOtp": "123456"
}
```

#### `POST /api/auth/verify-otp`
Verifies OTP, auto-creates student account on first login, and returns signed JWT token.
```json
// Request
{
  "phone": "9988776655",
  "otp": "123456",
  "fullName": "Rahul Sharma",
  "hostelBlock": "Block B",
  "roomNumber": "204"
}

// Response
{
  "token": "eyJhbGciOiJIUzI1NiIsIn...",
  "user": {
    "id": "uuid",
    "phone": "9988776655",
    "fullName": "Rahul Sharma",
    "hostelBlock": "Block B",
    "roomNumber": "204",
    "role": "STUDENT"
  }
}
```

#### `GET /api/auth/me`
*Headers: `Authorization: Bearer <token>`*
Returns current authenticated user profile.

---

### 2. Delivery Cycles (`/api/cycles`)

#### `GET /api/cycles/active`
Public endpoint returning the current upcoming or active delivery cycle with real-time countdown.
```json
// Response
{
  "activeCycle": {
    "id": "uuid",
    "deliveryDate": "2026-10-22",
    "cutoffTime": "2026-10-21T14:00:00.000Z",
    "arrivalTime": "17:00",
    "departureTime": "19:00",
    "location": "Hostel Block B Main Gate",
    "status": "UPCOMING",
    "vendorName": "Kumar Poultry & Egg Supplies",
    "pricePerEgg": 6.5,
    "isCutoffPassed": false,
    "secondsUntilCutoff": 43200,
    "totalEggsPledged": 420,
    "trayCount": 14
  }
}
```

#### `POST /api/cycles`
*(Vendor / Admin only)* Creates a new delivery cycle.

#### `PATCH /api/cycles/:id/status`
*(Vendor / Admin only)* Updates cycle status (`UPCOMING`, `LOCKED`, `ACTIVE`, `COMPLETED`).

---

### 3. Student Orders (`/api/orders`)

#### `POST /api/orders`
*Headers: `Authorization: Bearer <student_token>`*
Places or updates a reservation for the active cycle. Generates a unique 4-character pickup code.
```json
// Request
{ "quantity": 30 }

// Response
{
  "success": true,
  "message": "Eggs reserved successfully! Pay upon collection at the vehicle.",
  "order": {
    "id": "uuid",
    "quantity": 30,
    "totalPrice": "195.00",
    "claimCode": "EG-482",
    "status": "RESERVED"
  }
}
```

#### `GET /api/orders/my-active`
*Headers: `Authorization: Bearer <student_token>`*
Fetches the student's active order, including a pre-formatted payload string for QR code generation.
```json
// Response
{
  "hasActiveOrder": true,
  "order": {
    "id": "uuid",
    "quantity": 30,
    "totalPrice": 195.0,
    "claimCode": "EG-482",
    "status": "RESERVED",
    "qrPayload": "{\"orderId\":\"uuid\",\"claimCode\":\"EG-482\",\"quantity\":30}"
  }
}
```

#### `GET /api/orders/my-history`
Returns history of student's past orders with status badges (`RESERVED`, `COLLECTED`, `CANCELLED`).

#### `DELETE /api/orders/:id`
Cancels reservation before the cycle cutoff time.

---

### 4. Vendor Operations (`/api/vendor`)
*All vendor endpoints require `Authorization: Bearer <vendor_token>`*

#### `GET /api/vendor/cycle-summary`
Real-time vendor distribution dashboard showing exact tray inventory requirements:
```json
// Response
{
  "cycle": {
    "id": "uuid",
    "deliveryDate": "2026-10-22",
    "location": "Hostel Block B Main Gate",
    "pricePerEgg": 6.5
  },
  "stats": {
    "totalEggsReserved": 3120,
    "traysRequired": 104,
    "recommendedBufferTrays": 11,
    "totalTraysToBring": 115,
    "totalEggsBroughtEstimate": 3450,
    "totalEggsCollected": 1200,
    "preOrdersCount": 104,
    "collectedCount": 40,
    "pendingCount": 64,
    "walkInEggsCount": 90
  },
  "orders": [...]
}
```

#### `POST /api/vendor/claim-order`
Verifies scanned QR code or typed token (e.g. `EG-482`). Atomically marks order `COLLECTED`.
```json
// Request
{ "claimCode": "EG-482" }

// Response
{
  "success": true,
  "message": "Verified! Hand over 30 eggs to Rahul Sharma",
  "order": {
    "id": "uuid",
    "claimCode": "EG-482",
    "quantity": 30,
    "totalPrice": 195.0,
    "studentName": "Rahul Sharma",
    "hostelBlock": "Block B",
    "roomNumber": "204",
    "collectedAt": "2026-10-22T17:15:00.000Z"
  }
}
```

#### `POST /api/vendor/walk-in`
Logs an instant spot sale for walk-in students paying cash or spot UPI.
```json
// Request
{ "quantity": 12 }

// Response
{
  "success": true,
  "message": "Spot sale of 12 eggs (₹78.00) logged successfully!",
  "order": {
    "quantity": 12,
    "totalPrice": 78.0,
    "claimCode": "SPOT-4912",
    "status": "COLLECTED"
  }
}
```

#### `GET /api/vendor/settlement`
Post-delivery middleman financial reconciliation report:
```json
// Response
{
  "settlementReport": {
    "cycleId": "uuid",
    "deliveryDate": "2026-10-22",
    "location": "Hostel Block B Main Gate",
    "metrics": {
      "pricePerEgg": 6.5,
      "commissionPerEgg": 0.5,
      "totalEggsCollected": 3150,
      "preOrderEggs": 3000,
      "walkInEggs": 150,
      "totalGrossRevenue": 20475.0,
      "platformCommissionOwed": 1575.0,
      "vendorNetEarnings": 18900.0
    },
    "summaryText": "Vendor collected ₹20475.00 in total. Platform commission to transfer: ₹1575.00 (3150 eggs × ₹0.5/egg)."
  }
}
```
