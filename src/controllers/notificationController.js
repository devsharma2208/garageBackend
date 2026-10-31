const Notification = require('../models/Notification');
const SaleInquiry = require('../models/SaleInquiry');
const Sale = require('../models/Sale');
const User = require('../models/User');
const { success } = require('../utils/response');
const { ApiError } = require('../middleware/errorHandler');
const notificationService = require('../services/notificationService');
const { isFirebaseReady } = require('../config/firebase');

// GET /api/notifications
exports.getNotifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, isRead, type } = req.query;

    const query = { recipient: req.user._id };

    if (isRead !== undefined) {
      query.isRead = isRead === 'true';
    }

    if (type) {
      query.type = type;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('sale', 'title address city images startTime endTime isActive')
        .populate('sender', 'firstName lastName avatarUrl sellerBadge'),
      Notification.countDocuments(query),
      Notification.countDocuments({ recipient: req.user._id, isRead: false }),
    ]);

    return success(res, {
      notifications,
      unreadCount,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/notifications/unread-count
exports.getUnreadCount = async (req, res, next) => {
  try {
    const unreadCount = await Notification.countDocuments({
      recipient: req.user._id,
      isRead: false,
    });

    return success(res, { unreadCount });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/notifications/:id/read
exports.markAsRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      recipient: req.user._id,
    });

    if (!notification) throw new ApiError('Notification not found', 404);

    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();

    return success(res, { notification }, 'Notification marked as read');
  } catch (err) {
    next(err);
  }
};

// PATCH /api/notifications/read-all
exports.markAllAsRead = async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { recipient: req.user._id, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    return success(res, { modifiedCount: result.modifiedCount }, 'All notifications marked as read');
  } catch (err) {
    next(err);
  }
};

// DELETE /api/notifications/:id
exports.deleteNotification = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      recipient: req.user._id,
    });

    if (!notification) throw new ApiError('Notification not found', 404);

    return success(res, null, 'Notification deleted successfully');
  } catch (err) {
    next(err);
  }
};

// DELETE /api/notifications
exports.clearAllNotifications = async (req, res, next) => {
  try {
    await Notification.deleteMany({ recipient: req.user._id });
    return success(res, null, 'All notifications cleared successfully');
  } catch (err) {
    next(err);
  }
};

// POST /api/notifications/device-token
exports.registerDeviceToken = async (req, res, next) => {
  try {
    const { token, platform = 'android' } = req.body;
    if (!token) throw new ApiError('Device token is required', 400);

    // Remove token from other users if it was reassigned to this device
    await User.updateMany(
      { _id: { $ne: req.user._id }, 'deviceTokens.token': token },
      { $pull: { deviceTokens: { token } } }
    );

    // Atomic updates so logins from several devices at once don't overwrite each other's tokens
    const now = new Date();
    const refreshed = await User.updateOne(
      { _id: req.user._id, 'deviceTokens.token': token },
      { $set: { 'deviceTokens.$.lastUsedAt': now, 'deviceTokens.$.platform': platform } }
    );

    if (refreshed.matchedCount === 0) {
      await User.updateOne(
        { _id: req.user._id, 'deviceTokens.token': { $ne: token } },
        { $push: { deviceTokens: { token, platform, lastUsedAt: now } } }
      );
    }

    const user = await User.findById(req.user._id).select('deviceTokens');

    return success(res, { tokensCount: user.deviceTokens.length }, 'Device token registered successfully');
  } catch (err) {
    next(err);
  }
};

// DELETE /api/notifications/device-token
exports.unregisterDeviceToken = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) throw new ApiError('Device token is required', 400);

    await User.findByIdAndUpdate(req.user._id, {
      $pull: { deviceTokens: { token } },
    });

    return success(res, null, 'Device token unregistered successfully');
  } catch (err) {
    next(err);
  }
};

// GET /api/notifications/preferences
exports.getPreferences = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select(
      'notificationPreferences chosenArea location city'
    );

    return success(res, {
      preferences: user.notificationPreferences || {},
      chosenArea: user.chosenArea || {},
      currentLocation: user.location,
      city: user.city,
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/notifications/preferences
exports.updatePreferences = async (req, res, next) => {
  try {
    const {
      nearbySales,
      nearbyRadius,
      savedSaleReminders,
      sellerUpdates,
      saleChanges,
      appAnnouncements,
      pushEnabled,
      chosenArea,
    } = req.body;

    const updateFields = {};

    if (nearbySales !== undefined) updateFields['notificationPreferences.nearbySales'] = Boolean(nearbySales);
    if (nearbyRadius !== undefined) updateFields['notificationPreferences.nearbyRadius'] = Number(nearbyRadius);
    if (savedSaleReminders !== undefined) updateFields['notificationPreferences.savedSaleReminders'] = Boolean(savedSaleReminders);
    if (sellerUpdates !== undefined) updateFields['notificationPreferences.sellerUpdates'] = Boolean(sellerUpdates);
    if (saleChanges !== undefined) updateFields['notificationPreferences.saleChanges'] = Boolean(saleChanges);
    if (appAnnouncements !== undefined) updateFields['notificationPreferences.appAnnouncements'] = Boolean(appAnnouncements);
    if (pushEnabled !== undefined) updateFields['notificationPreferences.pushEnabled'] = Boolean(pushEnabled);

    if (chosenArea) {
      if (chosenArea.address !== undefined) updateFields['chosenArea.address'] = chosenArea.address;
      if (chosenArea.city !== undefined) updateFields['chosenArea.city'] = chosenArea.city;
      if (chosenArea.useChosenArea !== undefined) updateFields['chosenArea.useChosenArea'] = Boolean(chosenArea.useChosenArea);
      if (chosenArea.latitude !== undefined && chosenArea.longitude !== undefined) {
        updateFields['chosenArea.location'] = {
          type: 'Point',
          coordinates: [parseFloat(chosenArea.longitude), parseFloat(chosenArea.latitude)],
        };
      }
    }

    const updatedUser = await User.findByIdAndUpdate(req.user._id, { $set: updateFields }, { new: true }).select(
      'notificationPreferences chosenArea location city'
    );

    return success(
      res,
      {
        preferences: updatedUser.notificationPreferences,
        chosenArea: updatedUser.chosenArea,
      },
      'Notification preferences updated successfully'
    );
  } catch (err) {
    next(err);
  }
};

// POST /api/notifications/test-push
exports.testPushNotification = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user.deviceTokens || user.deviceTokens.length === 0) {
      return success(
        res,
        {
          firebaseReady: isFirebaseReady(),
          tokensRegistered: 0,
        },
        'No device tokens registered for this user yet. Register a device token first via POST /api/notifications/device-token.'
      );
    }

    const title = '🔔 Test Push Notification';
    const body = `Hello ${user.firstName}! Firebase push notifications are working smoothly.`;
    const data = {
      type: 'TEST_PUSH',
      timestamp: new Date().toISOString(),
    };

    const tokens = user.deviceTokens.map((dt) => dt.token);
    const { sendMulticast } = require('../config/firebase');

    const result = await sendMulticast(tokens, { title, body, data });

    return success(
      res,
      {
        firebaseReady: isFirebaseReady(),
        tokensTargeted: tokens.length,
        result,
      },
      result.mock
        ? 'Test notification processed in mock mode (credentials not configured)'
        : 'Test notification sent to your device(s)'
    );
  } catch (err) {
    next(err);
  }
};

// POST /api/notifications/sales/:saleId/inquiry
// Submits an inquiry to the seller and triggers SELLER_UPDATE notification
exports.createSaleInquiry = async (req, res, next) => {
  try {
    const { saleId } = req.params;
    const { message, contactPhone, contactEmail } = req.body;

    if (!message || message.trim().length === 0) {
      throw new ApiError('Inquiry message cannot be empty', 400);
    }

    const sale = await Sale.findById(saleId).populate('seller', 'firstName lastName deviceTokens notificationPreferences');
    if (!sale) throw new ApiError('Sale not found', 404);

    if (sale.seller._id.toString() === req.user._id.toString()) {
      throw new ApiError('You cannot send an inquiry on your own sale', 400);
    }

    const inquiry = await SaleInquiry.create({
      sale: sale._id,
      seller: sale.seller._id,
      buyer: req.user._id,
      message: message.trim(),
      contactPhone: contactPhone || req.user.phone,
      contactEmail: contactEmail || req.user.email,
    });

    const buyerName = `${req.user.firstName} ${req.user.lastName}`.trim();
    const truncatedMessage = message.length > 80 ? `${message.substring(0, 80)}...` : message;

    // Trigger SELLER_UPDATE notification
    await notificationService.notifySellerUpdate(sale.seller._id, {
      subType: 'SALE_INQUIRY',
      title: `💬 Inquiry on "${sale.title}"`,
      body: `${buyerName}: "${truncatedMessage}"`,
      sale,
      sender: req.user,
      data: {
        inquiryId: inquiry._id.toString(),
        buyerName,
      },
    });

    return success(res, { inquiry }, 'Inquiry sent to seller successfully', 201);
  } catch (err) {
    next(err);
  }
};

// GET /api/notifications/inquiries
// Gets all inquiries received by the logged in seller
exports.getMyInquiries = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [inquiries, total] = await Promise.all([
      SaleInquiry.find({ seller: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('sale', 'title address city images')
        .populate('buyer', 'firstName lastName avatarUrl email phone'),
      SaleInquiry.countDocuments({ seller: req.user._id }),
    ]);

    return success(res, {
      inquiries,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/notifications/announcements (Admin only)
exports.broadcastAnnouncement = async (req, res, next) => {
  try {
    const { title, body, targetRole = 'all', data = {} } = req.body;

    if (!title || !body) {
      throw new ApiError('Title and body are required for announcement', 400);
    }

    const result = await notificationService.sendAppAnnouncement({
      title,
      body,
      data,
      targetRole,
      adminId: req.user._id,
    });

    return success(
      res,
      result,
      `App announcement sent to ${result.count || 0} users`,
      201
    );
  } catch (err) {
    next(err);
  }
};

// POST /api/notifications/trigger-reminders (Admin/Cron)
exports.triggerReminders = async (req, res, next) => {
  try {
    const result = await notificationService.checkAndSendReminders();
    return success(res, result, 'Reminders check triggered successfully');
  } catch (err) {
    next(err);
  }
};
