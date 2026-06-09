const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
  const conn = await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
  });
  logger.info(`MongoDB connected: ${conn.connection.host}`);
};

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});

module.exports = { connectDB };
