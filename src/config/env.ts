import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_SECRET: z.string().default('super-secret-campus-eggdrop-jwt-key-change-in-production'),
  DATABASE_URL: z.string().optional().default(''),
});

export const env = envSchema.parse(process.env);
