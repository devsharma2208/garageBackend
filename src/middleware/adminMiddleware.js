const { ApiError } = require('./errorHandler');

const isAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return next(new ApiError('Access denied. Admin only.', 403));
  }
  next();
};

module.exports = { isAdmin };
