import { pgTable, uuid, varchar, numeric, boolean, timestamp, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// 1. Users Table (Students & Admins)
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  phone: varchar('phone', { length: 20 }).notNull().unique(),
  fullName: varchar('full_name', { length: 100 }).notNull(),
  hostelBlock: varchar('hostel_block', { length: 50 }).notNull(),
  roomNumber: varchar('room_number', { length: 20 }),
  role: varchar('role', { length: 20 }).notNull().default('STUDENT'), // 'STUDENT' | 'VENDOR' | 'ADMIN'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 2. Vendors Table
export const vendors = pgTable('vendors', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  phone: varchar('phone', { length: 20 }).notNull().unique(),
  pricePerEgg: numeric('price_per_egg', { precision: 6, scale: 2 }).notNull().default('6.50'),
  commissionPerEgg: numeric('commission_per_egg', { precision: 6, scale: 2 }).notNull().default('0.50'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 3. Delivery Cycles Table
export const deliveryCycles = pgTable('delivery_cycles', {
  id: uuid('id').defaultRandom().primaryKey(),
  vendorId: uuid('vendor_id')
    .notNull()
    .references(() => vendors.id, { onDelete: 'cascade' }),
  deliveryDate: varchar('delivery_date', { length: 20 }).notNull(), // 'YYYY-MM-DD'
  cutoffTime: timestamp('cutoff_time', { withTimezone: true }).notNull(),
  arrivalTime: varchar('arrival_time', { length: 20 }).notNull(), // '17:00'
  departureTime: varchar('departure_time', { length: 20 }).notNull(), // '19:00'
  location: varchar('location', { length: 150 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('UPCOMING'), // 'UPCOMING' | 'LOCKED' | 'ACTIVE' | 'COMPLETED'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 4. Orders Table
export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  cycleId: uuid('cycle_id')
    .notNull()
    .references(() => deliveryCycles.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id').references(() => users.id, { onDelete: 'set null' }), // nullable for walk-ins
  quantity: integer('quantity').notNull(),
  totalPrice: numeric('total_price', { precision: 8, scale: 2 }).notNull(),
  claimCode: varchar('claim_code', { length: 20 }).notNull(), // e.g. "EG-482"
  status: varchar('status', { length: 20 }).notNull().default('RESERVED'), // 'RESERVED' | 'COLLECTED' | 'NO_SHOW' | 'CANCELLED'
  collectedAt: timestamp('collected_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  orders: many(orders),
}));

export const vendorsRelations = relations(vendors, ({ many }) => ({
  cycles: many(deliveryCycles),
}));

export const deliveryCyclesRelations = relations(deliveryCycles, ({ one, many }) => ({
  vendor: one(vendors, {
    fields: [deliveryCycles.vendorId],
    references: [vendors.id],
  }),
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  cycle: one(deliveryCycles, {
    fields: [orders.cycleId],
    references: [deliveryCycles.id],
  }),
  student: one(users, {
    fields: [orders.studentId],
    references: [users.id],
  }),
}));

// Export inferred types for high type-safety across backend
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Vendor = typeof vendors.$inferSelect;
export type NewVendor = typeof vendors.$inferInsert;

export type DeliveryCycle = typeof deliveryCycles.$inferSelect;
export type NewDeliveryCycle = typeof deliveryCycles.$inferInsert;

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
