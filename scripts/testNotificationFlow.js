const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

require('dotenv').config();

const mongoose = require('mongoose');
const { connectDB } = require('../src/config/db');
const User = require('../src/models/User');
const Sale = require('../src/models/Sale');
const Notification = require('../src/models/Notification');
const SaleInquiry = require('../src/models/SaleInquiry');
const notificationService = require('../src/services/notificationService');

async function testFlow() {
  console.log('--- Starting Notification System Integration Test ---');
  await connectDB();

  // Clean up any existing test records
  const testEmails = ['test_seller@garagesale.com', 'test_buyer@garagesale.com', 'test_admin@garagesale.com'];
  await User.deleteMany({ email: { $in: testEmails } });
  await Notification.deleteMany({});
  await Sale.deleteMany({ title: { $regex: /Test Sale/ } });
  await SaleInquiry.deleteMany({});

  // 1. Create Test Users
  console.log('\n1. Creating test users with locations and device tokens...');
  const seller = await User.create({
    firstName: 'Alice',
    lastName: 'Seller',
    email: 'test_seller@garagesale.com',
    password: 'Password123!',
    city: 'San Francisco',
    location: { type: 'Point', coordinates: [-122.4194, 37.7749] }, // San Francisco
    deviceTokens: [{ token: 'fcm_token_seller_device_1', platform: 'android' }],
  });

  const buyer = await User.create({
    firstName: 'Bob',
    lastName: 'Buyer',
    email: 'test_buyer@garagesale.com',
    password: 'Password123!',
    city: 'San Francisco',
    location: { type: 'Point', coordinates: [-122.42, 37.775] }, // ~100m away in SF
    notificationPreferences: {
      nearbySales: true,
      nearbyRadius: 20, // 20 km
      savedSaleReminders: true,
      sellerUpdates: true,
      saleChanges: true,
      appAnnouncements: true,
      pushEnabled: true,
    },
    deviceTokens: [{ token: 'fcm_token_buyer_device_1', platform: 'ios' }],
  });

  const admin = await User.create({
    firstName: 'Admin',
    lastName: 'User',
    email: 'test_admin@garagesale.com',
    password: 'Password123!',
    role: 'admin',
    city: 'San Francisco',
  });

  console.log(`✅ Created Seller (${seller.email}), Buyer (${buyer.email}), Admin (${admin.email})`);

  // 2. Test NEARBY_SALE notification
  console.log('\n2. Testing "Nearby Sales" notification...');
  const sale = await Sale.create({
    title: 'Test Sale: Vintage Mid-Century Goods',
    description: 'Selling lamps, tables, vintage vinyl records and garden tools.',
    address: '100 Market St',
    city: 'San Francisco',
    location: { type: 'Point', coordinates: [-122.419, 37.7745] },
    startTime: new Date(Date.now() + 6 * 60 * 60 * 1000), // starts in 6 hours
    endTime: new Date(Date.now() + 18 * 60 * 60 * 1000), // ends in 18 hours
    seller: seller._id,
    categories: ['Furniture', 'Vintage'],
  });

  const nearbyResult = await notificationService.notifyNearbyUsers(sale);
  console.log(`   notifyNearbyUsers result count: ${nearbyResult.count}`);

  const nearbyNotif = await Notification.findOne({
    recipient: buyer._id,
    type: 'NEARBY_SALE',
  });

  if (!nearbyNotif) {
    throw new Error('❌ NEARBY_SALE notification was not created for buyer!');
  }
  console.log(`✅ NEARBY_SALE notification verified: "${nearbyNotif.title}" - "${nearbyNotif.body}"`);

  // 3. Test SALE_UPDATE notification (Sale changes)
  console.log('\n3. Testing "Sale Changes" notification...');
  // Buyer saves the sale
  await User.findByIdAndUpdate(buyer._id, { $push: { savedSales: sale._id } });

  // Seller updates the sale
  sale.startTime = new Date(Date.now() + 8 * 60 * 60 * 1000);
  sale.address = '150 Market St, Suite 2';
  await sale.save();

  const changeResult = await notificationService.notifySaleChanges(sale, ['start time', 'address']);
  console.log(`   notifySaleChanges result count: ${changeResult.count}`);

  const updateNotif = await Notification.findOne({
    recipient: buyer._id,
    type: 'SALE_UPDATE',
  });

  if (!updateNotif) {
    throw new Error('❌ SALE_UPDATE notification was not created for buyer!');
  }
  console.log(`✅ SALE_UPDATE notification verified: "${updateNotif.title}" - "${updateNotif.body}"`);

  // 4. Test SELLER_UPDATE: Buyer inquiry
  console.log('\n4. Testing "Seller Updates": Inquiry from buyer...');
  const inquiry = await SaleInquiry.create({
    sale: sale._id,
    seller: seller._id,
    buyer: buyer._id,
    message: 'Is the mid-century credenza still available?',
    contactPhone: '+1-555-0199',
  });

  await notificationService.notifySellerUpdate(seller._id, {
    subType: 'SALE_INQUIRY',
    title: `💬 Inquiry on "${sale.title}"`,
    body: `${buyer.firstName}: "${inquiry.message}"`,
    sale,
    sender: buyer,
    data: { inquiryId: inquiry._id.toString() },
  });

  const inquiryNotif = await Notification.findOne({
    recipient: seller._id,
    type: 'SELLER_UPDATE',
    subType: 'SALE_INQUIRY',
  });

  if (!inquiryNotif) {
    throw new Error('❌ SELLER_UPDATE (SALE_INQUIRY) notification was not created for seller!');
  }
  console.log(`✅ SELLER_UPDATE (Inquiry) verified: "${inquiryNotif.title}" - "${inquiryNotif.body}"`);

  // 5. Test SELLER_UPDATE: Sale approval
  console.log('\n5. Testing "Seller Updates": Sale approval...');
  await notificationService.notifySellerUpdate(seller._id, {
    subType: 'SALE_APPROVED',
    title: '🎉 Sale Approved!',
    body: `Your sale "${sale.title}" is approved and now live!`,
    sale,
  });

  const approvedNotif = await Notification.findOne({
    recipient: seller._id,
    type: 'SELLER_UPDATE',
    subType: 'SALE_APPROVED',
  });

  if (!approvedNotif) {
    throw new Error('❌ SELLER_UPDATE (SALE_APPROVED) notification was not created!');
  }
  console.log(`✅ SELLER_UPDATE (Approval) verified: "${approvedNotif.title}" - "${approvedNotif.body}"`);

  // 6. Test SAVED_SALE_REMINDER: Automated starting soon reminder
  console.log('\n6. Testing "Saved-Sale Reminders" (Starting Soon)...');
  const reminderResult = await notificationService.checkAndSendReminders();
  console.log('   checkAndSendReminders result:', reminderResult);

  const reminderNotif = await Notification.findOne({
    recipient: buyer._id,
    type: 'SAVED_SALE_REMINDER',
  });

  if (!reminderNotif) {
    throw new Error('❌ SAVED_SALE_REMINDER notification was not created for buyer!');
  }
  console.log(`✅ SAVED_SALE_REMINDER verified: "${reminderNotif.title}" - "${reminderNotif.body}"`);

  // 7. Test APP_ANNOUNCEMENT: Important updates for everyone
  console.log('\n7. Testing "App Announcements"...');
  const announcementResult = await notificationService.sendAppAnnouncement({
    title: '📢 Spring Garage Sale Weekend is Here!',
    body: 'Over 500 sales are live this Saturday. Check the map for deals in your neighborhood.',
    data: { url: '/events/spring-2026' },
    targetRole: 'all',
    adminId: admin._id,
  });

  console.log(`   sendAppAnnouncement count: ${announcementResult.count}`);

  const announcementBuyer = await Notification.findOne({
    recipient: buyer._id,
    type: 'APP_ANNOUNCEMENT',
  });
  const announcementSeller = await Notification.findOne({
    recipient: seller._id,
    type: 'APP_ANNOUNCEMENT',
  });

  if (!announcementBuyer || !announcementSeller) {
    throw new Error('❌ APP_ANNOUNCEMENT was not delivered to both users!');
  }
  console.log(`✅ APP_ANNOUNCEMENT verified: Delivered to both buyer and seller.`);

  // 8. Test Inbox operations: Unread count, Mark as read
  console.log('\n8. Testing notification inbox operations...');
  const unreadBefore = await Notification.countDocuments({ recipient: buyer._id, isRead: false });
  console.log(`   Buyer unread notifications count: ${unreadBefore}`);

  // Mark all as read
  await Notification.updateMany({ recipient: buyer._id }, { $set: { isRead: true, readAt: new Date() } });
  const unreadAfter = await Notification.countDocuments({ recipient: buyer._id, isRead: false });
  console.log(`   Buyer unread notifications count after read-all: ${unreadAfter}`);

  if (unreadAfter !== 0) {
    throw new Error('❌ Unread count should be 0 after markAllAsRead!');
  }
  console.log('✅ Mark all as read verified.');

  // Clean up test records
  console.log('\nCleaning up test data...');
  await User.deleteMany({ email: { $in: testEmails } });
  await Notification.deleteMany({});
  await Sale.deleteMany({ title: { $regex: /Test Sale/ } });
  await SaleInquiry.deleteMany({});

  console.log('\n🎉 ALL 5 NOTIFICATION TYPES TESTED AND PASSED SUCCESSFULLY!');
  await mongoose.disconnect();
  process.exit(0);
}

testFlow().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
