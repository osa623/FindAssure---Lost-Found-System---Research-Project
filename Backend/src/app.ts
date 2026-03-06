import express, { Application } from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes';
import itemRoutes from './routes/itemRoutes';
import adminRoutes from './routes/adminRoutes';
import uploadRoutes from './routes/uploadRoutes';
import locationRoutes from './routes/locationRoutes';
import { errorHandler } from './middleware/errorHandler';

/**
 * Create and configure Express application
 */
export const createApp = (): Application => {
  const app = express();

  // ============================================
  // MIDDLEWARE
  // ============================================

  // CORS configuration — allow all origins in development
  const corsOptions: cors.CorsOptions = {
    origin: true, // reflects the request origin back (allows any origin)
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    maxAge: 600,
  };

  app.use(cors(corsOptions));

  // Handle preflight requests
  app.options('*', cors(corsOptions));

  // Body parser
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logging (development only)
  if (process.env.NODE_ENV === 'development') {
    app.use((req, res, next) => {
      console.log(`${req.method} ${req.path}`);
      next();
    });
  }

  // ============================================
  // ROUTES
  // ============================================

  // Health check
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      message: 'FindAssure Backend API is running',
      timestamp: new Date().toISOString(),
    });
  });

  // API routes
  app.use('/api/auth', authRoutes);
  app.use('/api/items', itemRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/upload', uploadRoutes);
  app.use('/api/locations', locationRoutes);

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      message: 'Route not found',
      path: req.path,
    });
  });

  // ============================================
  // ERROR HANDLER (Must be last)
  // ============================================

  app.use(errorHandler);

  return app;
};
