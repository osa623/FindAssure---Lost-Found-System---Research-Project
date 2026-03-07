import { Request, Response, NextFunction } from 'express';
import { User } from '../models/User';
import admin from '../config/firebaseAdmin';

/**
 * Register new user (after Firebase authentication)
 * POST /api/auth/register
 */
export const register = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, name, phone, role } = req.body;
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ message: 'No token provided' });
      return;
    }

    const token = authHeader.split('Bearer ')[1];
    
    // Verify Firebase token
    const decodedToken = await admin.auth().verifyIdToken(token);
    const firebaseUid = decodedToken.uid;

    // Check if user already exists by firebaseUid or email
    let user = await User.findOne({ 
      $or: [{ firebaseUid }, { email: email || decodedToken.email }]
    }).select('-__v');

    if (user) {
      // Update existing user with any new data provided
      if (firebaseUid && firebaseUid !== user.firebaseUid) user.firebaseUid = firebaseUid;
      if (name && name !== user.name) user.name = name;
      if (phone && phone !== user.phone) user.phone = phone;
      if (role && role !== user.role) user.role = role;
      
      if (user.isModified()) {
        await user.save();
      }
      
      res.status(200).json({ user, token });
      return;
    }

    // Create new user with all provided data (only owner role allowed for registration)
    user = new User({
      firebaseUid,
      email: email || decodedToken.email,
      name: name || decodedToken.name || 'User',
      phone: phone || '',
      role: 'owner', // Only owners register
    });

    try {
      await user.save();
    } catch (saveError: any) {
      // Handle duplicate key error gracefully
      if (saveError.code === 11000) {
        // User was created between our check and save, fetch and return it
        user = await User.findOne({ 
          $or: [{ firebaseUid }, { email: email || decodedToken.email }]
        }).select('-__v');
        
        if (user) {
          res.status(200).json({ user, token });
          return;
        }
      }
      throw saveError;
    }

    res.status(201).json({ user, token });
  } catch (error) {
    next(error);
  }
};

/**
 * Login user (verify Firebase token and return user)
 * POST /api/auth/login
 */
export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ message: 'No token provided' });
      return;
    }

    const token = authHeader.split('Bearer ')[1];
    
    // Verify Firebase token
    const decodedToken = await admin.auth().verifyIdToken(token);
    const firebaseUid = decodedToken.uid;

    // Find user
    const user = await User.findOne({ firebaseUid }).select('-__v');

    if (!user) {
      res.status(404).json({ message: 'User not found. Please register first.' });
      return;
    }

    res.status(200).json({ user, token });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current user profile
 * GET /api/auth/me
 */
export const getCurrentUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }

    const user = await User.findById(req.user.id).select('-__v');

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

/**
 * Update current user profile
 * PATCH /api/auth/me
 */
export const updateCurrentUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }

    const { name, phone } = req.body;

    // Validate input
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;

    // Only admins can change roles
    if (req.body.role && req.user.role === 'admin') {
      updateData.role = req.body.role;
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updateData,
      { new: true, runValidators: true }
    ).select('-__v');

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

/**
 * Register additional user info (optional endpoint)
 * POST /api/auth/register-extra
 */
export const registerExtraInfo = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }

    const { name, phone } = req.body;

    const updateData: any = {};
    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    // Role is fixed to 'owner' for registered users

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updateData,
      { new: true, runValidators: true }
    ).select('-__v');

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

/**
 * Get claimed items for the current user
 * GET /api/auth/claimed-items
 */
export const getClaimedItems = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }

    const { Verification } = await import('../models/Verification');

    // Find all passed verifications for this user
    const claimedItems = await Verification.find({
      ownerId: req.user.id,
      status: 'passed',
    })
      .populate({
        path: 'foundItemId',
        select: 'imageUrl category description found_location founderContact createdAt',
      })
      .sort({ createdAt: -1 })
      .select('-__v');

    res.status(200).json(claimedItems);
  } catch (error) {
    next(error);
  }
};
