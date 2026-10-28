const express = require('express');
const { body } = require('express-validator');
const notificationController = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');
const { isAdmin } = require('../middleware/adminMiddleware');
const validate = require('../middleware/validate');

const router = express.Router();

// All notification routes require authentication
router.use(protect);

// ──────────────────────────────────────────────────────────
// Notification Inbox & Preferences
// ──────────────────────────────────────────────────────────
router.get('/', notificationController.getNotifications);
router.get('/unread-count', notificationController.getUnreadCount);
router.patch('/read-all', notificationController.markAllAsRead);
router.patch('/:id/read', notificationController.markAsRead);
router.delete('/:id', notificationController.deleteNotification);
router.delete('/', notificationController.clearAllNotifications);

// FCM device tokens management
router.post(
  '/device-token',
  [body('token').trim().notEmpty().withMessage('Device token is required')],
  validate,
  notificationController.registerDeviceToken
);
router.delete(
  '/device-token',
  [body('token').trim().notEmpty().withMessage('Device token is required')],
  validate,
  notificationController.unregisterDeviceToken
);

// User notification preferences & chosen area
router.get('/preferences', notificationController.getPreferences);
router.put('/preferences', notificationController.updatePreferences);

// Test FCM push notification
router.post('/test-push', notificationController.testPushNotification);

// Inquiries (triggers SELLER_UPDATE notification)
router.post(
  '/sales/:saleId/inquiry',
  [body('message').trim().notEmpty().withMessage('Message is required')],
  validate,
  notificationController.createSaleInquiry
);
router.get('/inquiries', notificationController.getMyInquiries);

// ──────────────────────────────────────────────────────────
// Admin Only Endpoints
// ──────────────────────────────────────────────────────────
router.post(
  '/announcements',
  isAdmin,
  [
    body('title').trim().notEmpty().withMessage('Announcement title is required'),
    body('body').trim().notEmpty().withMessage('Announcement body is required'),
  ],
  validate,
  notificationController.broadcastAnnouncement
);

router.post('/trigger-reminders', isAdmin, notificationController.triggerReminders);

module.exports = router;
