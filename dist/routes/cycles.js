import { z } from 'zod';
import { eq, desc, and, ne, inArray } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
export async function cycleRoutes(fastify) {
    const db = await getDb();
    // GET /api/cycles/active - Get current active delivery cycle for students & vendor
    fastify.get('/active', async (_request, reply) => {
        // Find cycle that is either 'UPCOMING', 'LOCKED', or 'ACTIVE'
        const [cycle] = await db
            .select({
            id: schema.deliveryCycles.id,
            vendorId: schema.deliveryCycles.vendorId,
            deliveryDate: schema.deliveryCycles.deliveryDate,
            cutoffTime: schema.deliveryCycles.cutoffTime,
            arrivalTime: schema.deliveryCycles.arrivalTime,
            departureTime: schema.deliveryCycles.departureTime,
            location: schema.deliveryCycles.location,
            status: schema.deliveryCycles.status,
            vendorName: schema.vendors.name,
            pricePerEgg: schema.vendors.pricePerEgg,
        })
            .from(schema.deliveryCycles)
            .innerJoin(schema.vendors, eq(schema.deliveryCycles.vendorId, schema.vendors.id))
            .where(inArray(schema.deliveryCycles.status, ['UPCOMING', 'LOCKED', 'ACTIVE']))
            .orderBy(desc(schema.deliveryCycles.createdAt))
            .limit(1);
        if (!cycle) {
            return reply.send({ activeCycle: null, message: 'No active delivery cycle currently scheduled.' });
        }
        // Calculate cutoff timing
        const now = new Date();
        const cutoffDate = new Date(cycle.cutoffTime);
        const isCutoffPassed = now > cutoffDate;
        const secondsUntilCutoff = Math.max(0, Math.floor((cutoffDate.getTime() - now.getTime()) / 1000));
        // Get order tallies for this cycle
        const cycleOrders = await db
            .select({
            quantity: schema.orders.quantity,
            status: schema.orders.status,
        })
            .from(schema.orders)
            .where(and(eq(schema.orders.cycleId, cycle.id), ne(schema.orders.status, 'CANCELLED')));
        const totalEggsPledged = cycleOrders.reduce((sum, o) => sum + o.quantity, 0);
        const totalOrdersCount = cycleOrders.length;
        const trayCount = Math.ceil(totalEggsPledged / 30);
        return reply.send({
            activeCycle: {
                ...cycle,
                pricePerEgg: Number(cycle.pricePerEgg),
                isCutoffPassed,
                secondsUntilCutoff,
                totalEggsPledged,
                totalOrdersCount,
                trayCount,
            },
        });
    });
    // GET /api/cycles - List all cycles (history)
    fastify.get('/', async (_request, reply) => {
        const cycles = await db
            .select({
            id: schema.deliveryCycles.id,
            vendorId: schema.deliveryCycles.vendorId,
            deliveryDate: schema.deliveryCycles.deliveryDate,
            cutoffTime: schema.deliveryCycles.cutoffTime,
            arrivalTime: schema.deliveryCycles.arrivalTime,
            departureTime: schema.deliveryCycles.departureTime,
            location: schema.deliveryCycles.location,
            status: schema.deliveryCycles.status,
            createdAt: schema.deliveryCycles.createdAt,
            vendorName: schema.vendors.name,
            pricePerEgg: schema.vendors.pricePerEgg,
        })
            .from(schema.deliveryCycles)
            .innerJoin(schema.vendors, eq(schema.deliveryCycles.vendorId, schema.vendors.id))
            .orderBy(desc(schema.deliveryCycles.createdAt));
        return reply.send({ cycles });
    });
    // POST /api/cycles - Create a new cycle (Vendor or Admin only)
    fastify.post('/', { preHandler: [fastify.requireRole(['VENDOR', 'ADMIN'])] }, async (request, reply) => {
        const bodySchema = z.object({
            vendorId: z.string().uuid().optional(),
            deliveryDate: z.string().min(10), // 'YYYY-MM-DD'
            cutoffTime: z.string().datetime(), // ISO 8601
            arrivalTime: z.string().default('17:00'),
            departureTime: z.string().default('19:00'),
            location: z.string().min(3),
        });
        const parsed = bodySchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Validation Error', details: parsed.error.format() });
        }
        const user = request.user;
        let vendorId = parsed.data.vendorId;
        if (user.role === 'VENDOR') {
            vendorId = user.id;
        }
        else if (!vendorId) {
            // If admin didn't specify, default to first active vendor
            const [defaultVendor] = await db
                .select()
                .from(schema.vendors)
                .where(eq(schema.vendors.isActive, true))
                .limit(1);
            if (!defaultVendor) {
                return reply.status(400).send({ error: 'No active vendor found. Please create a vendor first.' });
            }
            vendorId = defaultVendor.id;
        }
        const [newCycle] = await db
            .insert(schema.deliveryCycles)
            .values({
            vendorId,
            deliveryDate: parsed.data.deliveryDate,
            cutoffTime: new Date(parsed.data.cutoffTime),
            arrivalTime: parsed.data.arrivalTime,
            departureTime: parsed.data.departureTime,
            location: parsed.data.location,
            status: 'UPCOMING',
        })
            .returning();
        return reply.status(201).send({ success: true, cycle: newCycle });
    });
    // PATCH /api/cycles/:id/status - Update cycle status
    fastify.patch('/:id/status', { preHandler: [fastify.requireRole(['VENDOR', 'ADMIN'])] }, async (request, reply) => {
        const paramsSchema = z.object({ id: z.string().uuid() });
        const bodySchema = z.object({
            status: z.enum(['UPCOMING', 'LOCKED', 'ACTIVE', 'COMPLETED']),
        });
        const params = paramsSchema.safeParse(request.params);
        const body = bodySchema.safeParse(request.body);
        if (!params.success || !body.success) {
            return reply.status(400).send({ error: 'Invalid parameters or body' });
        }
        const [updated] = await db
            .update(schema.deliveryCycles)
            .set({ status: body.data.status })
            .where(eq(schema.deliveryCycles.id, params.data.id))
            .returning();
        if (!updated) {
            return reply.status(404).send({ error: 'Cycle not found' });
        }
        return reply.send({ success: true, cycle: updated });
    });
}
