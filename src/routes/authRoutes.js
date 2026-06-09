const express = require('express');
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');

const router = express.Router();

router.post(
  '/send-registration-otp',
  [body('email').isEmail().withMessage('Valid email is required').normalizeEmail()],
  validate,
  authController.sendRegistrationOTP
);

router.post(
  '/register',
  [
    body('firstName').trim().notEmpty().withMessage('First name is required'),
    body('lastName').trim().notEmpty().withMessage('Last name is required'),
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('otp').notEmpty().withMessage('Verification code is required'),
  ],
  validate,
  authController.register
);

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  authController.login
);

router.post('/logout', protect, authController.logout);

router.post(
  '/refresh-token',
  [body('refreshToken').notEmpty().withMessage('Refresh token is required')],
  validate,
  authController.refreshToken
);

router.get('/me', protect, authController.getMe);

router.post(
  '/forgot-password',
  [body('email').isEmail().withMessage('Valid email is required').normalizeEmail()],
  validate,
  authController.forgotPassword
);

router.post(
  '/verify-otp',
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('otp').notEmpty().withMessage('OTP is required'),
  ],
  validate,
  authController.verifyOTP
);

router.post(
  '/reset-password',
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
  ],
  validate,
  authController.resetPassword
);

module.exports = router;
