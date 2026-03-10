import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/authMiddleware';
import * as adminController from '../controllers/adminController';

const router = Router();

// All admin routes require authentication and admin role
router.use(requireAuth, requireAdmin);

/**
 * @route   GET /api/admin/overview
 * @desc    Get dashboard statistics
 * @access  Admin only
 */
router.get('/overview', adminController.getOverview);

/**
 * @route   GET /api/admin/found-items
 * @desc    Get all found items with full details (including founder answers)
 * @access  Admin only
 */
router.get('/found-items', adminController.getAllFoundItems);

/**
 * @route   PATCH /api/admin/found-items/:id
 * @desc    Update found item status
 * @access  Admin only
 */
router.patch('/found-items/:id', adminController.updateFoundItemStatus);

/**
 * @route   GET /api/admin/users
 * @desc    Get all users
 * @access  Admin only
 */
router.get('/users', adminController.getAllUsers);

/**
 * @route   PATCH /api/admin/users/:id
 * @desc    Update user details (including role)
 * @access  Admin only
 */
router.patch('/users/:id', adminController.updateUser);

/**
 * @route   PATCH /api/admin/users/:id/suspension
 * @desc    Suspend or unsuspend a user
 * @access  Admin only
 */
router.patch('/users/:id/suspension', adminController.updateUserSuspension);

/**
 * @route   DELETE /api/admin/users/:id
 * @desc    Delete user from MongoDB and Firebase
 * @access  Admin only
 */
router.delete('/users/:id', adminController.deleteUser);

/**
 * @route   GET /api/admin/verifications
 * @desc    Get all verifications with full details
 * @access  Admin only
 */
router.get('/verifications', adminController.getAllVerifications);

/**
 * @route   GET /api/admin/founder-prefill-feedback
 * @desc    Get founder prefill feedback analytics
 * @access  Admin only
 */
router.get('/founder-prefill-feedback', adminController.getFounderPrefillFeedback);

/**
 * @route   GET /api/admin/founder-prefill-feedback/summary
 * @desc    Get founder prefill feedback summary analytics
 * @access  Admin only
 */
router.get('/founder-prefill-feedback/summary', adminController.getFounderPrefillFeedbackSummary);

/**
 * @route   PUT /api/admin/verifications/:id/evaluate
 * @desc    Evaluate verification (for future AI implementation)
 * @access  Admin only
 */
router.put('/verifications/:id/evaluate', adminController.evaluateVerification);

export default router;
