const mongoose = require('mongoose');

const saleInquirySchema = new mongoose.Schema(
  {
    sale: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Sale',
      required: true,
      index: true,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    message: {
      type: String,
      required: [true, 'Inquiry message is required'],
      trim: true,
      maxlength: [1000, 'Message cannot exceed 1000 characters'],
    },
    contactPhone: {
      type: String,
      trim: true,
      default: null,
    },
    contactEmail: {
      type: String,
      trim: true,
      default: null,
    },
    status: {
      type: String,
      enum: ['unread', 'read', 'replied'],
      default: 'unread',
    },
  },
  { timestamps: true }
);

saleInquirySchema.index({ seller: 1, createdAt: -1 });
saleInquirySchema.index({ buyer: 1, createdAt: -1 });

module.exports = mongoose.model('SaleInquiry', saleInquirySchema);
