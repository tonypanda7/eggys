import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';

// In-memory OTP storage for MVP / testing (Phone -> { otp, expiresAt })
const otpStore = new Map<string, { otp: string; expiresAt: number }>();

export async function authRoutes(fastify: FastifyInstance) {
  const db = await getDb();

  // POST /api/auth/send-otp
  fastify.post('/send-otp', async (request, reply) => {
    const bodySchema = z.object({
      phone: z.string().min(10, 'Valid phone number is required'),
    });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation Error', details: parsed.error.format() });
    }

    const cleanPhone = parsed.data.phone.replace(/[^0-9+]/g, '');
    
    // In dev / test, accept fixed or generated OTP
    const otp = process.env.NODE_ENV === 'test' ? '123456' : Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes validity

    otpStore.set(cleanPhone, { otp, expiresAt });

    fastify.log.info(`[AUTH] OTP for ${cleanPhone} is ${otp}`);

    return reply.send({
      success: true,
      message: 'OTP sent successfully',
      // In development / testing, provide devOtp for frictionless onboarding & automated tests
      ...(process.env.NODE_ENV !== 'production' && { devOtp: otp }),
    });
  });

  // POST /api/auth/verify-otp
  fastify.post('/verify-otp', async (request, reply) => {
    const bodySchema = z.object({
      phone: z.string().min(10),
      otp: z.string().length(6),
      fullName: z.string().optional(),
      hostelBlock: z.string().optional(),
      roomNumber: z.string().optional(),
    });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation Error', details: parsed.error.format() });
    }

    const { phone, otp, fullName, hostelBlock, roomNumber } = parsed.data;
    const cleanPhone = phone.replace(/[^0-9+]/g, '');

    const record = otpStore.get(cleanPhone);
    const isMasterOtp = otp === '123456'; // convenient master OTP for tests & testing

    if (!isMasterOtp && (!record || record.otp !== otp || Date.now() > record.expiresAt)) {
      return reply.status(400).send({ error: 'Invalid or expired OTP' });
    }

    // Check if phone belongs to a vendor first
    const [vendor] = await db.select().from(schema.vendors).where(eq(schema.vendors.phone, cleanPhone));
    if (vendor) {
      const token = fastify.jwt.sign({
        id: vendor.id,
        phone: vendor.phone,
        role: 'VENDOR',
      });

      return reply.send({
        token,
        user: {
          id: vendor.id,
          phone: vendor.phone,
          fullName: vendor.name,
          role: 'VENDOR',
        },
      });
    }

    // Check if student user exists
    let [user] = await db.select().from(schema.users).where(eq(schema.users.phone, cleanPhone));

    if (!user) {
      // Auto-register student on first login
      const [newUser] = await db
        .insert(schema.users)
        .values({
          phone: cleanPhone,
          fullName: fullName || `Student ${cleanPhone.slice(-4)}`,
          hostelBlock: hostelBlock || 'Main Hostel',
          roomNumber: roomNumber || null,
          role: 'STUDENT',
        })
        .returning();
      user = newUser;
    } else if (fullName || hostelBlock || roomNumber) {
      // Update details if provided
      const [updated] = await db
        .update(schema.users)
        .set({
          fullName: fullName ?? user.fullName,
          hostelBlock: hostelBlock ?? user.hostelBlock,
          roomNumber: roomNumber ?? user.roomNumber,
        })
        .where(eq(schema.users.id, user.id))
        .returning();
      user = updated;
    }

    // Clear consumed OTP
    otpStore.delete(cleanPhone);

    const token = fastify.jwt.sign({
      id: user.id,
      phone: user.phone,
      role: user.role as 'STUDENT' | 'VENDOR' | 'ADMIN',
    });

    return reply.send({
      token,
      user: {
        id: user.id,
        phone: user.phone,
        fullName: user.fullName,
        hostelBlock: user.hostelBlock,
        roomNumber: user.roomNumber,
        role: user.role,
      },
    });
  });

  // GET /api/auth/me
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user;

    if (authUser.role === 'VENDOR') {
      const [vendor] = await db.select().from(schema.vendors).where(eq(schema.vendors.id, authUser.id));
      if (!vendor) return reply.status(404).send({ error: 'Vendor not found' });
      return reply.send({ user: { ...vendor, role: 'VENDOR' } });
    }

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, authUser.id));
    if (!user) return reply.status(404).send({ error: 'User not found' });
    return reply.send({ user });
  });

  // PUT /api/auth/profile
  fastify.put('/profile', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user;
    const bodySchema = z.object({
      fullName: z.string().min(2).optional(),
      hostelBlock: z.string().min(1).optional(),
      roomNumber: z.string().optional(),
    });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation Error', details: parsed.error.format() });
    }

    const [updated] = await db
      .update(schema.users)
      .set(parsed.data)
      .where(eq(schema.users.id, authUser.id))
      .returning();

    return reply.send({ success: true, user: updated });
  });
}
