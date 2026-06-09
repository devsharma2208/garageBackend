const multer = require('multer');
const cloudinary = require('../config/cloudinary');

const memStorage = multer.memoryStorage();

const imageFilter = (_req, file, cb) => {
  if (file.mimetype.startsWith('image/')) cb(null, true);
  else cb(new Error('Only image files are allowed'), false);
};

const limits = { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 };

// Upload a buffer directly to Cloudinary via stream
const uploadToCloudinary = (buffer, folder) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    stream.end(buffer);
  });

// Middleware: after multer, push all files to Cloudinary and attach URLs
const processImages = (folder = 'garage-sale/sales') =>
  async (req, _res, next) => {
    try {
      if (req.files?.length > 0) {
        const results = await Promise.all(
          req.files.map((f) => uploadToCloudinary(f.buffer, folder))
        );
        req.cloudinaryUrls = results.map((r) => r.secure_url);
      } else {
        req.cloudinaryUrls = [];
      }
      next();
    } catch (err) {
      next(err);
    }
  };

// Middleware: upload single file (avatar) to Cloudinary
const processAvatar = (folder = 'garage-sale/avatars') =>
  async (req, _res, next) => {
    try {
      if (req.file) {
        const result = await uploadToCloudinary(req.file.buffer, folder);
        req.cloudinaryUrl = result.secure_url;
      }
      next();
    } catch (err) {
      next(err);
    }
  };

module.exports = {
  saleUpload:   multer({ storage: memStorage, fileFilter: imageFilter, limits }).array('images', 5),
  avatarUpload: multer({ storage: memStorage, fileFilter: imageFilter, limits }).single('avatar'),
  processImages,
  processAvatar,
};
