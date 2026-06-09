const Sale = require('../models/Sale');
const User = require('../models/User');
const { success } = require('../utils/response');
const { ApiError } = require('../middleware/errorHandler');

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
        .populate('seller', 'firstName lastName avatarUrl sellerBadge rating'),
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
      .populate('seller', 'firstName lastName avatarUrl sellerBadge rating');

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
      .populate('seller', 'firstName lastName avatarUrl sellerBadge rating');

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
      .populate('seller', 'firstName lastName avatarUrl sellerBadge rating');

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
      'firstName lastName avatarUrl sellerBadge rating city'
    );

    if (!sale) throw new ApiError('Sale not found', 404);

    // Async increment views (fire and forget)
    Sale.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }).exec();

    return success(res, { sale });
  } catch (err) {
    next(err);
  }
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
      images: bodyImages,
    } = req.body;

    const images = req.cloudinaryUrls?.length > 0 ? req.cloudinaryUrls : (bodyImages || []);

    const parsedCategories =
      typeof categories === 'string' ? JSON.parse(categories) : categories || [];

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
      seller: req.user._id,
    });

    const populated = await Sale.findById(sale._id).populate(
      'seller',
      'firstName lastName avatarUrl sellerBadge'
    );

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
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (address !== undefined) updateData.address = address;
    if (city !== undefined) updateData.city = city;
    if (startTime !== undefined) updateData.startTime = startTime;
    if (endTime !== undefined) updateData.endTime = endTime;
    if (isActive !== undefined) updateData.isActive = isActive;

    if (latitude !== undefined && longitude !== undefined) {
      updateData.location = {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)],
      };
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
    }).populate('seller', 'firstName lastName avatarUrl sellerBadge');

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
