const express = require('express');
const { body } = require('express-validator');
const saleController = require('../controllers/saleController');
const { protect, optional } = require('../middleware/authMiddleware');
const { saleUpload, processImages } = require('../middleware/upload');
const validate = require('../middleware/validate');

const router = express.Router();

// ──────────────────────────────────────────────────────────
// Public routes (order matters – specific before :id)
// ──────────────────────────────────────────────────────────
router.get('/trending',    saleController.getTrending);
router.get('/ending-soon', saleController.getEndingSoon);
router.get('/nearby',      saleController.getNearbySales);
router.get('/stats',       saleController.getStats);
router.get('/',            saleController.getSales);
router.get('/:id', optional, saleController.getSale);

// ──────────────────────────────────────────────────────────
// Protected routes (require JWT)
// ──────────────────────────────────────────────────────────
router.post(
  '/',
  protect,
  saleUpload,
  processImages(),
  [
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('description').trim().notEmpty().withMessage('Description is required'),
    body('address').trim().notEmpty().withMessage('Address is required'),
    body('city').trim().notEmpty().withMessage('City is required'),
    body('latitude').notEmpty().withMessage('Latitude is required'),
    body('longitude').notEmpty().withMessage('Longitude is required'),
    body('startTime').notEmpty().withMessage('Start time is required'),
    body('endTime').notEmpty().withMessage('End time is required'),
  ],
  validate,
  saleController.createSale
);

const notificationController = require('../controllers/notificationController');

router.put('/:id',    protect, saleUpload, processImages(), saleController.updateSale);
router.patch('/:id/sold-out', protect, saleController.setSoldOut);
router.delete('/:id', protect, saleController.deleteSale);

// Submit inquiry on a sale (triggers SELLER_UPDATE notification)
router.post(
  '/:saleId/inquiry',
  protect,
  [body('message').trim().notEmpty().withMessage('Message is required')],
  validate,
  notificationController.createSaleInquiry
);

module.exports = router;
