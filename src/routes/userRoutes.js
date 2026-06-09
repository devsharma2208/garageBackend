const express = require('express');
const userController = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');
const { avatarUpload, processAvatar } = require('../middleware/upload');

const router = express.Router();

// ──────────────────────────────────────────────────────────
// Protected routes (must come before /:id to avoid conflicts)
// ──────────────────────────────────────────────────────────
router.put('/me', protect, avatarUpload, processAvatar(), userController.updateProfile);
router.get('/me/saved',           protect, userController.getSavedSales);
router.post('/me/saved/:saleId',  protect, userController.saveSale);
router.delete('/me/saved/:saleId',protect, userController.unsaveSale);

// ──────────────────────────────────────────────────────────
// Public routes
// ──────────────────────────────────────────────────────────
router.get('/:id',       userController.getProfile);
router.get('/:id/sales', userController.getUserSales);
router.get('/:id/stats', userController.getUserStats);

module.exports = router;
