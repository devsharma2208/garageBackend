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

  const server = app.listen(PORT, () => {
    logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  });

  process.on('unhandledRejection', (err) => {
    logger.error('Unhandled Rejection:', err);
    server.close(() => process.exit(1));
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Shutting down gracefully.');
    server.close(() => process.exit(0));
  });
};

start().catch((err) => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});
