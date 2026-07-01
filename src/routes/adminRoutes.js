const express = require('express');
const { body } = require('express-validator');
const adminController = require('../controllers/adminController');
const { protect } = require('../middleware/authMiddleware');
const { isAdmin } = require('../middleware/adminMiddleware');
const { saleUpload, processImages } = require('../middleware/upload');
const validate = require('../middleware/validate');

const router = express.Router();

// All admin routes require auth + admin role
router.use(protect, isAdmin);

router.get('/dashboard', adminController.getDashboard);

router.get('/users', adminController.getUsers);
router.get('/users/:id', adminController.getUser);
router.patch('/users/:id/ban', adminController.toggleBanUser);
router.patch('/users/:id/role', adminController.setUserRole);
router.delete('/users/:id', adminController.deleteUser);

router.get('/geocode', adminController.geocodeLocation);

router.get('/sales', adminController.getSales);
router.post(
  '/sales',
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
  adminController.createSale
);
router.get('/sales/:id', adminController.getSale);
router.patch('/sales/:id/toggle', adminController.toggleSaleActive);
router.delete('/sales/:id', adminController.deleteSale);

router.get('/logs', adminController.getLogs);

module.exports = router;
