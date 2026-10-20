import { z } from 'zod';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
export async function orderRoutes(fastify) {
    const db = await getDb();
    // Helper to generate readable claim codes like "EG-482"
    function generateClaimCode() {
        const randomNum = Math.floor(100 + Math.random() * 900);
        return `EG-${randomNum}`;
    }
    // POST /api/orders - Place or update an order reservation for the active cycle
    fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const bodySchema = z.object({
            quantity: z.number().int().min(1, 'Quantity must be at least 1 egg').max(180, 'Maximum 180 eggs per order'),
        });
        const parsed = bodySchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Validation Error', details: parsed.error.format() });
        }
        const studentId = request.user.id;
        const { quantity } = parsed.data;
        // 1. Fetch current active cycle
        const [activeCycle] = await db
            .select({
            id: schema.deliveryCycles.id,
            status: schema.deliveryCycles.status,
            cutoffTime: schema.deliveryCycles.cutoffTime,
            pricePerEgg: schema.vendors.pricePerEgg,
        })
            .from(schema.deliveryCycles)
            .innerJoin(schema.vendors, eq(schema.deliveryCycles.vendorId, schema.vendors.id))
            .where(inArray(schema.deliveryCycles.status, ['UPCOMING', 'LOCKED', 'ACTIVE']))
            .orderBy(desc(schema.deliveryCycles.createdAt))
            .limit(1);
        if (!activeCycle) {
            return reply.status(400).send({ error: 'No active delivery cycle available for orders.' });
        }
        // 2. Check if cycle is closed for ordering
        const now = new Date();
        if (activeCycle.status !== 'UPCOMING' || now > new Date(activeCycle.cutoffTime)) {
            return reply.status(400).send({
                error: 'Ordering Closed',
                message: 'The ordering cutoff deadline for this delivery has already passed.',
            });
        }
        const unitPrice = Number(activeCycle.pricePerEgg);
        const totalPrice = (quantity * unitPrice).toFixed(2);
        // 3. Check if student already has an order for this cycle
        const [existingOrder] = await db
            .select()
            .from(schema.orders)
            .where(and(eq(schema.orders.cycleId, activeCycle.id), eq(schema.orders.studentId, studentId), eq(schema.orders.status, 'RESERVED')));
        if (existingOrder) {
            // Update existing reservation
            const [updatedOrder] = await db
                .update(schema.orders)
                .set({
                quantity,
                totalPrice: totalPrice.toString(),
            })
                .where(eq(schema.orders.id, existingOrder.id))
                .returning();
            return reply.send({
                success: true,
                message: 'Order reservation updated successfully',
                order: updatedOrder,
            });
        }
        // 4. Create new reservation with unique claim code
        let claimCode = generateClaimCode();
        // Ensure claimCode uniqueness for this cycle
        let isCodeUnique = false;
        while (!isCodeUnique) {
            const [clash] = await db
                .select({ id: schema.orders.id })
                .from(schema.orders)
                .where(and(eq(schema.orders.cycleId, activeCycle.id), eq(schema.orders.claimCode, claimCode)));
            if (!clash) {
                isCodeUnique = true;
            }
            else {
                claimCode = generateClaimCode();
            }
        }
        const [newOrder] = await db
            .insert(schema.orders)
            .values({
            cycleId: activeCycle.id,
            studentId,
            quantity,
            totalPrice: totalPrice.toString(),
            claimCode,
            status: 'RESERVED',
        })
            .returning();
        return reply.status(201).send({
            success: true,
            message: 'Eggs reserved successfully! Pay upon collection at the vehicle.',
            order: newOrder,
        });
    });
    // GET /api/orders/my-active - Get student's active order with pickup QR payload
    fastify.get('/my-active', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const studentId = request.user.id;
        // Find active cycle
        const [activeCycle] = await db
            .select()
            .from(schema.deliveryCycles)
            .where(inArray(schema.deliveryCycles.status, ['UPCOMING', 'LOCKED', 'ACTIVE']))
            .orderBy(desc(schema.deliveryCycles.createdAt))
            .limit(1);
        if (!activeCycle) {
            return reply.send({ hasActiveOrder: false, order: null });
        }
        const [order] = await db
            .select({
            id: schema.orders.id,
            quantity: schema.orders.quantity,
            totalPrice: schema.orders.totalPrice,
            claimCode: schema.orders.claimCode,
            status: schema.orders.status,
            createdAt: schema.orders.createdAt,
            deliveryDate: schema.deliveryCycles.deliveryDate,
            location: schema.deliveryCycles.location,
            arrivalTime: schema.deliveryCycles.arrivalTime,
            departureTime: schema.deliveryCycles.departureTime,
            cycleStatus: schema.deliveryCycles.status,
        })
            .from(schema.orders)
            .innerJoin(schema.deliveryCycles, eq(schema.orders.cycleId, schema.deliveryCycles.id))
            .where(and(eq(schema.orders.cycleId, activeCycle.id), eq(schema.orders.studentId, studentId)));
        if (!order) {
            return reply.send({ hasActiveOrder: false, order: null });
        }
        // Generate verification payload for QR rendering on frontend
        const qrPayload = JSON.stringify({
            orderId: order.id,
            claimCode: order.claimCode,
            quantity: order.quantity,
        });
        return reply.send({
            hasActiveOrder: true,
            order: {
                ...order,
                totalPrice: Number(order.totalPrice),
                qrPayload,
            },
        });
    });
    // GET /api/orders/my-history - List student's past orders
    fastify.get('/my-history', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const studentId = request.user.id;
        const history = await db
            .select({
            id: schema.orders.id,
            quantity: schema.orders.quantity,
            totalPrice: schema.orders.totalPrice,
            claimCode: schema.orders.claimCode,
            status: schema.orders.status,
            collectedAt: schema.orders.collectedAt,
            createdAt: schema.orders.createdAt,
            deliveryDate: schema.deliveryCycles.deliveryDate,
            location: schema.deliveryCycles.location,
        })
            .from(schema.orders)
            .innerJoin(schema.deliveryCycles, eq(schema.orders.cycleId, schema.deliveryCycles.id))
            .where(eq(schema.orders.studentId, studentId))
            .orderBy(desc(schema.orders.createdAt));
        return reply.send({
            history: history.map((h) => ({ ...h, totalPrice: Number(h.totalPrice) })),
        });
    });
    // DELETE /api/orders/:id - Cancel an active reservation (before cutoff)
    fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const paramsSchema = z.object({ id: z.string().uuid() });
        const parsed = paramsSchema.safeParse(request.params);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Invalid order ID' });
        }
        const orderId = parsed.data.id;
        const studentId = request.user.id;
        const [order] = await db
            .select({
            id: schema.orders.id,
            cycleId: schema.orders.cycleId,
            status: schema.orders.status,
            studentId: schema.orders.studentId,
            cutoffTime: schema.deliveryCycles.cutoffTime,
            cycleStatus: schema.deliveryCycles.status,
        })
            .from(schema.orders)
            .innerJoin(schema.deliveryCycles, eq(schema.orders.cycleId, schema.deliveryCycles.id))
            .where(and(eq(schema.orders.id, orderId), eq(schema.orders.studentId, studentId)));
        if (!order) {
            return reply.status(404).send({ error: 'Order not found' });
        }
        if (order.status !== 'RESERVED') {
            return reply.status(400).send({ error: `Cannot cancel order with status: ${order.status}` });
        }
        if (order.cycleStatus !== 'UPCOMING' || new Date() > new Date(order.cutoffTime)) {
            return reply.status(400).send({ error: 'Cannot cancel after order cutoff has passed.' });
        }
        await db.update(schema.orders).set({ status: 'CANCELLED' }).where(eq(schema.orders.id, orderId));
        return reply.send({ success: true, message: 'Order reservation cancelled successfully.' });
    });
}
