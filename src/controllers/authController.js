const bcrypt = require('bcryptjs');
const User = require('../models/User');
const PasswordReset = require('../models/PasswordReset');
const RegistrationOTP = require('../models/RegistrationOTP');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { sendOTPEmail, sendRegistrationOTPEmail } = require('../utils/email');
const { success } = require('../utils/response');
const { ApiError } = require('../middleware/errorHandler');

const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

// POST /api/auth/send-registration-otp
exports.sendRegistrationOTP = async (req, res, next) => {
  try {
    const { email } = req.body;

    const existing = await User.findOne({ email });
    if (existing) throw new ApiError('Email is already registered', 400);

    // Clear any previous OTPs for this email
    await RegistrationOTP.deleteMany({ email });

    const otp = generateOTP();
    const hashedOtp = await bcrypt.hash(otp, 8);

    await RegistrationOTP.create({ email, otp: hashedOtp });
    await sendRegistrationOTPEmail(email, otp);

    return success(res, null, 'Verification code sent to your email');
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/register
exports.register = async (req, res, next) => {
  try {
    const { firstName, lastName, email, password, phone, otp, latitude, longitude } = req.body;

    const existing = await User.findOne({ email });
    if (existing) throw new ApiError('Email is already registered', 400);

    // Verify registration OTP
    const otpRecord = await RegistrationOTP.findOne({
      email,
      expiresAt: { $gt: new Date() },
    });
    if (!otpRecord) throw new ApiError('Verification code has expired. Please request a new one.', 400);

    const isMatch = await bcrypt.compare(otp, otpRecord.otp);
    if (!isMatch) throw new ApiError('Invalid verification code', 400);

    // Build user data
    const userData = { firstName, lastName, email, password, phone };
    if (latitude && longitude) {
      userData.location = {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)],
      };
    }

    const user = await User.create(userData);

    // Clean up OTP record
    await RegistrationOTP.deleteMany({ email });

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    await User.findByIdAndUpdate(user._id, { $push: { refreshTokens: refreshToken } });

    return success(res, { user, accessToken, refreshToken }, 'Registration successful', 201);
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/login
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password +refreshTokens');
    if (!user) throw new ApiError('Invalid email or password', 401);

    const isMatch = await user.comparePassword(password);
    if (!isMatch) throw new ApiError('Invalid email or password', 401);

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    // Keep last 5 refresh tokens
    const tokens = [...(user.refreshTokens || []), refreshToken].slice(-5);
    await User.findByIdAndUpdate(user._id, { refreshTokens: tokens });

    user.password = undefined;
    user.refreshTokens = undefined;

    return success(res, { user, accessToken, refreshToken }, 'Login successful');
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/logout
exports.logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken && req.user) {
      await User.findByIdAndUpdate(req.user._id, {
        $pull: { refreshTokens: refreshToken },
      });
    }
    return success(res, null, 'Logged out successfully');
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/refresh-token
exports.refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw new ApiError('Refresh token required', 401);

    const decoded = verifyRefreshToken(refreshToken);
    const user = await User.findById(decoded.id).select('+refreshTokens');
    if (!user || !user.refreshTokens.includes(refreshToken)) {
      throw new ApiError('Invalid or reused refresh token', 401);
    }

    const newAccessToken = generateAccessToken(user._id);
    const newRefreshToken = generateRefreshToken(user._id);

    // Rotate: remove old, add new
    const tokens = user.refreshTokens
      .filter((t) => t !== refreshToken)
      .concat(newRefreshToken)
      .slice(-5);
    await User.findByIdAndUpdate(user._id, { refreshTokens: tokens });

    return success(res, { accessToken: newAccessToken, refreshToken: newRefreshToken }, 'Token refreshed');
  } catch (err) {
    next(err);
  }
};

// GET /api/auth/me
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate(
      'savedSales',
      'title images city address endTime isActive'
    );
    return success(res, { user }, 'User fetched successfully');
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/forgot-password
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) throw new ApiError('No account found with this email', 404);

    // Delete any existing OTPs for this email
    await PasswordReset.deleteMany({ email });

    const otp = generateOTP();
    const hashedOtp = await bcrypt.hash(otp, 8);

    await PasswordReset.create({
      email,
      otp: hashedOtp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    await sendOTPEmail(email, otp);

    return success(res, null, 'OTP sent to your email address');
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/verify-otp
exports.verifyOTP = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    const record = await PasswordReset.findOne({
      email,
      verified: false,
      expiresAt: { $gt: new Date() },
    });

    if (!record) throw new ApiError('OTP has expired or was not found', 400);

    const isMatch = await bcrypt.compare(otp, record.otp);
    if (!isMatch) throw new ApiError('Invalid OTP code', 400);

    record.verified = true;
    await record.save();

    return success(res, null, 'OTP verified successfully');
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/reset-password
exports.resetPassword = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const record = await PasswordReset.findOne({
      email,
      verified: true,
      expiresAt: { $gt: new Date() },
    });
    if (!record) throw new ApiError('OTP not verified or expired. Please start over.', 400);

    const user = await User.findOne({ email });
    if (!user) throw new ApiError('User not found', 404);

    user.password = password;
    await user.save();

    await PasswordReset.deleteMany({ email });

    return success(res, null, 'Password reset successfully');
  } catch (err) {
    next(err);
  }
};
