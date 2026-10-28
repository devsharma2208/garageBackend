const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      maxlength: [50, 'First name cannot exceed 50 characters'],
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
      maxlength: [50, 'Last name cannot exceed 50 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
    },
    phone: {
      type: String,
      trim: true,
      default: null,
    },
    avatarUrl: {
      type: String,
      default: null,
    },
    city: {
      type: String,
      trim: true,
      default: null,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        default: [0, 0],
      },
    },
    bio: {
      type: String,
      maxlength: [500, 'Bio cannot exceed 500 characters'],
      default: null,
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    ratingCount: {
      type: Number,
      default: 0,
    },
    sellerBadge: {
      type: String,
      default: 'New Seller',
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    isBanned: {
      type: Boolean,
      default: false,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    savedSales: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Sale',
      },
    ],
    // Push notification device tokens (FCM)
    deviceTokens: [
      {
        token: { type: String, required: true },
        platform: { type: String, enum: ['android', 'ios', 'web'], default: 'android' },
        lastUsedAt: { type: Date, default: Date.now },
      },
    ],
    // User chosen alert area (allows alerts for a specific neighborhood/city)
    chosenArea: {
      address: { type: String, default: null },
      city: { type: String, default: null },
      location: {
        type: {
          type: String,
          enum: ['Point'],
          default: 'Point',
        },
        coordinates: {
          type: [Number],
          default: [0, 0], // [longitude, latitude]
        },
      },
      useChosenArea: { type: Boolean, default: false },
    },
    // User notification preferences
    notificationPreferences: {
      nearbySales: { type: Boolean, default: true },
      nearbyRadius: { type: Number, default: 15 }, // km (5, 10, 15, 25, 50)
      savedSaleReminders: { type: Boolean, default: true },
      sellerUpdates: { type: Boolean, default: true },
      saleChanges: { type: Boolean, default: true },
      appAnnouncements: { type: Boolean, default: true },
      pushEnabled: { type: Boolean, default: true },
    },
    refreshTokens: {
      type: [String],
      select: false,
      default: [],
    },
  },
  { timestamps: true }
);

userSchema.index({ location: '2dsphere' });
userSchema.index({ 'chosenArea.location': '2dsphere' });
userSchema.index({ 'deviceTokens.token': 1 });
// email already indexed by unique: true constraint

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

userSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.password;
    delete ret.refreshTokens;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);
