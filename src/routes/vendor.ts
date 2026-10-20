import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';

export async function vendorRoutes(fastify: FastifyInstance) {
  const db = await getDb();

  // All vendor routes require VENDOR or ADMIN role
  fastify.addHook('preHandler', fastify.requireRole(['VENDOR', 'ADMIN']));

  // GET /api/vendor/cycle-summary - Real-time distribution dashboard for vendor
  fastify.get('/cycle-summary', async (_request, reply) => {
    // 1. Find the current active cycle
    const [cycle] = await db
      .select({
        id: schema.deliveryCycles.id,
        deliveryDate: schema.deliveryCycles.deliveryDate,
        cutoffTime: schema.deliveryCycles.cutoffTime,
        arrivalTime: schema.deliveryCycles.arrivalTime,
        departureTime: schema.deliveryCycles.departureTime,
        location: schema.deliveryCycles.location,
        status: schema.deliveryCycles.status,
        pricePerEgg: schema.vendors.pricePerEgg,
        commissionPerEgg: schema.vendors.commissionPerEgg,
      })
      .from(schema.deliveryCycles)
      .innerJoin(schema.vendors, eq(schema.deliveryCycles.vendorId, schema.vendors.id))
      .where(inArray(schema.deliveryCycles.status, ['UPCOMING', 'LOCKED', 'ACTIVE']))
      .orderBy(desc(schema.deliveryCycles.createdAt))
      .limit(1);

    if (!cycle) {
      return reply.send({ activeCycle: null, message: 'No active delivery cycle.' });
    }

    // 2. Fetch all orders for this cycle
    const allOrders = await db
      .select({
        id: schema.orders.id,
        studentId: schema.orders.studentId,
        studentName: schema.users.fullName,
        studentPhone: schema.users.phone,
        hostelBlock: schema.users.hostelBlock,
        roomNumber: schema.users.roomNumber,
        quantity: schema.orders.quantity,
        totalPrice: schema.orders.totalPrice,
        claimCode: schema.orders.claimCode,
        status: schema.orders.status,
        collectedAt: schema.orders.collectedAt,
        createdAt: schema.orders.createdAt,
      })
      .from(schema.orders)
      .leftJoin(schema.users, eq(schema.orders.studentId, schema.users.id))
      .where(eq(schema.orders.cycleId, cycle.id))
      .orderBy(desc(schema.orders.createdAt));

    // Aggregate statistics
    let totalEggsReserved = 0;
    let totalEggsCollected = 0;
    let preOrdersCount = 0;
    let collectedCount = 0;
    let walkInEggsCount = 0;

    for (const ord of allOrders) {
      if (ord.status === 'CANCELLED') continue;

      if (!ord.studentId) {
        // Walk-in spot sale
        walkInEggsCount += ord.quantity;
        totalEggsCollected += ord.quantity;
      } else {
        // Student reservation
        preOrdersCount++;
        totalEggsReserved += ord.quantity;
        if (ord.status === 'COLLECTED') {
          collectedCount++;
          totalEggsCollected += ord.quantity;
        }
      }
    }

    const traysRequired = Math.ceil(totalEggsReserved / 30);
    const recommendedBufferTrays = Math.max(2, Math.ceil(traysRequired * 0.1));
    const totalTraysToBring = traysRequired + recommendedBufferTrays;

    return reply.send({
      cycle: {
        id: cycle.id,
        deliveryDate: cycle.deliveryDate,
        location: cycle.location,
        status: cycle.status,
        pricePerEgg: Number(cycle.pricePerEgg),
      },
      stats: {
        totalEggsReserved,
        traysRequired,
        recommendedBufferTrays,
        totalTraysToBring,
        totalEggsBroughtEstimate: totalTraysToBring * 30,
        totalEggsCollected,
        preOrdersCount,
        collectedCount,
        pendingCount: preOrdersCount - collectedCount,
        walkInEggsCount,
      },
      orders: allOrders.map((o: any) => ({
        ...o,
        totalPrice: Number(o.totalPrice),
      })),
    });
  });

  // POST /api/vendor/claim-order - Verify claim code and dispense eggs
  fastify.post('/claim-order', async (request, reply) => {
    const bodySchema = z.object({
      claimCode: z.string().min(3),
    });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation Error', details: parsed.error.format() });
    }

    const rawCode = parsed.data.claimCode.trim().toUpperCase();

    // Find the order across active/locked cycles
    const [order] = await db
      .select({
        id: schema.orders.id,
        cycleId: schema.orders.cycleId,
        quantity: schema.orders.quantity,
        totalPrice: schema.orders.totalPrice,
        claimCode: schema.orders.claimCode,
        status: schema.orders.status,
        collectedAt: schema.orders.collectedAt,
        studentName: schema.users.fullName,
        studentPhone: schema.users.phone,
        hostelBlock: schema.users.hostelBlock,
        roomNumber: schema.users.roomNumber,
      })
      .from(schema.orders)
      .leftJoin(schema.users, eq(schema.orders.studentId, schema.users.id))
      .innerJoin(schema.deliveryCycles, eq(schema.orders.cycleId, schema.deliveryCycles.id))
      .where(
        and(
          sql`UPPER(${schema.orders.claimCode}) = ${rawCode}`,
          inArray(schema.deliveryCycles.status, ['UPCOMING', 'LOCKED', 'ACTIVE'])
        )
      );

    if (!order) {
      return reply.status(404).send({
        error: 'INVALID_CODE',
        message: 'No active reservation found with this claim code.',
      });
    }

    if (order.status === 'COLLECTED') {
      return reply.status(400).send({
        error: 'ALREADY_CLAIMED',
        message: `This order was already claimed at ${new Date(order.collectedAt!).toLocaleTimeString()}`,
        studentName: order.studentName,
        quantity: order.quantity,
      });
    }

    if (order.status === 'CANCELLED') {
      return reply.status(400).send({
        error: 'CANCELLED_ORDER',
        message: 'This reservation was cancelled by the student.',
      });
    }

    // Mark as COLLECTED atomically
    const now = new Date();
    const [updated] = await db
      .update(schema.orders)
      .set({
        status: 'COLLECTED',
        collectedAt: now,
      })
      .where(eq(schema.orders.id, order.id))
      .returning();

    return reply.send({
      success: true,
      message: `Verified! Hand over ${order.quantity} eggs to ${order.studentName || 'Student'}`,
      order: {
        id: updated.id,
        claimCode: updated.claimCode,
        quantity: updated.quantity,
        totalPrice: Number(updated.totalPrice),
        studentName: order.studentName,
        studentPhone: order.studentPhone,
        hostelBlock: order.hostelBlock,
        roomNumber: order.roomNumber,
        collectedAt: now,
      },
    });
  });

  // POST /api/vendor/walk-in - Log instant spot sale at the vehicle
  fastify.post('/walk-in', async (request, reply) => {
    const bodySchema = z.object({
      quantity: z.number().int().min(1).max(180),
      notes: z.string().optional(),
    });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation Error', details: parsed.error.format() });
    }

    // Find active cycle
    const [activeCycle] = await db
      .select({
        id: schema.deliveryCycles.id,
        pricePerEgg: schema.vendors.pricePerEgg,
      })
      .from(schema.deliveryCycles)
      .innerJoin(schema.vendors, eq(schema.deliveryCycles.vendorId, schema.vendors.id))
      .where(inArray(schema.deliveryCycles.status, ['UPCOMING', 'LOCKED', 'ACTIVE']))
      .orderBy(desc(schema.deliveryCycles.createdAt))
      .limit(1);

    if (!activeCycle) {
      return reply.status(400).send({ error: 'No active delivery cycle found to log spot sales.' });
    }

    const { quantity } = parsed.data;
    const unitPrice = Number(activeCycle.pricePerEgg);
    const totalPrice = (quantity * unitPrice).toFixed(2);
    const spotCode = `SPOT-${Math.floor(1000 + Math.random() * 9000)}`;

    const [spotOrder] = await db
      .insert(schema.orders)
      .values({
        cycleId: activeCycle.id,
        studentId: null, // Walk-in / anonymous
        quantity,
        totalPrice: totalPrice.toString(),
        claimCode: spotCode,
        status: 'COLLECTED',
        collectedAt: new Date(),
      })
      .returning();

    return reply.status(201).send({
      success: true,
      message: `Spot sale of ${quantity} eggs (₹${totalPrice}) logged successfully!`,
      order: {
        ...spotOrder,
        totalPrice: Number(spotOrder.totalPrice),
      },
    });
  });

  // GET /api/vendor/settlement - Post-delivery middleman settlement report
  fastify.get('/settlement', async (request, reply) => {
    const querySchema = z.object({
      cycleId: z.string().uuid().optional(),
    });

    const query = querySchema.parse(request.query);

    // If cycleId provided, fetch that; otherwise latest active or completed cycle
    let cycleQuery = db
      .select({
        id: schema.deliveryCycles.id,
        deliveryDate: schema.deliveryCycles.deliveryDate,
        location: schema.deliveryCycles.location,
        status: schema.deliveryCycles.status,
        pricePerEgg: schema.vendors.pricePerEgg,
        commissionPerEgg: schema.vendors.commissionPerEgg,
      })
      .from(schema.deliveryCycles)
      .innerJoin(schema.vendors, eq(schema.deliveryCycles.vendorId, schema.vendors.id))
      .orderBy(desc(schema.deliveryCycles.createdAt))
      .limit(1);

    if (query.cycleId) {
      cycleQuery = db
        .select({
          id: schema.deliveryCycles.id,
          deliveryDate: schema.deliveryCycles.deliveryDate,
          location: schema.deliveryCycles.location,
          status: schema.deliveryCycles.status,
          pricePerEgg: schema.vendors.pricePerEgg,
          commissionPerEgg: schema.vendors.commissionPerEgg,
        })
        .from(schema.deliveryCycles)
        .innerJoin(schema.vendors, eq(schema.deliveryCycles.vendorId, schema.vendors.id))
        .where(eq(schema.deliveryCycles.id, query.cycleId))
        .limit(1);
    }

    const [cycle] = await cycleQuery;

    if (!cycle) {
      return reply.status(404).send({ error: 'Cycle not found' });
    }

    // Get all collected orders for this cycle
    const collectedOrders = await db
      .select({
        quantity: schema.orders.quantity,
        studentId: schema.orders.studentId,
      })
      .from(schema.orders)
      .where(and(eq(schema.orders.cycleId, cycle.id), eq(schema.orders.status, 'COLLECTED')));

    let totalEggsCollected = 0;
    let preOrderEggs = 0;
    let walkInEggs = 0;

    for (const ord of collectedOrders) {
      totalEggsCollected += ord.quantity;
      if (ord.studentId) {
        preOrderEggs += ord.quantity;
      } else {
        walkInEggs += ord.quantity;
      }
    }

    const pricePerEgg = Number(cycle.pricePerEgg);
    const commissionPerEgg = Number(cycle.commissionPerEgg);

    const totalGrossRevenue = totalEggsCollected * pricePerEgg;
    const platformCommissionOwed = totalEggsCollected * commissionPerEgg;
    const vendorNetEarnings = totalGrossRevenue - platformCommissionOwed;

    return reply.send({
      settlementReport: {
        cycleId: cycle.id,
        deliveryDate: cycle.deliveryDate,
        location: cycle.location,
        status: cycle.status,
        metrics: {
          pricePerEgg,
          commissionPerEgg,
          totalEggsCollected,
          preOrderEggs,
          walkInEggs,
          totalGrossRevenue: Number(totalGrossRevenue.toFixed(2)),
          platformCommissionOwed: Number(platformCommissionOwed.toFixed(2)),
          vendorNetEarnings: Number(vendorNetEarnings.toFixed(2)),
        },
        summaryText: `Vendor collected ₹${totalGrossRevenue.toFixed(
          2
        )} in total. Platform commission to transfer: ₹${platformCommissionOwed.toFixed(
          2
        )} (${totalEggsCollected} eggs × ₹${commissionPerEgg}/egg).`,
      },
    });
  });
}
