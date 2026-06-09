const mongoose = require('mongoose');

const registrationOTPSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    otp: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    },
  },
  { timestamps: true }
);

// TTL — MongoDB auto-deletes expired documents
registrationOTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
registrationOTPSchema.index({ email: 1 });

module.exports = mongoose.model('RegistrationOTP', registrationOTPSchema);
