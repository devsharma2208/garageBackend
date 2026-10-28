const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Notification recipient is required'],
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    sale: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Sale',
      default: null,
    },
    type: {
      type: String,
      required: [true, 'Notification type is required'],
      enum: [
        'NEARBY_SALE',        // Nearby sales: A new sale is posted near user's chosen area
        'SAVED_SALE_REMINDER',// Saved-sale reminders: Sale is starting soon or ending soon
        'SELLER_UPDATE',      // Seller updates: Sale approved, receives inquiry, ending soon
        'SALE_UPDATE',        // Sale changes: Saved sale time, location, or details changed
        'APP_ANNOUNCEMENT',   // App announcements: Important updates for everyone
      ],
      index: true,
    },
    subType: {
      type: String,
      enum: [
        'NEW_NEARBY_SALE',
        'SALE_STARTING_SOON',
        'SALE_ENDING_SOON',
        'SALE_APPROVED',
        'SALE_INQUIRY',
        'SALE_DETAILS_CHANGED',
        'SALE_TIME_CHANGED',
        'SALE_LOCATION_CHANGED',
        'GENERAL_ANNOUNCEMENT',
      ],
      default: 'GENERAL_ANNOUNCEMENT',
    },
    title: {
      type: String,
      required: [true, 'Notification title is required'],
      trim: true,
      maxlength: [120, 'Title cannot exceed 120 characters'],
    },
    body: {
      type: String,
      required: [true, 'Notification body is required'],
      trim: true,
      maxlength: [1000, 'Body cannot exceed 1000 characters'],
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
    pushStatus: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'disabled', 'no_token'],
      default: 'pending',
    },
    pushError: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// Compound indexes for rapid lookups and filtering
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, isRead: 1 });
notificationSchema.index({ recipient: 1, type: 1 });

// Automatically expire notifications after 60 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

notificationSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Notification', notificationSchema);
