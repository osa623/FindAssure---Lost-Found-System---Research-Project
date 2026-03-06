import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import * as finetuningService from '../services/finetuningService';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

// ============================================
// FINE-TUNING DATA COLLECTION ROUTES
// Pairs are auto-collected via Verification post-save hook.
// These endpoints provide admin utilities and stats.
// ============================================

/**
 * @route   POST /api/finetuning/backfill
 * @desc    Scan all passed verifications and collect any missing pairs
 * @access  Private (admin)
 */
router.post(
  '/backfill',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.user?.role !== 'admin') {
        res.status(403).json({ message: 'Admin access required' });
        return;
      }

      const result = await finetuningService.backfillPairsFromVerifications();
      res.status(200).json({ message: 'Backfill complete', ...result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/finetuning/stats
 * @desc    Get fine-tuning pair collection statistics
 * @access  Private
 */
router.get(
  '/stats',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const stats = await finetuningService.getFinetuningStats();
      res.status(200).json(stats);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   POST /api/finetuning/log-selection
 * @desc    Log which search result the user selected (feeds LightGBM re-ranker)
 * @access  Private
 */
router.post(
  '/log-selection',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { impressionId, queryId, lostItemRaw, selectedFoundId, selectedRank } = req.body;

      if (!impressionId || !queryId || !lostItemRaw || !selectedFoundId || selectedRank === undefined) {
        res.status(400).json({
          message: 'Required fields: impressionId, queryId, lostItemRaw, selectedFoundId, selectedRank',
        });
        return;
      }

      await finetuningService.logSelectionToPython({
        impressionId,
        queryId,
        lostItemRaw,
        selectedFoundId,
        selectedRank: Number(selectedRank),
      });

      res.status(200).json({ message: 'Selection logged successfully' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
