import { Router } from 'express';
import { requireAuth, optionalAuth } from '../middleware/authMiddleware';
import * as itemController from '../controllers/itemController';
import { uploadTempImages, uploadVideos } from '../utils/cloudinary';

const router = Router();

// ============================================
// FOUND ITEMS ROUTES
// ============================================

/**
 * @route   POST /api/items/found
 * @desc    Create a found item report
 * @access  Public/Private (optional auth)
 */
router.post('/found', optionalAuth, uploadTempImages.array('images', 3), itemController.createFoundItem);

/**
 * @route   POST /api/items/pre-analyze-found-images
 * @desc    Pre-analyze founder images to autofill category and description
 * @access  Public
 */
router.post(
  '/pre-analyze-found-images',
  optionalAuth,
  uploadTempImages.array('images', 3),
  itemController.preAnalyzeFoundImages
);

router.post(
  '/pre-analyze-found-images/start',
  optionalAuth,
  uploadTempImages.array('images', 3),
  itemController.startPreAnalyzeFoundImages
);

router.get(
  '/pre-analyze-found-images/status/:taskId',
  optionalAuth,
  itemController.getPreAnalyzeFoundImagesStatus
);

/**
 * @route   GET /api/items/found
 * @desc    List all found items (owner view - no founder answers)
 * @access  Public
 */
router.get('/found', itemController.listFoundItems);

/**
 * @route   GET /api/items/found/:id
 * @desc    Get single found item by ID
 * @access  Public (owner view) / Admin (full view)
 */
router.get('/found/:id', itemController.getFoundItemById);

// ============================================
// LOST ITEMS ROUTES
// ============================================

/**
 * @route   POST /api/items/lost
 * @desc    Create a lost item request
 * @access  Private (preferred) / Public (demo mode with auto-created demo user)
 */
router.post('/lost', optionalAuth, uploadTempImages.single('ownerImage'), itemController.createLostRequest);

/**
 * @route   GET /api/items/lost/me
 * @desc    Get my lost item requests
 * @access  Private
 */
router.get('/lost/me', requireAuth, itemController.getMyLostRequests);

// ============================================
// AI QUESTION GENERATION
// ============================================

/**
 * @route   POST /api/items/generate-questions
 * @desc    Generate verification questions using AI
 * @access  Public
 */
router.post('/generate-questions', itemController.generateQuestions);

// ============================================
// VERIFICATION ROUTES
// ============================================
 
/**
 * @route   POST /api/items/verification
 * @desc    Create verification with video answers
 * @access  Private
 */
router.post('/verification', requireAuth, uploadVideos.any(), itemController.createVerification);

/**
 * @route   POST /api/items/verification/manual-review
 * @desc    Request manual ownership review from admin
 * @access  Private
 */
router.post('/verification/manual-review', requireAuth, itemController.requestManualVerificationReview);

/**
 * @route   GET /api/items/verification/:id
 * @desc    Get verification by ID
 * @access  Private (owner - no founder answers) / Admin (full view)
 */
router.get('/verification/:id', requireAuth, itemController.getVerificationById);

/**
 * @route   GET /api/items/verification/me
 * @desc    Get my verifications
 * @access  Private
 */
router.get('/verification/me', requireAuth, itemController.getMyVerifications);


/**
 * @route   POST /api/items/found/batch
 * @desc    Get multiple found items by IDs (batch)
 * @access  Public
 */
router.post('/found/batch', itemController.getFoundItemsByIds);

/**
 * @route   GET /api/items/users
 * @desc    Get all users (for suggestion system)
 * @access  Public
 */
router.get('/users', itemController.getAllUsersPublic);

export default router;
