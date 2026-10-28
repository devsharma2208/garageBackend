const Sale = require('../models/Sale');
const User = require('../models/User');
const { success } = require('../utils/response');
const { ApiError } = require('../middleware/errorHandler');
const notificationService = require('../services/notificationService');
const logger = require('../utils/logger');

// GET /api/sales
exports.getSales = async (req, res, next) => {
  try {
    const {
      city,
      search,
      sort = 'latest',
      active = 'true',
      page = 1,
      limit = 20,
      categories,
    } = req.query;

    const query = {};

    if (active === 'true') {
      query.isActive = true;
      query.endTime = { $gte: new Date() };
    }

    if (city && city !== 'All Cities') {
      query.city = { $regex: new RegExp(city, 'i') };
    }

    if (search) {
      query.$or = [
        { title: { $regex: new RegExp(search, 'i') } },
        { address: { $regex: new RegExp(search, 'i') } },
        { city: { $regex: new RegExp(search, 'i') } },
        { description: { $regex: new RegExp(search, 'i') } },
      ];
    }

    if (categories) {
      const cats = categories.split(',').map((c) => c.trim());
      query.categories = { $in: cats };
    }

    const sortMap = {
      trending: { views: -1 },
      'most-viewed': { views: -1 },
      'ending-soon': { endTime: 1 },
      popular: { views: -1, createdAt: -1 },
      nearby: { createdAt: -1 },
      latest: { createdAt: -1 },
    };
    const sortOption = sortMap[sort] || { createdAt: -1 };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [sales, total] = await Promise.all([
      Sale.find(query)
        .sort(sortOption)
        .skip(skip)
        .limit(parseInt(limit))
        .populate('seller', 'firstName lastName avatarUrl sellerBadge rating phone'),
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

// GET /api/sales/trending
exports.getTrending = async (req, res, next) => {
  try {
    const sales = await Sale.find({ isActive: true, endTime: { $gte: new Date() } })
      .sort({ views: -1 })
      .limit(10)
      .populate('seller', 'firstName lastName avatarUrl sellerBadge rating phone');

    return success(res, { sales });
  } catch (err) {
    next(err);
  }
};

// GET /api/sales/ending-soon
exports.getEndingSoon = async (req, res, next) => {
  try {
    const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const sales = await Sale.find({
      isActive: true,
      endTime: { $gte: new Date(), $lte: cutoff },
    })
      .sort({ endTime: 1 })
      .limit(10)
      .populate('seller', 'firstName lastName avatarUrl sellerBadge rating phone');

    return success(res, { sales });
  } catch (err) {
    next(err);
  }
};

// GET /api/sales/nearby?lat=&lng=&maxDistance=
exports.getNearbySales = async (req, res, next) => {
  try {
    const { lat, lng, maxDistance = 50000 } = req.query; // meters

    if (!lat || !lng) throw new ApiError('Latitude and longitude are required', 400);

    const sales = await Sale.find({
      isActive: true,
      endTime: { $gte: new Date() },
      location: {
        $nearSphere: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)],
          },
          $maxDistance: parseInt(maxDistance),
        },
      },
    })
      .limit(20)
      .populate('seller', 'firstName lastName avatarUrl sellerBadge rating phone');

    return success(res, { sales });
  } catch (err) {
    next(err);
  }
};

// GET /api/sales/stats
exports.getStats = async (req, res, next) => {
  try {
    const now = new Date();
    const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const [liveSales, endingSoon] = await Promise.all([
      Sale.countDocuments({ isActive: true, endTime: { $gte: now } }),
      Sale.countDocuments({ isActive: true, endTime: { $gte: now, $lte: cutoff } }),
    ]);

    return success(res, { liveSales, endingSoon });
  } catch (err) {
    next(err);
  }
};

// GET /api/sales/:id
exports.getSale = async (req, res, next) => {
  try {
    const sale = await Sale.findById(req.params.id).populate(
      'seller',
      'firstName lastName avatarUrl sellerBadge rating city phone'
    );

    if (!sale) throw new ApiError('Sale not found', 404);

    // Async increment views (fire and forget)
    Sale.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }).exec();

    return success(res, { sale });
  } catch (err) {
    next(err);
  }
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Validate and normalise the availability payload: [{ date, day, slots: [{ startTime, endTime }] }]
const parseAvailability = (raw) => {
  if (raw === undefined || raw === null || raw === '') return [];

  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch (_) {
      throw new ApiError('Availability must be valid JSON', 400);
    }
  }
  if (!Array.isArray(list)) throw new ApiError('Availability must be an array', 400);

  const seenDates = new Set();
  const days = list.map((entry, i) => {
    const date = new Date(entry?.date);
    if (Number.isNaN(date.getTime())) {
      throw new ApiError(`Availability day ${i + 1} has an invalid date`, 400);
    }
    // The client sends the day name in the seller's own timezone; fall back to the server's
    const day = DAYS.includes(entry.day) ? entry.day : DAYS[date.getDay()];

    const dateKey = date.toISOString();
    if (seenDates.has(dateKey)) throw new ApiError(`${day} is listed more than once`, 400);
    seenDates.add(dateKey);

    if (!Array.isArray(entry.slots) || entry.slots.length === 0) {
      throw new ApiError(`Add at least one time slot for ${day}`, 400);
    }

    const slots = entry.slots
      .map((slot) => {
        const startTime = new Date(slot?.startTime);
        const endTime = new Date(slot?.endTime);
        if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
          throw new ApiError(`A time slot on ${day} has an invalid time`, 400);
        }
        if (endTime <= startTime) {
          throw new ApiError(`Each time slot on ${day} must end after it starts`, 400);
        }
        return { startTime, endTime };
      })
      .sort((a, b) => a.startTime - b.startTime);

    for (let s = 1; s < slots.length; s += 1) {
      if (slots[s].startTime < slots[s - 1].endTime) {
        throw new ApiError(`Time slots on ${day} overlap`, 400);
      }
    }

    return { date, day, slots };
  });

  return days.sort((a, b) => a.date - b.date);
};

// POST /api/sales
exports.createSale = async (req, res, next) => {
  try {
    const {
      title,
      description,
      address,
      city,
      latitude,
      longitude,
      startTime,
      endTime,
      categories,
      availability,
      images: bodyImages,
    } = req.body;

    const images = req.cloudinaryUrls?.length > 0 ? req.cloudinaryUrls : (bodyImages || []);

    const parsedCategories =
      typeof categories === 'string' ? JSON.parse(categories) : categories || [];

    const parsedAvailability = parseAvailability(availability);

    const sale = await Sale.create({
      title,
      description,
      address,
      city,
      location: {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)],
      },
      startTime,
      endTime,
      images: typeof images === 'string' ? JSON.parse(images) : images,
      categories: parsedCategories,
      availability: parsedAvailability,
      seller: req.user._id,
    });

    const populated = await Sale.findById(sale._id).populate(
      'seller',
      'firstName lastName avatarUrl sellerBadge phone'
    );

    // 1. Nearby Sales Notification: Dispatch to users within chosen area/radius
    notificationService.notifyNearbyUsers(populated).catch((notifyErr) => {
      logger.error('Failed to dispatch nearby sales notifications:', notifyErr);
    });

    return success(res, { sale: populated }, 'Sale created successfully', 201);
  } catch (err) {
    next(err);
  }
};

// PUT /api/sales/:id
exports.updateSale = async (req, res, next) => {
  try {
    const sale = await Sale.findById(req.params.id);
    if (!sale) throw new ApiError('Sale not found', 404);

    if (sale.seller.toString() !== req.user._id.toString()) {
      throw new ApiError('Not authorized to update this sale', 403);
    }

    const {
      title,
      description,
      address,
      city,
      latitude,
      longitude,
      startTime,
      endTime,
      categories,
      isActive,
    } = req.body;

    const updateData = {};
    const changedFields = [];

    if (title !== undefined && title !== sale.title) {
      updateData.title = title;
      changedFields.push('title');
    }
    if (description !== undefined && description !== sale.description) {
      updateData.description = description;
      changedFields.push('description');
    }
    if (address !== undefined && address !== sale.address) {
      updateData.address = address;
      changedFields.push('address');
    }
    if (city !== undefined && city !== sale.city) {
      updateData.city = city;
      changedFields.push('city');
    }
    if (startTime !== undefined && new Date(startTime).getTime() !== new Date(sale.startTime).getTime()) {
      updateData.startTime = startTime;
      // Rescheduled — let the reminder job send a fresh starting-soon reminder
      updateData.reminderStartingSent = false;
      changedFields.push('start time');
    }
    if (endTime !== undefined && new Date(endTime).getTime() !== new Date(sale.endTime).getTime()) {
      updateData.endTime = endTime;
      updateData.reminderEndingSent = false;
      changedFields.push('end time');
    }
    if (isActive !== undefined && isActive !== sale.isActive) {
      updateData.isActive = isActive;
      changedFields.push('status');
    }

    if (latitude !== undefined && longitude !== undefined) {
      const newLng = parseFloat(longitude);
      const newLat = parseFloat(latitude);
      if (sale.location?.coordinates?.[0] !== newLng || sale.location?.coordinates?.[1] !== newLat) {
        updateData.location = {
          type: 'Point',
          coordinates: [newLng, newLat],
        };
        changedFields.push('location');
      }
    }

    if (categories !== undefined) {
      updateData.categories =
        typeof categories === 'string' ? JSON.parse(categories) : categories;
    }

    if (req.cloudinaryUrls?.length > 0) {
      updateData.images = req.cloudinaryUrls;
    }

    const updated = await Sale.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    }).populate('seller', 'firstName lastName avatarUrl sellerBadge phone');

    // 4. Sale Changes Notification: Dispatch to users who saved this sale
    if (changedFields.length > 0) {
      notificationService.notifySaleChanges(updated, changedFields).catch((notifyErr) => {
        logger.error('Failed to dispatch sale changes notifications:', notifyErr);
      });
    }

    return success(res, { sale: updated }, 'Sale updated successfully');
  } catch (err) {
    next(err);
  }
};

// DELETE /api/sales/:id
exports.deleteSale = async (req, res, next) => {
  try {
    const sale = await Sale.findById(req.params.id);
    if (!sale) throw new ApiError('Sale not found', 404);

    if (sale.seller.toString() !== req.user._id.toString()) {
      throw new ApiError('Not authorized to delete this sale', 403);
    }

    await sale.deleteOne();
    return success(res, null, 'Sale deleted successfully');
  } catch (err) {
    next(err);
  }
};
