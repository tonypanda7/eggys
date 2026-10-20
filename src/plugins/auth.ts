import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { env } from '../config/env.js';

export interface UserPayload {
  id: string;
  phone: string;
  role: 'STUDENT' | 'VENDOR' | 'ADMIN';
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (
      allowedRoles: Array<'STUDENT' | 'VENDOR' | 'ADMIN'>
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: UserPayload;
    user: UserPayload;
  }
}

export async function registerAuth(fastify: FastifyInstance) {
  await fastify.register(fastifyJwt, {
    secret: env.JWT_SECRET,
  });

  fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.status(401).send({ error: 'Unauthorized', message: 'Valid authentication token required' });
    }
  });

  fastify.decorate(
    'requireRole',
    function (allowedRoles: Array<'STUDENT' | 'VENDOR' | 'ADMIN'>) {
      return async function (request: FastifyRequest, reply: FastifyReply) {
        await fastify.authenticate(request, reply);
        const user = request.user;
        if (!user || !allowedRoles.includes(user.role)) {
          reply.status(403).send({
            error: 'Forbidden',
            message: `Access denied. Requires one of the following roles: ${allowedRoles.join(', ')}`,
          });
        }
      };
    }
  );
}
