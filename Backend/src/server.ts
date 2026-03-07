import dotenv from 'dotenv';
import os from 'os';
import path from 'path';
import { createApp } from './app';
import { connectDB } from './config/db';
import { initializeFirebaseAdmin } from './config/firebaseAdmin';

// Load environment variables
dotenv.config({
  path: path.resolve(__dirname, '../.env'),
  override: true,
});

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
const PORT = Number(process.env.PORT || 5001);

const isPreferredNetworkInterface = (name: string): boolean => {
  const normalized = name.toLowerCase();

  if (
    normalized.includes('vmware') ||
    normalized.includes('virtualbox') ||
    normalized.includes('hyper-v') ||
    normalized.includes('veth') ||
    normalized.includes('docker') ||
    normalized.includes('wsl') ||
    normalized.includes('loopback')
  ) {
    return false;
  }

  return normalized.includes('wi-fi') || normalized.includes('wifi') || normalized.includes('wireless') || normalized.includes('ethernet');
};

const getLocalIpv4 = (): string | null => {
  const interfaces = os.networkInterfaces();
  const fallbackAddresses: string[] = [];

  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses) continue;

    for (const address of addresses) {
      const family = String(address.family);

      if (family !== 'IPv4' || address.internal) {
        continue;
      }

      if (isPreferredNetworkInterface(name)) {
        return address.address;
      }

      fallbackAddresses.push(address.address);
    }
  }

  return fallbackAddresses[0] || null;
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

// Start the server
startServer();

