/**
 * Run once to create the first admin account (or promote an existing user).
 * Usage: node scripts/createAdmin.js [email] [password]
 *
 * Defaults:
 *   email:    admin@garagesale.com
 *   password: Admin@12345
 */
require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../src/models/User');
const { connectDB } = require('../src/config/db');

const EMAIL = process.argv[2] || 'admin@garagesale.com';
const PASSWORD = process.argv[3] || 'Admin@12345';

const run = async () => {
  await connectDB();

  const existing = await User.findOne({ email: EMAIL }).select('+password');

  if (existing) {
    if (existing.role === 'admin') {
      console.log(`✅ Admin already exists: ${EMAIL}`);
    } else {
      await User.findByIdAndUpdate(existing._id, { role: 'admin' });
      console.log(`✅ Promoted existing user to admin: ${EMAIL}`);
    }
  } else {
    await User.create({
      firstName: 'Super',
      lastName: 'Admin',
      email: EMAIL,
      password: PASSWORD,
      role: 'admin',
    });
    console.log(`✅ Admin created:`);
    console.log(`   Email:    ${EMAIL}`);
    console.log(`   Password: ${PASSWORD}`);
    console.log(`   ⚠️  Change the password after first login!`);
  }

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
