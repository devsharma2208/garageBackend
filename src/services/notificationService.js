const User = require('../models/User');
const Sale = require('../models/Sale');
const Notification = require('../models/Notification');
const { sendMulticast } = require('../config/firebase');
const logger = require('../utils/logger');

// Haversine formula to compute spherical distance between two coordinates in km
function calculateDistanceInKm(lat1, lon1, lat2, lon2) {
  if (
    lat1 === undefined ||
    lon1 === undefined ||
    lat2 === undefined ||
    lon2 === undefined ||
    (lat1 === 0 && lon1 === 0) ||
    (lat2 === 0 && lon2 === 0)
  ) {
    return null;
  }

  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371; // Earth's radius in km

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Prune dead/invalid FCM tokens from User documents
async function pruneInvalidTokens(invalidTokens = []) {
  if (!invalidTokens || invalidTokens.length === 0) return;
  try {
    await User.updateMany(
      { 'deviceTokens.token': { $in: invalidTokens } },
      { $pull: { deviceTokens: { token: { $in: invalidTokens } } } }
    );
    logger.info(`Pruned ${invalidTokens.length} expired/invalid FCM device tokens`);
  } catch (err) {
    logger.error('Error pruning invalid FCM tokens:', err.message);
  }
}

// Notification.title has maxlength 120; titles built from sale titles/cities can exceed it
const MAX_TITLE_LENGTH = 120;
function fitTitle(title = '') {
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
}

const hasToken = (user) => (user.deviceTokens || []).some((dt) => dt.token);
const wantsPush = (user) => user.notificationPreferences?.pushEnabled !== false;

/**
 * Saves one inbox notification per user, then pushes to users who have push enabled.
 * Users with push turned off still get the inbox entry (pushStatus: 'disabled').
 * @param {object[]} users - must include deviceTokens and notificationPreferences
 * @param {object} options - forUser(user) can return per-user overrides such as { body, data }
 */
async function deliver(users, {
  type,
  subType,
  title,
  body,
  data = {},
  sale = null,
  sender = null,
  imageUrl = null,
  forUser = null,
}) {
  if (!users || users.length === 0) return [];

  const safeTitle = fitTitle(title);

  const docs = users.map((user) => {
    let pushStatus = 'sent';
    if (!wantsPush(user)) pushStatus = 'disabled';
    else if (!hasToken(user)) pushStatus = 'no_token';

    return {
      recipient: user._id,
      sender: sender?._id || sender || null,
      sale: sale?._id || sale || null,
      type,
      subType,
      title: safeTitle,
      body,
      data,
      pushStatus,
      ...(forUser ? forUser(user) : {}),
    };
  });

  const notifications = await Notification.insertMany(docs);

  const tokens = users
    .filter(wantsPush)
    .flatMap((u) => u.deviceTokens || [])
    .map((dt) => dt.token)
    .filter(Boolean);

  if (tokens.length > 0) {
    const pushResult = await sendMulticast(tokens, { title: safeTitle, body, data, imageUrl });

    if (pushResult.invalidTokens?.length > 0) {
      await pruneInvalidTokens(pushResult.invalidTokens);
    }

    if (pushResult.successCount === 0) {
      const ids = notifications.filter((n) => n.pushStatus === 'sent').map((n) => n._id);
      await Notification.updateMany(
        { _id: { $in: ids } },
        { $set: { pushStatus: 'failed', pushError: pushResult.error || 'All push deliveries failed' } }
      );
    }
  }

  return notifications;
}

/**
 * 1. NEARBY SALES: A new sale is posted near a user's chosen area
 * Finds users whose location or chosen area is within their notification radius.
 */
async function notifyNearbyUsers(sale) {
  try {
    if (!sale || !sale.location || !sale.location.coordinates) {
      return { success: false, reason: 'Invalid sale location' };
    }

    const [saleLng, saleLat] = sale.location.coordinates;
    const sellerId = sale.seller?._id || sale.seller;

    // Find all active users except the seller who have nearbySales notifications enabled
    const users = await User.find({
      _id: { $ne: sellerId },
      isBanned: false,
      'notificationPreferences.nearbySales': { $ne: false },
    }).select('firstName lastName deviceTokens notificationPreferences chosenArea location city');

    const matchedUsers = [];
    const distances = new Map();

    for (const user of users) {
      const radiusKm = user.notificationPreferences?.nearbyRadius || 15;

      // Determine user's active target coordinates: chosenArea vs profile location
      let userLng = 0;
      let userLat = 0;
      let userCity = user.city || '';

      if (
        user.chosenArea?.useChosenArea &&
        user.chosenArea?.location?.coordinates?.length === 2 &&
        (user.chosenArea.location.coordinates[0] !== 0 || user.chosenArea.location.coordinates[1] !== 0)
      ) {
        [userLng, userLat] = user.chosenArea.location.coordinates;
        if (user.chosenArea.city) userCity = user.chosenArea.city;
      } else if (user.location?.coordinates?.length === 2) {
        [userLng, userLat] = user.location.coordinates;
      }

      const distance = calculateDistanceInKm(userLat, userLng, saleLat, saleLng);

      // Match if within user's preferred radius, or fallback to same city if coords are unset
      let isMatch = false;
      if (distance !== null) {
        isMatch = distance <= radiusKm;
      } else if (userCity && sale.city && userCity.trim().toLowerCase() === sale.city.trim().toLowerCase()) {
        isMatch = true;
      }

      if (isMatch) {
        matchedUsers.push(user);
        distances.set(user._id.toString(), distance !== null ? Math.round(distance * 10) / 10 : null);
      }
    }

    if (matchedUsers.length === 0) {
      logger.info(`No nearby users matched for sale "${sale.title}" (city: ${sale.city})`);
      return { count: 0 };
    }

    const body = `"${sale.title}" was just posted near your chosen area. Check out the items!`;
    const fcmData = {
      type: 'NEARBY_SALE',
      saleId: sale._id.toString(),
      city: sale.city || '',
      action: 'VIEW_SALE',
    };

    await deliver(matchedUsers, {
      type: 'NEARBY_SALE',
      subType: 'NEW_NEARBY_SALE',
      title: `🏷️ New Sale in ${sale.city || 'your area'}!`,
      body,
      data: fcmData,
      sale,
      imageUrl: sale.images?.[0] || null,
      forUser: (user) => {
        const distance = distances.get(user._id.toString());
        return {
          body: distance ? `${body} (~${distance} km away)` : body,
          data: { ...fcmData, distanceKm: distance },
        };
      },
    });

    logger.info(`Notified ${matchedUsers.length} users of nearby sale "${sale.title}"`);
    return { count: matchedUsers.length };
  } catch (err) {
    logger.error('Error in notifyNearbyUsers:', err);
    return { success: false, error: err.message };
  }
}

/**
 * 2. SAVED-SALE REMINDERS: A sale they saved is starting soon or ending soon
 */
async function notifySavedSaleReminder(sale, subType = 'SALE_STARTING_SOON') {
  try {
    const isStarting = subType === 'SALE_STARTING_SOON';
    const timeFormatted = isStarting
      ? new Date(sale.startTime).toLocaleString()
      : new Date(sale.endTime).toLocaleString();

    // Find users who have saved this sale and have reminders enabled
    const users = await User.find({
      savedSales: sale._id,
      isBanned: false,
      'notificationPreferences.savedSaleReminders': { $ne: false },
    }).select('firstName lastName deviceTokens notificationPreferences');

    if (users.length === 0) return { count: 0 };

    await deliver(users, {
      type: 'SAVED_SALE_REMINDER',
      subType,
      title: isStarting ? '⏰ Saved Sale Starting Soon!' : '⏳ Saved Sale Ending Soon!',
      body: isStarting
        ? `"${sale.title}" starts soon (${timeFormatted}). Don't miss out!`
        : `"${sale.title}" ends soon (${timeFormatted}). Last chance for deals!`,
      data: {
        type: 'SAVED_SALE_REMINDER',
        subType,
        saleId: sale._id.toString(),
        action: 'VIEW_SALE',
      },
      sale,
      imageUrl: sale.images?.[0] || null,
    });

    logger.info(`Sent ${subType} reminder to ${users.length} users for sale "${sale.title}"`);
    return { count: users.length };
  } catch (err) {
    logger.error('Error in notifySavedSaleReminder:', err);
    return { success: false, error: err.message };
  }
}

/**
 * 3. SELLER UPDATES: Their sale is approved, receives an inquiry, or is ending soon
 */
async function notifySellerUpdate(sellerId, {
  subType,
  title,
  body,
  sale = null,
  sender = null,
  data = {},
}) {
  try {
    const user = await User.findById(sellerId).select(
      'firstName lastName deviceTokens notificationPreferences isBanned'
    );

    if (!user || user.isBanned) return { count: 0 };
    if (user.notificationPreferences?.sellerUpdates === false) return { count: 0 };

    const [notification] = await deliver([user], {
      type: 'SELLER_UPDATE',
      subType,
      title,
      body,
      data: {
        type: 'SELLER_UPDATE',
        subType,
        saleId: sale?._id ? sale._id.toString() : (sale ? sale.toString() : ''),
        ...(sender ? { senderId: sender._id ? sender._id.toString() : sender.toString() } : {}),
        action: subType === 'SALE_INQUIRY' ? 'VIEW_INQUIRIES' : 'VIEW_SALE',
        ...data,
      },
      sale,
      sender,
      imageUrl: sale?.images?.[0] || null,
    });

    logger.info(`Sent seller update (${subType}) to user ${sellerId}`);
    return { count: 1, notification };
  } catch (err) {
    logger.error('Error in notifySellerUpdate:', err);
    return { success: false, error: err.message };
  }
}

/**
 * 4. SALE CHANGES: A saved sale's time, location, or details have changed
 */
async function notifySaleChanges(sale, changedFields = []) {
  try {
    if (!changedFields || changedFields.length === 0) return { count: 0 };

    const sellerId = sale.seller?._id || sale.seller;

    // Find users who saved this sale (excluding the seller)
    const users = await User.find({
      savedSales: sale._id,
      _id: { $ne: sellerId },
      isBanned: false,
      'notificationPreferences.saleChanges': { $ne: false },
    }).select('firstName lastName deviceTokens notificationPreferences');

    if (users.length === 0) return { count: 0 };

    const changesText = changedFields.join(', ');

    let subType = 'SALE_DETAILS_CHANGED';
    if (changedFields.some((f) => f.includes('time') || f.includes('Time'))) {
      subType = 'SALE_TIME_CHANGED';
    } else if (changedFields.some((f) => f.includes('address') || f.includes('location') || f.includes('city'))) {
      subType = 'SALE_LOCATION_CHANGED';
    }

    await deliver(users, {
      type: 'SALE_UPDATE',
      subType,
      title: `✏️ Changes to Saved Sale: "${sale.title}"`,
      body: `The seller updated ${changesText} for "${sale.title}". View the latest details.`,
      data: {
        type: 'SALE_UPDATE',
        subType,
        saleId: sale._id.toString(),
        changes: changesText,
        action: 'VIEW_SALE',
      },
      sale,
      imageUrl: sale.images?.[0] || null,
    });

    logger.info(`Notified ${users.length} users of changes (${changesText}) to sale "${sale.title}"`);
    return { count: users.length };
  } catch (err) {
    logger.error('Error in notifySaleChanges:', err);
    return { success: false, error: err.message };
  }
}

/**
 * 5. APP ANNOUNCEMENTS: Important updates for everyone—keep these occasional
 */
async function sendAppAnnouncement({
  title,
  body,
  data = {},
  targetRole = 'all',
  adminId = null,
}) {
  try {
    const query = {
      isBanned: false,
      'notificationPreferences.appAnnouncements': { $ne: false },
    };

    if (targetRole !== 'all' && ['user', 'admin'].includes(targetRole)) {
      query.role = targetRole;
    }

    const users = await User.find(query).select('firstName lastName deviceTokens notificationPreferences');
    if (users.length === 0) return { count: 0, pushedCount: 0 };

    await deliver(users, {
      type: 'APP_ANNOUNCEMENT',
      subType: 'GENERAL_ANNOUNCEMENT',
      title,
      body,
      data: {
        type: 'APP_ANNOUNCEMENT',
        subType: 'GENERAL_ANNOUNCEMENT',
        action: 'OPEN_ANNOUNCEMENT',
        ...data,
      },
      sender: adminId,
    });

    const pushedCount = users.filter((u) => wantsPush(u) && hasToken(u)).length;

    logger.info(`Broadcast app announcement to ${users.length} users: "${title}"`);
    return { count: users.length, pushedCount };
  } catch (err) {
    logger.error('Error in sendAppAnnouncement:', err);
    return { success: false, error: err.message };
  }
}

/**
 * BACKGROUND / CRON: Automated checks for starting soon and ending soon reminders
 */
async function checkAndSendReminders() {
  try {
    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const in2Hours = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    // 1. Sales starting within the next 24 hours that haven't sent a starting reminder
    const startingSoonSales = await Sale.find({
      isActive: true,
      startTime: { $gte: now, $lte: in24Hours },
      reminderStartingSent: false,
    });

    for (const sale of startingSoonSales) {
      await notifySavedSaleReminder(sale, 'SALE_STARTING_SOON');
      sale.reminderStartingSent = true;
      await sale.save();
    }

    // 2. Sales ending within next 2 hours that haven't sent an ending reminder
    const endingSoonSales = await Sale.find({
      isActive: true,
      endTime: { $gte: now, $lte: in2Hours },
      reminderEndingSent: false,
    }).populate('seller', 'firstName lastName deviceTokens');

    for (const sale of endingSoonSales) {
      // Notify seller
      await notifySellerUpdate(sale.seller?._id || sale.seller, {
        subType: 'SALE_ENDING_SOON',
        title: '⏳ Your Sale is Ending Soon!',
        body: `"${sale.title}" is ending in less than 2 hours. Pack up or offer final markdowns!`,
        sale,
      });

      // Notify saved buyers
      await notifySavedSaleReminder(sale, 'SALE_ENDING_SOON');

      sale.reminderEndingSent = true;
      await sale.save();
    }

    return {
      startingRemindersSent: startingSoonSales.length,
      endingRemindersSent: endingSoonSales.length,
    };
  } catch (err) {
    logger.error('Error in checkAndSendReminders:', err);
    return { error: err.message };
  }
}

module.exports = {
  notifyNearbyUsers,
  notifySavedSaleReminder,
  notifySellerUpdate,
  notifySaleChanges,
  sendAppAnnouncement,
  checkAndSendReminders,
  pruneInvalidTokens,
  calculateDistanceInKm,
};
