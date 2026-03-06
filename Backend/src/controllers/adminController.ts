import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { User } from '../models/User';
import { FoundItem } from '../models/FoundItem';
import { LostRequest } from '../models/LostRequest';
import { Verification } from '../models/Verification';
import * as itemService from '../services/itemService';
import * as verificationService from '../services/verificationService';

const PYTHON_SUSPICION_BACKEND_URL =
  process.env.PYTHON_SUSPICION_BACKEND_URL || 'http://127.0.0.1:5005';

interface FraudSummaryResult {
  owner_id: string;
  risk_score?: number;
  risk_level?: 'low' | 'medium' | 'high';
  reasons?: string[];
  flags?: string[];
  is_suspicious?: boolean | boolean[];
}

const buildFraudSummaryMap = async (): Promise<Map<string, FraudSummaryResult>> => {
  const summaryMap = new Map<string, FraudSummaryResult>();

  try {
    const response = await axios.get<{ results?: FraudSummaryResult[] }>(
      `${PYTHON_SUSPICION_BACKEND_URL}/fraud-summary-all`,
      { timeout: 10000 }
    );

    const results = Array.isArray(response.data?.results) ? response.data.results : [];
    for (const row of results) {
      if (!row?.owner_id) continue;
      summaryMap.set(String(row.owner_id).trim(), row);
    }
  } catch (error: any) {
    console.error(
      'Failed to fetch fraud summary for admin users:',
      error?.response?.data || error?.message || error
    );
  }

  return summaryMap;
};

/**
 * Get dashboard overview statistics
 * GET /api/admin/overview
 */
export const getOverview = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const [
      totalUsers,
      totalFoundItems,
      totalLostRequests,
      totalVerifications,
      pendingVerifications,
    ] = await Promise.all([
      User.countDocuments(),
      FoundItem.countDocuments(),
      LostRequest.countDocuments(),
      Verification.countDocuments(),
      verificationService.getPendingVerificationsCount(),
    ]);

    res.status(200).json({
      totalUsers,
      totalFoundItems,
      totalLostRequests,
      totalVerifications,
      pendingVerifications,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all found items (admin view with full details)
 * GET /api/admin/found-items
 */
export const getAllFoundItems = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const items = await itemService.getAllFoundItemsForAdmin();
    res.status(200).json(items);
  } catch (error) {
    next(error);
  }
};

/**
 * Update found item status
 * PATCH /api/admin/found-items/:id
 */
export const updateFoundItemStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['available', 'pending_verification', 'claimed'].includes(status)) {
      res.status(400).json({ message: 'Invalid status value' });
      return;
    }

    const item = await itemService.updateFoundItemStatus(id, status);

    if (!item) {
      res.status(404).json({ message: 'Found item not found' });
      return;
    }

    res.status(200).json(item);
  } catch (error) {
    next(error);
  }
};

/**
 * Get all users
 * GET /api/admin/users
 */
export const getAllUsers = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const [users, fraudSummaryMap] = await Promise.all([
      User.find().sort({ createdAt: -1 }).select('-__v').lean(),
      buildFraudSummaryMap(),
    ]);

    const enrichedUsers = users.map((user: any) => {
      const mongoIdKey = String(user._id);
      const firebaseUidKey = String(user.firebaseUid || '').trim();
      const fraudSummary =
        fraudSummaryMap.get(mongoIdKey) || (firebaseUidKey ? fraudSummaryMap.get(firebaseUidKey) : undefined);

      const riskScore = Number(fraudSummary?.risk_score ?? 0);
      const summaryRiskLevel = fraudSummary?.risk_level || 'low';
      const userRiskLevel =
        typeof user.risk_level === 'string'
          ? String(user.risk_level).toLowerCase()
          : 'low';
      const riskLevel = (summaryRiskLevel === 'high' || userRiskLevel === 'high')
        ? 'high'
        : (summaryRiskLevel === 'medium' || userRiskLevel === 'medium')
          ? 'medium'
          : 'low';

      const summaryFlags = Array.isArray(fraudSummary?.flags) ? fraudSummary.flags : [];
      const userFlags = Array.isArray(user.flags) ? user.flags : [];
      const flags = Array.from(new Set([...summaryFlags, ...userFlags].map((f) => String(f).trim()).filter(Boolean)));
      const isSuspiciousField = Array.isArray(fraudSummary?.is_suspicious)
        ? fraudSummary?.is_suspicious.some(Boolean)
        : Boolean(fraudSummary?.is_suspicious);
      const highRisk = riskLevel === 'high' || riskScore >= 0.7;
      const mediumRisk = riskLevel === 'medium' || riskScore >= 0.55;

      const isSuspicious = highRisk || mediumRisk || isSuspiciousField || flags.length > 0;
      const suspiciousSeverity = (highRisk || isSuspiciousField || flags.length > 0)
        ? 'critical'
        : (mediumRisk ? 'warning' : 'none');
      const fraudReasons = Array.isArray(fraudSummary?.reasons) ? fraudSummary?.reasons : [];
      const suspiciousReason = isSuspicious
        ? (
          fraudReasons[0]
          || (flags.length ? `Flags: ${flags.join(', ')}` : null)
          || (isSuspiciousField ? 'Behavior sessions marked as suspicious.' : null)
          || (highRisk || mediumRisk ? `Risk level is ${riskLevel}.` : null)
          || (riskScore > 0 ? `Risk score is ${(riskScore * 100).toFixed(0)}%.` : null)
        )
        : null;

      return {
        ...user,
        fraudRiskScore: Number.isFinite(riskScore) ? Number(riskScore.toFixed(2)) : 0,
        fraudRiskLevel: riskLevel,
        fraudReasons,
        fraudFlags: flags,
        isSuspicious,
        suspiciousSeverity,
        suspiciousReason,
      };
    });

    res.status(200).json(enrichedUsers);
  } catch (error) {
    next(error);
  }
};

/**
 * Update user details
 * PATCH /api/admin/users/:id
 */
export const updateUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, phone, role } = req.body;

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (role !== undefined && ['owner', 'admin'].includes(role)) {
      updateData.role = role;
    }

    const user = await User.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).select('-__v');

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
 * Suspend or unsuspend user
 * PATCH /api/admin/users/:id/suspension
 */
export const updateUserSuspension = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { isSuspended, reason, suspendFor } = req.body;

    if (typeof isSuspended !== 'boolean') {
      res.status(400).json({ message: 'isSuspended (boolean) is required' });
      return;
    }

    const user = await User.findById(id).select('-__v');
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    if (user.role === 'admin') {
      res.status(403).json({ message: 'Cannot suspend admin users' });
      return;
    }

    user.isSuspended = isSuspended;
    if (isSuspended) {
      const mode = suspendFor === '3d' || suspendFor === '7d' || suspendFor === 'manual'
        ? suspendFor
        : 'manual';
      const now = new Date();
      let suspendedUntil: Date | null = null;
      if (mode === '3d') {
        suspendedUntil = new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000));
      } else if (mode === '7d') {
        suspendedUntil = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
      }

      user.suspendedAt = now;
      user.suspendedUntil = suspendedUntil;
      user.suspensionMode = mode;
      user.suspensionReason = typeof reason === 'string' && reason.trim()
        ? reason.trim()
        : 'Suspended by admin';
    } else {
      user.suspendedAt = null;
      user.suspendedUntil = null;
      user.suspensionMode = null;
      user.suspensionReason = null;
    }

    await user.save();

    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

/**
 * Delete user
 * DELETE /api/admin/users/:id
 */
export const deleteUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    // Find user in MongoDB
    const user = await User.findById(id);

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    // Prevent deleting admin users
    if (user.role === 'admin') {
      res.status(403).json({ message: 'Cannot delete admin users' });
      return;
    }

    // Delete from Firebase
    try {
      const admin = (await import('../config/firebaseAdmin')).default;
      await admin.auth().deleteUser(user.firebaseUid);
      console.log(`✅ Deleted user from Firebase: ${user.email}`);
    } catch (firebaseError: any) {
      if (firebaseError.code === 'auth/user-not-found') {
        console.log(`⚠️  User not found in Firebase: ${user.email}`);
      } else {
        console.error(`❌ Error deleting from Firebase: ${user.email}`, firebaseError.message);
        // Continue with MongoDB deletion even if Firebase deletion fails
      }
    }

    // Delete from MongoDB
    await User.findByIdAndDelete(id);
    console.log(`✅ Deleted user from MongoDB: ${user.email}`);

    res.status(200).json({ 
      message: 'User deleted successfully',
      deletedUser: {
        id: user._id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all verifications (admin view)
 * GET /api/admin/verifications
 */
export const getAllVerifications = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const verifications = await verificationService.getAllVerifications();
    res.status(200).json(verifications);
  } catch (error) {
    next(error);
  }
};

/**
 * Evaluate verification (for future AI implementation)
 * PUT /api/admin/verifications/:id/evaluate
 */
export const evaluateVerification = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, similarityScore } = req.body;

    if (!status || !['pending', 'passed', 'failed'].includes(status)) {
      res.status(400).json({ message: 'Invalid status value' });
      return;
    }

    const verification = await verificationService.evaluateVerification(id, {
      status,
      similarityScore,
    });

    if (!verification) {
      res.status(404).json({ message: 'Verification not found' });
      return;
    }

    res.status(200).json(verification);
  } catch (error) {
    next(error);
  }
};
