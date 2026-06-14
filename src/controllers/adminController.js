const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const Sale = require('../models/Sale');
const { success } = require('../utils/response');
const { ApiError } = require('../middleware/errorHandler');

// GET /api/admin/dashboard
exports.getDashboard = async (req, res, next) => {
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      totalSales,
      activeSales,
      newUsers7d,
      newSales7d,
      viewsAgg,
      salesByDay,
      usersByDay,
      topCategories,
      topCities,
    ] = await Promise.all([
      User.countDocuments({}),
      Sale.countDocuments({}),
      Sale.countDocuments({ isActive: true, endTime: { $gte: now } }),
      User.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      Sale.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      Sale.aggregate([{ $group: { _id: null, total: { $sum: '$views' } } }]),
      Sale.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      User.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Sale.aggregate([
        { $unwind: '$categories' },
        { $group: { _id: '$categories', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
      Sale.aggregate([
        { $group: { _id: '$city', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 6 },
      ]),
    ]);

    return success(res, {
      stats: {
        totalUsers,
        totalSales,
        activeSales,
        totalViews: viewsAgg[0]?.total || 0,
        newUsers7d,
        newSales7d,
      },
      charts: {
        salesByDay,
        usersByDay,
        topCategories,
        topCities,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/users
exports.getUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, role, banned } = req.query;

    const query = {};
    if (search) {
      query.$or = [
        { firstName: { $regex: new RegExp(search, 'i') } },
        { lastName: { $regex: new RegExp(search, 'i') } },
        { email: { $regex: new RegExp(search, 'i') } },
        { city: { $regex: new RegExp(search, 'i') } },
      ];
    }
    if (role) query.role = role;
    if (banned === 'true') query.isBanned = true;
    if (banned === 'false') query.isBanned = { $ne: true };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [users, total] = await Promise.all([
      User.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      User.countDocuments(query),
    ]);

    return success(res, {
      users,
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

// GET /api/admin/users/:id
exports.getUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) throw new ApiError('User not found', 404);

    const [salesCount, totalViewsAgg, recentSales] = await Promise.all([
      Sale.countDocuments({ seller: req.params.id }),
      Sale.aggregate([
        { $match: { seller: user._id } },
        { $group: { _id: null, total: { $sum: '$views' } } },
      ]),
      Sale.find({ seller: req.params.id }).sort({ createdAt: -1 }).limit(5),
    ]);

    return success(res, {
      user,
      stats: {
        salesCount,
        totalViews: totalViewsAgg[0]?.total || 0,
      },
      recentSales,
    });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/admin/users/:id/ban
exports.toggleBanUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) throw new ApiError('User not found', 404);
    if (user.role === 'admin') throw new ApiError('Cannot ban admin users', 400);

    const updated = await User.findByIdAndUpdate(
      req.params.id,
      { isBanned: !user.isBanned },
      { new: true }
    );

    return success(
      res,
      { user: updated },
      updated.isBanned ? 'User banned successfully' : 'User unbanned successfully'
    );
  } catch (err) {
    next(err);
  }
};

// PATCH /api/admin/users/:id/role
exports.setUserRole = async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) throw new ApiError('Invalid role', 400);

    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true });
    if (!user) throw new ApiError('User not found', 404);

    return success(res, { user }, `User role updated to ${role}`);
  } catch (err) {
    next(err);
  }
};

// DELETE /api/admin/users/:id
exports.deleteUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) throw new ApiError('User not found', 404);
    if (user.role === 'admin') throw new ApiError('Cannot delete admin users', 400);

    await Promise.all([
      Sale.deleteMany({ seller: req.params.id }),
      user.deleteOne(),
    ]);

    return success(res, null, 'User and all their sales deleted successfully');
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/sales
exports.getSales = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, active, city } = req.query;

    const query = {};
    if (search) {
      query.$or = [
        { title: { $regex: new RegExp(search, 'i') } },
        { address: { $regex: new RegExp(search, 'i') } },
        { city: { $regex: new RegExp(search, 'i') } },
        { description: { $regex: new RegExp(search, 'i') } },
      ];
    }
    if (active === 'true') query.isActive = true;
    if (active === 'false') query.isActive = false;
    if (city) query.city = { $regex: new RegExp(city, 'i') };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [sales, total] = await Promise.all([
      Sale.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('seller', 'firstName lastName email avatarUrl'),
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

// GET /api/admin/sales/:id
exports.getSale = async (req, res, next) => {
  try {
    const sale = await Sale.findById(req.params.id).populate(
      'seller',
      'firstName lastName email avatarUrl city sellerBadge rating'
    );
    if (!sale) throw new ApiError('Sale not found', 404);
    return success(res, { sale });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/admin/sales/:id/toggle
exports.toggleSaleActive = async (req, res, next) => {
  try {
    const sale = await Sale.findById(req.params.id);
    if (!sale) throw new ApiError('Sale not found', 404);

    const updated = await Sale.findByIdAndUpdate(
      req.params.id,
      { isActive: !sale.isActive },
      { new: true }
    ).populate('seller', 'firstName lastName email');

    return success(
      res,
      { sale: updated },
      `Sale ${updated.isActive ? 'activated' : 'deactivated'} successfully`
    );
  } catch (err) {
    next(err);
  }
};

// DELETE /api/admin/sales/:id
exports.deleteSale = async (req, res, next) => {
  try {
    const sale = await Sale.findById(req.params.id);
    if (!sale) throw new ApiError('Sale not found', 404);

    await sale.deleteOne();
    return success(res, null, 'Sale deleted successfully');
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/logs?type=combined|error&lines=200
exports.getLogs = async (req, res, next) => {
  try {
    const { type = 'combined', lines = 200 } = req.query;

    const logFile = type === 'error' ? 'error.log' : 'combined.log';
    const logPath = path.join(__dirname, '../../logs', logFile);

    if (!fs.existsSync(logPath)) {
      return success(res, { logs: [], count: 0 }, 'Log file not found');
    }

    const content = fs.readFileSync(logPath, 'utf8');
    const allLines = content.trim().split('\n').filter(Boolean);
    const lastLines = allLines.slice(-parseInt(lines));

    const logs = lastLines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { message: line, level: 'info', timestamp: new Date().toISOString() };
        }
      })
      .reverse();

    return success(res, { logs, count: allLines.length });
  } catch (err) {
    next(err);
  }
};
