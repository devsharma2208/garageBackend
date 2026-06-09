const User = require('../models/User');
const Sale = require('../models/Sale');
const { success } = require('../utils/response');
const { ApiError } = require('../middleware/errorHandler');

// GET /api/users/:id
exports.getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) throw new ApiError('User not found', 404);
    return success(res, { user });
  } catch (err) {
    next(err);
  }
};

// PUT /api/users/me
exports.updateProfile = async (req, res, next) => {
  try {
    const { firstName, lastName, phone, city, bio, latitude, longitude } = req.body;

    const updateData = {};
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (phone !== undefined) updateData.phone = phone;
    if (city !== undefined) updateData.city = city;
    if (bio !== undefined) updateData.bio = bio;

    if (latitude !== undefined && longitude !== undefined) {
      updateData.location = {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)],
      };
    }

    if (req.cloudinaryUrl) {
      updateData.avatarUrl = req.cloudinaryUrl;
    }

    const user = await User.findByIdAndUpdate(req.user._id, updateData, {
      new: true,
      runValidators: true,
    });

    return success(res, { user }, 'Profile updated successfully');
  } catch (err) {
    next(err);
  }
};

// GET /api/users/:id/sales
exports.getUserSales = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, active } = req.query;

    const query = { seller: req.params.id };
    if (active === 'true') {
      query.isActive = true;
      query.endTime = { $gte: new Date() };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [sales, total] = await Promise.all([
      Sale.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('seller', 'firstName lastName avatarUrl sellerBadge'),
      Sale.countDocuments(query),
    ]);

    return success(res, {
      sales,
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

// GET /api/users/me/saved
exports.getSavedSales = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: 'savedSales',
      populate: {
        path: 'seller',
        select: 'firstName lastName avatarUrl sellerBadge',
      },
    });

    return success(res, { sales: user.savedSales });
  } catch (err) {
    next(err);
  }
};

// POST /api/users/me/saved/:saleId
exports.saveSale = async (req, res, next) => {
  try {
    const { saleId } = req.params;

    const sale = await Sale.findById(saleId);
    if (!sale) throw new ApiError('Sale not found', 404);

    const user = await User.findById(req.user._id);
    const alreadySaved = user.savedSales.some((id) => id.toString() === saleId);
    if (alreadySaved) throw new ApiError('Sale is already saved', 400);

    await User.findByIdAndUpdate(req.user._id, { $push: { savedSales: saleId } });

    return success(res, null, 'Sale saved successfully');
  } catch (err) {
    next(err);
  }
};

// DELETE /api/users/me/saved/:saleId
exports.unsaveSale = async (req, res, next) => {
  try {
    const { saleId } = req.params;
    await User.findByIdAndUpdate(req.user._id, { $pull: { savedSales: saleId } });
    return success(res, null, 'Sale removed from saved list');
  } catch (err) {
    next(err);
  }
};

// GET /api/users/:id/stats
exports.getUserStats = async (req, res, next) => {
  try {
    const [salesCount, user] = await Promise.all([
      Sale.countDocuments({ seller: req.params.id }),
      User.findById(req.params.id),
    ]);

    if (!user) throw new ApiError('User not found', 404);

    return success(res, {
      salesCount,
      savedCount: user.savedSales.length,
      rating: user.rating,
      ratingCount: user.ratingCount,
      sellerBadge: user.sellerBadge,
    });
  } catch (err) {
    next(err);
  }
};
