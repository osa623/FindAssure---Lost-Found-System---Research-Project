import { Request, Response, NextFunction } from 'express';
import { verifyIdToken } from '../config/firebaseAdmin';
import { User, IUser } from '../models/User';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        firebaseUid: string;
        email: string;
        name?: string;
        role: 'owner' | 'founder' | 'admin';
        isSuspended?: boolean;
        suspendedUntil?: Date | null;
        suspensionMode?: '3d' | '7d' | 'manual' | null;
        suspensionReason?: string | null;
      };
    }
  }
}

/**
 * Middleware to require authentication
 * Verifies Firebase ID token and attaches user to request
 */
export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ message: 'No token provided' });
      return;
    }

    const token = authHeader.split('Bearer ')[1];

    if (!token) {
      res.status(401).json({ message: 'Invalid token format' });
      return;
    }

    // Verify Firebase token
    const decodedToken = await verifyIdToken(token);
    const { uid, email } = decodedToken;

    if (!email) {
      res.status(401).json({ message: 'Email not found in token' });
      return;
    }

    // Find or create user in MongoDB
    let user = await User.findOne({ firebaseUid: uid });

    if (!user) {
      // Create new user if doesn't exist
      user = await User.create({
        firebaseUid: uid,
        email,
        role: 'owner', // Default role
      });
      console.log(`✅ New user created: ${email}`);
    }

    // Attach user to request
    req.user = {
      id: user._id.toString(),
      firebaseUid: user.firebaseUid,
      email: user.email,
      name: user.name,
      role: user.role,
      isSuspended: user.isSuspended,
      suspendedUntil: (user as any).suspendedUntil || null,
      suspensionMode: (user as any).suspensionMode || null,
      suspensionReason: user.suspensionReason,
    };

    if (user.isSuspended) {
      const suspendedUntil = (user as any).suspendedUntil ? new Date((user as any).suspendedUntil) : null;
      const isExpired = suspendedUntil ? suspendedUntil.getTime() <= Date.now() : false;
      if (isExpired) {
        user.isSuspended = false;
        (user as any).suspendedAt = null;
        (user as any).suspendedUntil = null;
        (user as any).suspensionMode = null;
        user.suspensionReason = null;
        await user.save();
      } else {
        const message = suspendedUntil
          ? `Account is suspended until ${suspendedUntil.toISOString()}.`
          : 'Account is suspended. Please contact admin.';

        res.status(403).json({
          message,
          reason: user.suspensionReason || null,
          suspendedUntil,
        });
        return;
      }
    }

    next();
  } catch (error: any) {
    console.error('Auth middleware error:', error);
    res.status(401).json({ 
      message: 'Authentication failed', 
      error: error.message 
    });
  }
};

/**
 * Middleware to require admin role
 * Must be used after requireAuth
 */
export const requireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({ message: 'Authentication required' });
    return;
  }

  if (req.user.role !== 'admin') {
    res.status(403).json({ 
      message: 'Forbidden: Admin access required' 
    });
    return;
  }

  next();
};

/**
 * Optional auth middleware - tries to authenticate but continues without auth if no token
 * Useful for endpoints that work with or without authentication
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    // If no auth header, continue without authentication
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      next();
      return;
    }

    const token = authHeader.split('Bearer ')[1];

    if (!token) {
      next();
      return;
    }

    // Try to verify Firebase token
    try {
      const decodedToken = await verifyIdToken(token);
      const { uid, email } = decodedToken;

      if (email) {
        // Find or create user in MongoDB
        let user = await User.findOne({ firebaseUid: uid });

        if (!user) {
          user = await User.create({
            firebaseUid: uid,
            email,
            role: 'owner',
          });
        }

        // Attach user to request
        req.user = {
          id: user._id.toString(),
          firebaseUid: user.firebaseUid,
          email: user.email,
          name: user.name,
          role: user.role,
          isSuspended: user.isSuspended,
          suspendedUntil: (user as any).suspendedUntil || null,
          suspensionMode: (user as any).suspensionMode || null,
          suspensionReason: user.suspensionReason,
        };
      }
    } catch (tokenError) {
      // Token verification failed, but continue without auth
      console.log('Token verification failed, continuing without auth');
    }

    next();
  } catch (error: any) {
    // Continue without authentication on any error
    console.error('Optional auth error:', error);
    next();
  }
};

