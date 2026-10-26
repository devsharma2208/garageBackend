const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async (retries = 5) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const conn = await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 30000,
        connectTimeoutMS: 30000,
        socketTimeoutMS: 60000,
        maxPoolSize: 10,
        // Some networks (mobile ISP NAT, firewalls) reset idle TCP sockets after a few seconds,
        // which kills the driver's long-lived streaming monitor. Poll with short heartbeats instead
        // and retire idle pool sockets before the network does.
        serverMonitoringMode: 'poll',
        heartbeatFrequencyMS: 3000,
        maxIdleTimeMS: 4000,
      });
      logger.info(`MongoDB connected: ${conn.connection.host}`);
      return;
    } catch (err) {
      logger.error(`MongoDB connection attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) throw err;
      const delay = Math.min(1000 * 2 ** attempt, 15000);
      logger.info(`Retrying in ${delay / 1000}s...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
};

mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
mongoose.connection.on('error', (err) => logger.error(`MongoDB error: ${err.message}`));

module.exports = { connectDB };
