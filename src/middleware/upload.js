const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const cloudinary = require('../config/cloudinary');
const logger = require('../utils/logger');

const memStorage = multer.memoryStorage();

const UPLOADS_DIR = path.join(__dirname, '../../uploads');

// Cloudinary is usable only when all credentials are set and aren't the .env.example placeholders
const isCloudinaryConfigured = () => {
  const { CLOUDINARY_CLOUD_NAME: name, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret } = process.env;
  return [name, key, secret].every((v) => v && !v.startsWith('your_'));
};

if (!isCloudinaryConfigured()) {
  logger.warn('Cloudinary credentials missing or placeholders — saving uploads to local /uploads instead');
}

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

// Fallback: write the buffer to /uploads/<folder> and return a public URL served by app.js
const saveLocally = async (req, file, folder) => {
  const dir = path.join(UPLOADS_DIR, folder);
  await fs.promises.mkdir(dir, { recursive: true });
  const ext = path.extname(file.originalname) || `.${file.mimetype.split('/')[1]}`;
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  await fs.promises.writeFile(path.join(dir, filename), file.buffer);
  return `${req.protocol}://${req.get('host')}/uploads/${folder}/${filename}`;
};

const uploadImage = async (req, file, folder) =>
  isCloudinaryConfigured()
    ? (await uploadToCloudinary(file.buffer, folder)).secure_url
    : saveLocally(req, file, folder);

// Middleware: after multer, push all files to Cloudinary and attach URLs
const processImages = (folder = 'garage-sale/sales') =>
  async (req, _res, next) => {
    try {
      if (req.files?.length > 0) {
        req.cloudinaryUrls = await Promise.all(
          req.files.map((f) => uploadImage(req, f, folder))
        );
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
        req.cloudinaryUrl = await uploadImage(req, req.file, folder);
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
