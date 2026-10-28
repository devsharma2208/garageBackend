// Force IPv4 DNS resolution — prevents SRV lookup failures on some networks
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

require('dotenv').config();

const app = require('./src/app');
const { connectDB } = require('./src/config/db');
const logger = require('./src/utils/logger');

const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB();

  // Bind to all interfaces so Expo apps on emulators/physical devices can reach the server over LAN
  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  });

  // Periodic background reminder runner (checks for starting-soon & ending-soon sales every 30 mins)
  const notificationService = require('./src/services/notificationService');
  const REMINDER_INTERVAL_MS = 30 * 60 * 1000;
  const reminderTimer = setInterval(() => {
    notificationService.checkAndSendReminders().catch((err) => {
      logger.error('Error in periodic reminders runner:', err);
    });
  }, REMINDER_INTERVAL_MS);

  process.on('unhandledRejection', (err) => {
    logger.error('Unhandled Rejection:', err);
    clearInterval(reminderTimer);
    server.close(() => process.exit(1));
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Shutting down gracefully.');
    clearInterval(reminderTimer);
    server.close(() => process.exit(0));
  });
};

start().catch((err) => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});
