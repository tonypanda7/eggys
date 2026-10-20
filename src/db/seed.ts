import { getDb, schema } from './index.js';
import { eq } from 'drizzle-orm';

async function seed() {
  console.log('🌱 Seeding database...');
  const db = await getDb();

  // 1. Seed Default Vendor
  let [vendor] = await db
    .select()
    .from(schema.vendors)
    .where(eq(schema.vendors.phone, '9876543210'));

  if (!vendor) {
    const [created] = await db
      .insert(schema.vendors)
      .values({
        name: 'Kumar Poultry & Egg Supplies',
        phone: '9876543210',
        pricePerEgg: '6.50',
        commissionPerEgg: '0.50',
        isActive: true,
      })
      .returning();
    vendor = created;
    console.log(`✅ Created Vendor: ${vendor.name} (${vendor.phone})`);
  } else {
    console.log(`ℹ️ Vendor already exists: ${vendor.name}`);
  }

  // 2. Seed Active Delivery Cycle
  const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
  const delivery = new Date(Date.now() + 36 * 60 * 60 * 1000); // 36 hours from now
  const deliveryDateStr = delivery.toISOString().split('T')[0];

  const [existingCycle] = await db
    .select()
    .from(schema.deliveryCycles)
    .where(eq(schema.deliveryCycles.status, 'UPCOMING'));

  let cycleId = existingCycle?.id;

  if (!existingCycle) {
    const [newCycle] = await db
      .insert(schema.deliveryCycles)
      .values({
        vendorId: vendor.id,
        deliveryDate: deliveryDateStr,
        cutoffTime: cutoff,
        arrivalTime: '17:00',
        departureTime: '19:00',
        location: 'Hostel Block B Main Gate',
        status: 'UPCOMING',
      })
      .returning();
    cycleId = newCycle.id;
    console.log(`✅ Created Active Cycle for ${deliveryDateStr} at ${newCycle.location}`);
  } else {
    console.log(`ℹ️ Active cycle already exists (ID: ${existingCycle.id})`);
  }

  // 3. Seed Demo Students
  const students = [
    { phone: '9999911111', fullName: 'Rahul Sharma', hostelBlock: 'Block B', roomNumber: '204' },
    { phone: '9999922222', fullName: 'Sneha Patel', hostelBlock: 'Girls Hostel 1', roomNumber: '108' },
  ];

  for (const s of students) {
    let [user] = await db.select().from(schema.users).where(eq(schema.users.phone, s.phone));
    if (!user) {
      const [createdUser] = await db
        .insert(schema.users)
        .values({
          phone: s.phone,
          fullName: s.fullName,
          hostelBlock: s.hostelBlock,
          roomNumber: s.roomNumber,
          role: 'STUDENT',
        })
        .returning();
      user = createdUser;
      console.log(`✅ Created Student: ${user.fullName} (${user.phone})`);
    }

    // Add sample order for this student in the active cycle
    if (cycleId) {
      const [existingOrder] = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.studentId, user.id));

      if (!existingOrder) {
        const qty = s.phone.endsWith('11111') ? 30 : 12;
        const total = (qty * Number(vendor.pricePerEgg)).toFixed(2);
        const code = `EG-${s.phone.slice(-3)}`;

        await db.insert(schema.orders).values({
          cycleId,
          studentId: user.id,
          quantity: qty,
          totalPrice: total,
          claimCode: code,
          status: 'RESERVED',
        });
        console.log(`   🥚 Created Reservation: ${qty} eggs (Token: ${code}) for ${user.fullName}`);
      }
    }
  }

  console.log('\n🎉 Database seeding completed successfully!\n');
}

seed().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
