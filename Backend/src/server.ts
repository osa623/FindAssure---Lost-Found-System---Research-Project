import dotenv from 'dotenv';
import os from 'os';
import { createApp } from './app';
import { connectDB } from './config/db';
import { initializeFirebaseAdmin } from './config/firebaseAdmin';

// Load environment variables
dotenv.config();

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit process, just log the error
});

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  console.error('❌ Uncaught Exception:', error);
  // Don't exit process in development
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
});

// Validate required environment variables
const requiredEnvVars = [
  'MONGODB_URI',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
];

const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingEnvVars.forEach((envVar) => console.error(`   - ${envVar}`));
  process.exit(1);
}

// Server configuration
const PORT = process.env.PORT || 5001;

const getLocalIpv4 = (): string | null => {
  const interfaces = os.networkInterfaces();

  for (const addresses of Object.values(interfaces)) {
    if (!addresses) continue;

    for (const address of addresses) {
      const family = typeof address.family === 'string' ? address.family : address.family === 4 ? 'IPv4' : 'IPv6';

      if (family === 'IPv4' && !address.internal) {
        return address.address;
      }
    }
  }

  return null;
};

/**
 * Start the server
 */
const startServer = async (): Promise<void> => {
  try {
    console.log('🚀 Starting FindAssure Backend...\n');

    // Initialize Firebase Admin SDK
    initializeFirebaseAdmin();

    // Connect to MongoDB
    await connectDB();

    // Create Express app
    const app = createApp();

    // Start listening on all network interfaces (0.0.0.0) for mobile access
    app.listen(PORT, '0.0.0.0', () => {
      const localIpv4 = getLocalIpv4();

      console.log(`\n✅ Server is running on port ${PORT}`);
      console.log(`📍 API Base URL: http://localhost:${PORT}/api`);
      console.log(`🏥 Health Check: http://localhost:${PORT}/health\n`);

      if (process.env.NODE_ENV === 'development') {
        console.log('🔧 Running in DEVELOPMENT mode');
        if (localIpv4) {
          console.log(`📱 Mobile Access: http://${localIpv4}:${PORT}/api\n`);
        } else {
          console.log('📱 Mobile Access: unable to detect local IPv4 address\n');
        }
      }
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the server
startServer();
