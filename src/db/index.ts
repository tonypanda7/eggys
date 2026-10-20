import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env.js';
import * as schema from './schema.js';

let dbInstance: any = null;
let clientInstance: any = null;

export async function getDb() {
  if (dbInstance) {
    return dbInstance;
  }

  if (env.DATABASE_URL && env.DATABASE_URL.trim() !== '') {
    // Production / Remote PostgreSQL via node-postgres
    const pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
    });
    clientInstance = pool;
    dbInstance = drizzleNodePg(pool, { schema });
  } else {
    // Zero-config Embedded PostgreSQL via PGlite
    const dataDir = path.resolve(process.cwd(), '.data/eggdrop-pg');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const pglite = new PGlite(dataDir);
    clientInstance = pglite;
    dbInstance = drizzlePglite(pglite, { schema });
  }

  // Ensure tables exist on boot
  await ensureTablesExist();

  return dbInstance;
}

export async function ensureTablesExist() {
  const initSql = `
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phone VARCHAR(20) NOT NULL UNIQUE,
      full_name VARCHAR(100) NOT NULL,
      hostel_block VARCHAR(50) NOT NULL,
      room_number VARCHAR(20),
      role VARCHAR(20) NOT NULL DEFAULT 'STUDENT',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS vendors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL,
      phone VARCHAR(20) NOT NULL UNIQUE,
      price_per_egg NUMERIC(6, 2) NOT NULL DEFAULT 6.50,
      commission_per_egg NUMERIC(6, 2) NOT NULL DEFAULT 0.50,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS delivery_cycles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
      delivery_date VARCHAR(20) NOT NULL,
      cutoff_time TIMESTAMPTZ NOT NULL,
      arrival_time VARCHAR(20) NOT NULL,
      departure_time VARCHAR(20) NOT NULL,
      location VARCHAR(150) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'UPCOMING',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cycle_id UUID NOT NULL REFERENCES delivery_cycles(id) ON DELETE CASCADE,
      student_id UUID REFERENCES users(id) ON DELETE SET NULL,
      quantity INTEGER NOT NULL,
      total_price NUMERIC(8, 2) NOT NULL,
      claim_code VARCHAR(20) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'RESERVED',
      collected_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_orders_cycle_id ON orders(cycle_id);
    CREATE INDEX IF NOT EXISTS idx_orders_claim_code ON orders(claim_code);
    CREATE INDEX IF NOT EXISTS idx_cycles_status ON delivery_cycles(status);
  `;

  if (clientInstance instanceof pg.Pool) {
    await clientInstance.query(initSql);
  } else if (clientInstance && typeof clientInstance.exec === 'function') {
    await clientInstance.exec(initSql);
  }
}

export { schema };
