import fastifyJwt from '@fastify/jwt';
import { env } from '../config/env.js';
export async function registerAuth(fastify) {
    await fastify.register(fastifyJwt, {
        secret: env.JWT_SECRET,
    });
    fastify.decorate('authenticate', async function (request, reply) {
        try {
            await request.jwtVerify();
        }
        catch (err) {
            reply.status(401).send({ error: 'Unauthorized', message: 'Valid authentication token required' });
        }
    });
    fastify.decorate('requireRole', function (allowedRoles) {
        return async function (request, reply) {
            await fastify.authenticate(request, reply);
            const user = request.user;
            if (!user || !allowedRoles.includes(user.role)) {
                reply.status(403).send({
                    error: 'Forbidden',
                    message: `Access denied. Requires one of the following roles: ${allowedRoles.join(', ')}`,
                });
            }
        };
    });
}
