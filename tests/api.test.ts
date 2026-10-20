import { describe, it, expect, beforeAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';

describe('EggDrop API Integration Tests', () => {
  let app: FastifyInstance;
  let studentToken: string;
  let vendorToken: string;
  let studentClaimCode: string;
  let studentOrderId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  // 1. Health Check
  it('GET /api/health - should return healthy status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.platform).toBe('EggDrop Backend');
  });

  // 2. Auth Flow (Student)
  it('POST /api/auth/send-otp - should send OTP', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/send-otp',
      payload: { phone: '9988776655' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.devOtp).toBeDefined();
  });

  it('POST /api/auth/verify-otp - should login & auto-register student', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-otp',
      payload: {
        phone: '9988776655',
        otp: '123456',
        fullName: 'Arjun Verma',
        hostelBlock: 'Block C',
        roomNumber: '312',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBeDefined();
    expect(body.user.phone).toBe('9988776655');
    expect(body.user.role).toBe('STUDENT');

    studentToken = body.token;
  });

  it('GET /api/auth/me - should get current student profile', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        authorization: `Bearer ${studentToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.fullName).toBe('Arjun Verma');
    expect(body.user.hostelBlock).toBe('Block C');
  });

  // 3. Delivery Cycle Flow
  it('GET /api/cycles/active - should return active cycle details', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/cycles/active',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.activeCycle).not.toBeNull();
    expect(body.activeCycle.pricePerEgg).toBe(6.5);
    expect(body.activeCycle.status).toBe('UPCOMING');
    expect(body.activeCycle.isCutoffPassed).toBe(false);
  });

  // 4. Order Reservation Flow
  it('POST /api/orders - should reserve 30 eggs for student', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: {
        authorization: `Bearer ${studentToken}`,
      },
      payload: {
        quantity: 30,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.order.quantity).toBe(30);
    expect(Number(body.order.totalPrice)).toBe(195.0); // 30 * 6.50
    expect(body.order.claimCode).toMatch(/^EG-\d+/);
    expect(body.order.status).toBe('RESERVED');

    studentClaimCode = body.order.claimCode;
    studentOrderId = body.order.id;
  });

  it('GET /api/orders/my-active - should retrieve active reservation with QR payload', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/orders/my-active',
      headers: {
        authorization: `Bearer ${studentToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.hasActiveOrder).toBe(true);
    expect(body.order.claimCode).toBe(studentClaimCode);
    expect(body.order.quantity).toBe(30);
    expect(body.order.qrPayload).toBeDefined();
  });

  // 5. Vendor Flow
  it('POST /api/auth/verify-otp - should login as vendor', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-otp',
      payload: {
        phone: '9876543210', // Seeded vendor phone
        otp: '123456',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBeDefined();
    expect(body.user.role).toBe('VENDOR');

    vendorToken = body.token;
  });

  it('GET /api/vendor/cycle-summary - should return aggregated cycle statistics', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/vendor/cycle-summary',
      headers: {
        authorization: `Bearer ${vendorToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.stats).toBeDefined();
    expect(body.stats.totalEggsReserved).toBeGreaterThanOrEqual(30);
    expect(body.stats.totalTraysToBring).toBeGreaterThanOrEqual(1);
    expect(body.orders.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/vendor/claim-order - should verify and mark order as collected', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vendor/claim-order',
      headers: {
        authorization: `Bearer ${vendorToken}`,
      },
      payload: {
        claimCode: studentClaimCode,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.order.quantity).toBe(30);
    expect(body.order.studentName).toBe('Arjun Verma');
    expect(body.order.collectedAt).toBeDefined();
  });

  it('POST /api/vendor/claim-order - should reject double claim of same token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vendor/claim-order',
      headers: {
        authorization: `Bearer ${vendorToken}`,
      },
      payload: {
        claimCode: studentClaimCode,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('ALREADY_CLAIMED');
  });

  it('POST /api/vendor/walk-in - should record spot walk-in cash sale', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vendor/walk-in',
      headers: {
        authorization: `Bearer ${vendorToken}`,
      },
      payload: {
        quantity: 12,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.order.quantity).toBe(12);
    expect(body.order.totalPrice).toBe(78.0); // 12 * 6.50
    expect(body.order.status).toBe('COLLECTED');
  });

  it('GET /api/vendor/settlement - should generate middleman commission report', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/vendor/settlement',
      headers: {
        authorization: `Bearer ${vendorToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.settlementReport).toBeDefined();
    const metrics = body.settlementReport.metrics;
    expect(metrics.totalEggsCollected).toBeGreaterThanOrEqual(42); // 30 (student) + 12 (walk-in)
    expect(metrics.commissionPerEgg).toBe(0.5);
    expect(metrics.platformCommissionOwed).toBeGreaterThanOrEqual(21.0); // 42 * 0.50
    expect(metrics.vendorNetEarnings).toBe(metrics.totalGrossRevenue - metrics.platformCommissionOwed);
  });
});
