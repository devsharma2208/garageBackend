const { verifyAccessToken } = require('../utils/jwt');
const User = require('../models/User');
const { ApiError } = require('./errorHandler');

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new ApiError('Access token required. Please login.', 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    const user = await User.findById(decoded.id);
    if (!user) throw new ApiError('User belonging to this token no longer exists.', 401);

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

// Attach user if token present — does not fail if missing
const optional = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = verifyAccessToken(token);
      req.user = await User.findById(decoded.id);
    }
  } catch (_) {
    // ignore auth errors for optional routes
  }
  next();
};

module.exports = { protect, optional };
