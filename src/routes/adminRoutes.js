const express = require('express');
const adminController = require('../controllers/adminController');
const { protect } = require('../middleware/authMiddleware');
const { isAdmin } = require('../middleware/adminMiddleware');

const router = express.Router();

// All admin routes require auth + admin role
router.use(protect, isAdmin);

router.get('/dashboard', adminController.getDashboard);

router.get('/users', adminController.getUsers);
router.get('/users/:id', adminController.getUser);
router.patch('/users/:id/ban', adminController.toggleBanUser);
router.patch('/users/:id/role', adminController.setUserRole);
router.delete('/users/:id', adminController.deleteUser);

router.get('/sales', adminController.getSales);
router.get('/sales/:id', adminController.getSale);
router.patch('/sales/:id/toggle', adminController.toggleSaleActive);
router.delete('/sales/:id', adminController.deleteSale);

router.get('/logs', adminController.getLogs);

module.exports = router;
