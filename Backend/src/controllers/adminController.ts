import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { User } from '../models/User';
import { FoundItem } from '../models/FoundItem';
import { FounderPrefillFeedback } from '../models/FounderPrefillFeedback';
import { LostRequest } from '../models/LostRequest';
import { Verification } from '../models/Verification';
import * as itemService from '../services/itemService';
import * as verificationService from '../services/verificationService';
import { sendAccountSuspendedEmail } from '../services/emailService';

const PYTHON_SUSPICION_BACKEND_URL =
  process.env.PYTHON_SUSPICION_BACKEND_URL || 'http://127.0.0.1:5005';

interface FraudSummaryResult {
  owner_id: string;
  risk_score?: number;
  risk_level?: 'low' | 'medium' | 'high';
  reasons?: string[];
  flags?: string[];
  is_suspicious?: boolean | boolean[];
  suspicious_behavior_count?: number;
  suspicious_behavior_events?: Array<{
    created_at?: string;
    suspicion_score?: number;
    face_missing_ratio?: number;
    look_away_ratio?: number;
    top_negative_factors?: string[];
    ai_behavior_summary?: string;
  }>;
}

const riskLevelWeight = (level?: string): number => {
  switch (String(level || '').toLowerCase()) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    default:
      return 1;
  }
};

const dedupeBehaviorEvents = (
  events: NonNullable<FraudSummaryResult['suspicious_behavior_events']>
): NonNullable<FraudSummaryResult['suspicious_behavior_events']> => {
  const seen = new Set<string>();

  return events
    .filter(Boolean)
    .filter((event) => {
      const key = [
        event.created_at || '',
        typeof event.suspicion_score === 'number' ? event.suspicion_score.toFixed(4) : '',
        event.ai_behavior_summary || '',
        Array.isArray(event.top_negative_factors) ? event.top_negative_factors.join('|') : '',
      ].join('::');

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return aTime - bTime;
    });
};

const mergeFraudSummaries = (
  summaries: Array<FraudSummaryResult | undefined>
): FraudSummaryResult | undefined => {
  const validSummaries = summaries.filter(Boolean) as FraudSummaryResult[];
  if (!validSummaries.length) return undefined;

  const mergedEvents = dedupeBehaviorEvents(
    validSummaries.flatMap((summary) =>
      Array.isArray(summary.suspicious_behavior_events)
        ? summary.suspicious_behavior_events
        : []
    )
  );

  const mergedReasons = Array.from(
    new Set(
      validSummaries.flatMap((summary) =>
        Array.isArray(summary.reasons)
          ? summary.reasons.map((reason) => String(reason).trim()).filter(Boolean)
          : []
      )
    )
  );

  const mergedFlags = Array.from(
    new Set(
      validSummaries.flatMap((summary) =>
        Array.isArray(summary.flags)
          ? summary.flags.map((flag) => String(flag).trim()).filter(Boolean)
          : []
      )
    )
  );

  const strongest = validSummaries.reduce((best, current) => {
    const currentWeight = riskLevelWeight(current.risk_level);
    const bestWeight = riskLevelWeight(best.risk_level);
    const currentScore = Number(current.risk_score ?? 0);
    const bestScore = Number(best.risk_score ?? 0);

    if (currentWeight > bestWeight) return current;
    if (currentWeight === bestWeight && currentScore > bestScore) return current;
    return best;
  });

  return {
    ...strongest,
    risk_score: Math.max(...validSummaries.map((summary) => Number(summary.risk_score ?? 0))),
    risk_level: (['high', 'medium', 'low'] as const).find((level) =>
      validSummaries.some((summary) => summary.risk_level === level)
    ) || 'low',
    reasons: mergedReasons,
    flags: mergedFlags,
    is_suspicious: validSummaries.some((summary) =>
      Array.isArray(summary.is_suspicious)
        ? summary.is_suspicious.some(Boolean)
        : Boolean(summary.is_suspicious)
    ),
    suspicious_behavior_count: Math.max(
      mergedEvents.length,
      ...validSummaries.map((summary) => Number(summary.suspicious_behavior_count ?? 0))
    ),
    suspicious_behavior_events: mergedEvents,
  };
};

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

const parseBooleanQuery = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return undefined;
};

const parseDateQuery = (value: unknown, endOfDay = false): Date | undefined => {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  return date;
};

const toNumber = (value: unknown): number | null => {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const roundMetric = (value: number | null): number | null => {
  return value === null ? null : Number(value.toFixed(2));
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
      const fraudSummary = mergeFraudSummaries([
        fraudSummaryMap.get(mongoIdKey),
        firebaseUidKey ? fraudSummaryMap.get(firebaseUidKey) : undefined,
      ]);

      const riskScore = Number(fraudSummary?.risk_score ?? 0);
      const summaryRiskLevel = fraudSummary?.risk_level || 'low';
      const suspiciousBehaviorCount = Number(fraudSummary?.suspicious_behavior_count ?? 0);
      const suspiciousBehaviorEvents = Array.isArray(fraudSummary?.suspicious_behavior_events)
        ? fraudSummary!.suspicious_behavior_events!
        : [];
      const latestBehaviorEvent =
        suspiciousBehaviorEvents.length > 0
          ? suspiciousBehaviorEvents[suspiciousBehaviorEvents.length - 1]
          : undefined;
      const latestBehaviorSummary = typeof latestBehaviorEvent?.ai_behavior_summary === 'string'
        ? latestBehaviorEvent.ai_behavior_summary.trim()
        : '';
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
      const repeatedSuspiciousBehavior = suspiciousBehaviorCount > 5;
      const isSuspicious = highRisk || mediumRisk || isSuspiciousField || flags.length > 0 || repeatedSuspiciousBehavior;
      const suspiciousSeverity = (highRisk || isSuspiciousField || flags.length > 0)
        ? 'critical'
        : (mediumRisk ? 'warning' : 'none');
      const fraudReasons = Array.isArray(fraudSummary?.reasons) ? fraudSummary?.reasons : [];
      const suspiciousReason = isSuspicious
        ? (
          latestBehaviorSummary
          || fraudReasons.find((reason) => reason.startsWith('AI Behavior:'))
          || (
          (repeatedSuspiciousBehavior
            ? `Suspicious behavior detected ${suspiciousBehaviorCount} times.`
            : null)
          || fraudReasons[0]
          || (flags.length ? `Flags: ${flags.join(', ')}` : null)
          || (isSuspiciousField ? 'Behavior sessions marked as suspicious.' : null)
          || (highRisk || mediumRisk ? `Risk level is ${riskLevel}.` : null)
          || (riskScore > 0 ? `Risk score is ${(riskScore * 100).toFixed(0)}%.` : null)
          )
        )
        : null;

      return {
        ...user,
        fraudRiskScore: Number.isFinite(riskScore) ? Number(riskScore.toFixed(2)) : 0,
        fraudRiskLevel: riskLevel,
        fraudReasons,
        fraudFlags: flags,
        suspiciousBehaviorCount,
        suspiciousBehaviorEvents,
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
      const fraudSummaryMap = await buildFraudSummaryMap();
      const fraudSummary = mergeFraudSummaries([
        fraudSummaryMap.get(String(user._id)),
        user.firebaseUid ? fraudSummaryMap.get(String(user.firebaseUid).trim()) : undefined,
      ]);
      const suspiciousBehaviorEvents = Array.isArray(fraudSummary?.suspicious_behavior_events)
        ? fraudSummary.suspicious_behavior_events
        : [];
      const latestBehaviorEvent =
        suspiciousBehaviorEvents.length > 0
          ? suspiciousBehaviorEvents[suspiciousBehaviorEvents.length - 1]
          : undefined;
      const xaiReason = typeof latestBehaviorEvent?.ai_behavior_summary === 'string'
        ? latestBehaviorEvent.ai_behavior_summary.trim()
        : '';
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
        : (xaiReason || 'Suspended by admin');
    } else {
      user.suspendedAt = null;
      user.suspendedUntil = null;
      user.suspensionMode = null;
      user.suspensionReason = null;
    }

    await user.save();

    if (isSuspended && user.email) {
      const fraudSummaryMap = await buildFraudSummaryMap();
      const fraudSummary = mergeFraudSummaries([
        fraudSummaryMap.get(String(user._id)),
        user.firebaseUid ? fraudSummaryMap.get(String(user.firebaseUid).trim()) : undefined,
      ]);
      const suspiciousBehaviorEvents = Array.isArray(fraudSummary?.suspicious_behavior_events)
        ? fraudSummary.suspicious_behavior_events
        : [];
      const latestBehaviorEvent =
        suspiciousBehaviorEvents.length > 0
          ? suspiciousBehaviorEvents[suspiciousBehaviorEvents.length - 1]
          : undefined;
      const xaiReason = typeof latestBehaviorEvent?.ai_behavior_summary === 'string'
        ? latestBehaviorEvent.ai_behavior_summary.trim()
        : '';

      try {
        await sendAccountSuspendedEmail({
          userName: user.name || 'User',
          userEmail: user.email,
          suspensionReason: user.suspensionReason || 'Suspended by admin',
          xaiReason: xaiReason || null,
          suspendedUntil: user.suspendedUntil || null,
        });
      } catch (emailError: any) {
        console.error(
          'Account suspension email failed (non-blocking):',
          emailError?.message || emailError
        );
      }
    }

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
 * Get founder prefill feedback analytics
 * GET /api/admin/founder-prefill-feedback
 */
export const getFounderPrefillFeedback = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const pageRaw = Number.parseInt(String(req.query.page || '1'), 10);
    const limitRaw = Number.parseInt(String(req.query.limit || '20'), 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {};
    const analysisMode =
      req.query.analysisMode === 'pp1' || req.query.analysisMode === 'pp2'
        ? req.query.analysisMode
        : undefined;
    const acceptedAsIs = parseBooleanQuery(req.query.acceptedAsIs);
    const changedOnly = parseBooleanQuery(req.query.changedOnly);
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const from = parseDateQuery(req.query.from);
    const to = parseDateQuery(req.query.to, true);

    if (analysisMode) {
      query.analysisMode = analysisMode;
    }
    if (acceptedAsIs !== undefined) {
      query.acceptedAsIs = acceptedAsIs;
    }
    if (changedOnly === true) {
      query.acceptedAsIs = false;
    }
    if (category) {
      query.finalCategory = category;
    }
    if (from || to) {
      query.createdAt = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      };
    }

    const [total, items] = await Promise.all([
      FounderPrefillFeedback.countDocuments(query),
      FounderPrefillFeedback.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('foundItemId', 'category description imageUrl createdAt')
        .populate('createdBy', 'name email')
        .lean(),
    ]);

    res.status(200).json({
      page,
      limit,
      total,
      totalPages: total > 0 ? Math.ceil(total / limit) : 0,
      items,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get founder prefill feedback aggregate summary
 * GET /api/admin/founder-prefill-feedback/summary
 */
export const getFounderPrefillFeedbackSummary = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const query: Record<string, unknown> = {};
    const analysisMode =
      req.query.analysisMode === 'pp1' || req.query.analysisMode === 'pp2'
        ? req.query.analysisMode
        : undefined;
    const from = parseDateQuery(req.query.from);
    const to = parseDateQuery(req.query.to, true);

    if (analysisMode) {
      query.analysisMode = analysisMode;
    }
    if (from || to) {
      query.createdAt = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      };
    }

    const rows = await FounderPrefillFeedback.find(query).lean();
    const total = rows.length;
    const acceptedAsIsCount = rows.filter((row) => row.acceptedAsIs).length;
    const categoryOverrideCount = rows.filter((row) => row.categoryChanged).length;
    const descriptionOverrideCount = rows.filter((row) => row.descriptionChanged).length;
    const changeScores = rows
      .map((row: any) => toNumber(row.changeMetrics?.overallChangePct))
      .filter((value): value is number => value !== null);
    const featureOverlapScores = rows
      .map((row: any) => toNumber(row.changeMetrics?.featureOverlapPct))
      .filter((value): value is number => value !== null);
    const colorChangeCount = rows.filter((row: any) => row.changeMetrics?.colorChanged === true).length;
    const pp2Rows = rows.filter((row) => row.analysisMode === 'pp2');
    const pp2AvailableRows = pp2Rows.filter((row: any) => row.multiviewVerification?.available === true);
    const pp2PassedCount = pp2AvailableRows.filter((row: any) => row.multiviewVerification?.passed === true).length;

    const droppedReasonCounts = new Map<string, number>();
    const failureReasonCounts = new Map<string, number>();
    const correctedCategoryCounts = new Map<string, number>();

    for (const row of rows as any[]) {
      if (!row.acceptedAsIs) {
        const key = String(row.finalCategory || '').trim() || 'Unknown';
        correctedCategoryCounts.set(key, (correctedCategoryCounts.get(key) || 0) + 1);
      }

      const droppedViews = Array.isArray(row.multiviewVerification?.droppedViews)
        ? row.multiviewVerification.droppedViews
        : [];
      for (const dropped of droppedViews) {
        const reason = typeof dropped?.reason === 'string' ? dropped.reason.trim() : '';
        if (!reason) continue;
        droppedReasonCounts.set(reason, (droppedReasonCounts.get(reason) || 0) + 1);
      }

      const failureReasons = Array.isArray(row.multiviewVerification?.failureReasons)
        ? row.multiviewVerification.failureReasons
        : [];
      for (const reason of failureReasons) {
        const normalized = String(reason || '').trim();
        if (!normalized) continue;
        failureReasonCounts.set(normalized, (failureReasonCounts.get(normalized) || 0) + 1);
      }
    }

    const avg = (values: number[]): number | null =>
      values.length > 0
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null;
    const rate = (count: number, denom: number): number | null =>
      denom > 0 ? (count / denom) * 100 : null;
    const topEntries = (map: Map<string, number>, limit = 5) =>
      Array.from(map.entries())
        .sort((left, right) => right[1] - left[1])
        .slice(0, limit)
        .map(([value, count]) => ({ value, count }));

    res.status(200).json({
      total,
      acceptedAsIsRate: roundMetric(rate(acceptedAsIsCount, total)),
      categoryOverrideRate: roundMetric(rate(categoryOverrideCount, total)),
      descriptionOverrideRate: roundMetric(rate(descriptionOverrideCount, total)),
      averageOverallChangePct: roundMetric(avg(changeScores)),
      colorChangeRate: roundMetric(rate(colorChangeCount, total)),
      averageFeatureOverlapPct: roundMetric(avg(featureOverlapScores)),
      pp2MultiviewPassRate: roundMetric(rate(pp2PassedCount, pp2AvailableRows.length)),
      topDroppedViewReasons: topEntries(droppedReasonCounts),
      topFailureReasons: topEntries(failureReasonCounts),
      mostCorrectedCategories: topEntries(correctedCategoryCounts),
    });
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
