import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerAuth } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { cycleRoutes } from './routes/cycles.js';
import { orderRoutes } from './routes/orders.js';
import { vendorRoutes } from './routes/vendor.js';
import { getDb } from './db/index.js';

export async function buildApp() {
  const fastify = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : true,
  });

  // CORS for mobile and web apps
  await fastify.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Register JWT Auth plugin
  await registerAuth(fastify);

  // Initialize DB tables
  await getDb();

  // Health check endpoint
  fastify.get('/api/health', async () => {
    return { status: 'ok', time: new Date().toISOString(), platform: 'EggDrop Backend' };
  });

  // Register domain routes
  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(cycleRoutes, { prefix: '/api/cycles' });
  await fastify.register(orderRoutes, { prefix: '/api/orders' });
  await fastify.register(vendorRoutes, { prefix: '/api/vendor' });

  return fastify;
}
