import { Request, Response, NextFunction } from 'express';
import * as itemService from '../services/itemService';
import * as verificationService from '../services/verificationService';
import * as geminiService from '../services/geminiService';
import * as pythonSearchService from '../services/pythonSearchService';
import * as locationMatchService from '../services/locationMatchService';
import { User } from '../models/User';

/**
 * Create a found item
 * POST /api/items/found
 */
export const createFoundItem = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      imageUrl,
      category,
      description,
      questions,
      founderAnswers,
      found_location,
      founderContact,
    } = req.body;

    // Validation (imageUrl is optional)
    if (!category || !description || !questions || !founderAnswers || !found_location || !founderContact) {
      res.status(400).json({ message: 'Required fields: category, description, questions, founderAnswers, found_location, founderContact' });
      return;
    }

    if (questions.length === 0) {
      res.status(400).json({ message: 'At least one question is required' });
      return;
    }

    if (questions.length !== founderAnswers.length) {
      res.status(400).json({ message: 'Number of answers must match number of questions' });
      return;
    }

    const foundItem = await itemService.createFoundItem({
      imageUrl: imageUrl || 'https://via.placeholder.com/400x400/CCCCCC/666666?text=No+Image',
      category,
      description,
      questions,
      founderAnswers,
      found_location,
      founderContact,
      createdBy: req.user?.id,
    });

    res.status(201).json(foundItem);
  } catch (error) {
    next(error);
  }
};

/**
 * List found items
 * GET /api/items/found
 */
export const listFoundItems = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { category, status } = req.query;

    const filters: itemService.FoundItemFilters = {};
    if (category) filters.category = category as string;
    
    // If status is explicitly provided, use it
    // Otherwise, exclude claimed items by default (only show available and pending_verification)
    if (status) {
      filters.status = status as any;
    } else {
      // Don't set a status filter - we'll filter in the query below
    }

    const items = await itemService.listFoundItems(filters);

    // Filter out claimed items unless explicitly requested
    const filteredItems = status 
      ? items 
      : items.filter(item => item.status !== 'claimed');

    // For owner view, remove founderAnswers from all items
    const itemsForOwner = filteredItems.map((item) => {
      const itemObj = item.toObject();
      const { founderAnswers, ...ownerView } = itemObj;
      return ownerView;
    });

    res.status(200).json(itemsForOwner);
  } catch (error) {
    next(error);
  }
};

/**
 * Get single found item
 * GET /api/items/found/:id
 */
export const getFoundItemById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    // Check if user is admin
    const isAdmin = req.user?.role === 'admin';

    let item;
    if (isAdmin) {
      item = await itemService.getFoundItemForAdmin(id);
    } else {
      item = await itemService.getFoundItemForOwner(id);
    }

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
 * Create a lost request
 * POST /api/items/lost
 */
export const createLostRequest = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const { category, description, owner_location, floor_id, hall_name, owner_location_confidence_stage } = req.body;

    if (!category || !description || !owner_location || owner_location_confidence_stage === undefined) {
      res.status(400).json({ message: 'Category, description, owner_location, and confidence stage are required' });
      return;
    }

    if (owner_location_confidence_stage < 1 || owner_location_confidence_stage > 4) {
      res.status(400).json({ message: 'Confidence stage must be 1, 2, 3, or 4' });
      return;
    }

    const [lostRequestResult, pythonSearchResult] = await Promise.allSettled([
      itemService.createLostRequest(req.user.id, {
        category,
        description,
        owner_location,
        floor_id,
        hall_name,
        owner_location_confidence_stage,
      }),
      pythonSearchService.searchLostItemWithPython({
        text: description,
        category,
        limit: 10,
        session_id: req.user.id,
      }),
    ]);

    if (lostRequestResult.status === 'rejected') {
      throw lostRequestResult.reason;
    }

    let lostRequest = lostRequestResult.value;
    let aiSearch: {
      status: 'ok' | 'failed';
      total_matches: number;
      matchedFoundItemIds: string[];
      location_match?: boolean;
      matched_locations?: string[];
      query_id?: string;
      impression_id?: string;
      detail?: string;
    };

    if (pythonSearchResult.status === 'fulfilled') {
      const aiMatchedItems = await itemService.resolveAiMatchesToFoundItems(
        pythonSearchResult.value.matches || []
      );

      const categaryData: locationMatchService.CategoryDataItem[] = aiMatchedItems.map((item) => ({
        id: item.foundItemId,
        description_scrore: item.score,
        found_location: (item.found_location || []).map((loc) => ({
          location: loc.location,
          floor_id: loc.floor_id ?? null,
          hall_name: loc.hall_name ?? null,
        })),
      }));

      let finalMatchedFoundItemIds: string[] = aiMatchedItems.map((i) => i.foundItemId);
      let locationMatchResponse: locationMatchService.FindItemsResponse | null = null;

      if (categaryData.length > 0) {
        try {
          locationMatchResponse = await locationMatchService.findItemsByLocation({
            owner_id: req.user.id,
            categary_name: category,
            categary_data: categaryData,
            description_match_cofidence: 90,
            owner_location,
            floor_id: floor_id ?? null,
            hall_name: hall_name ?? null,
            owner_location_confidence_stage,
          });

          const matchedIdsFromLocation = (locationMatchResponse.matched_item_ids || []).map((id) =>
            String(id)
          );

          if (matchedIdsFromLocation.length > 0) {
            const matchedIdSet = new Set(matchedIdsFromLocation);
            finalMatchedFoundItemIds = finalMatchedFoundItemIds.filter((id) => matchedIdSet.has(id));
          } else {
            finalMatchedFoundItemIds = [];
          }
        } catch (locationErr: any) {
          console.error('Location match step failed:', locationErr?.message || locationErr);
          finalMatchedFoundItemIds = [];
        }
      } else {
        finalMatchedFoundItemIds = [];
      }

      if (finalMatchedFoundItemIds.length > 0) {
        const updatedLostRequest = await itemService.updateLostRequestMatches(
          String(lostRequest._id),
          finalMatchedFoundItemIds
        );
        if (updatedLostRequest) {
          lostRequest = updatedLostRequest;
        }
      }

      aiSearch = {
        status: 'ok',
        total_matches: pythonSearchResult.value.total_matches || 0,
        matchedFoundItemIds: finalMatchedFoundItemIds,
        location_match: Boolean(locationMatchResponse?.location_match),
        matched_locations: locationMatchResponse?.matched_locations || [],
        query_id: pythonSearchResult.value.query_id,
        impression_id: pythonSearchResult.value.impression_id,
      };
    } else {
      aiSearch = {
        status: 'failed',
        total_matches: 0,
        matchedFoundItemIds: [],
        detail:
          pythonSearchResult.reason instanceof Error
            ? pythonSearchResult.reason.message
            : 'Python search failed',
      };
    }

    res.status(201).json({
      ...lostRequest.toObject(),
      aiSearch,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get my lost requests
 * GET /api/items/lost/me
 */
export const getMyLostRequests = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const requests = await itemService.getLostRequestsByOwner(req.user.id);

    res.status(200).json(requests);
  } catch (error) {
    next(error);
  }
};

/**
 * Create verification
 * POST /api/items/verification
 */
export const createVerification = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    // Parse form data - expect 'data' field with JSON
    const dataField = req.body.data;
    
    if (!dataField) {
      res.status(400).json({ message: 'Missing data field in request' });
      return;
    }

    let parsedData;
    try {
      parsedData = typeof dataField === 'string' ? JSON.parse(dataField) : dataField;
    } catch (error) {
      res.status(400).json({ message: 'Invalid JSON in data field' });
      return;
    }

    const { foundItemId, ownerAnswers } = parsedData;

    if (!foundItemId || !ownerAnswers) {
      res.status(400).json({ message: 'foundItemId and ownerAnswers are required' });
      return;
    }

    // Extract video files from request
    const files = req.files as Express.Multer.File[];
    const videoFiles = new Map<string, any>();

    if (files && files.length > 0) {
      for (const file of files) {
        videoFiles.set(file.fieldname, {
          buffer: file.buffer,
          originalname: file.originalname,
          mimetype: file.mimetype,
        });
      }
    }

    const verification = await verificationService.createVerification({
      foundItemId,
      ownerId: req.user.id,
      ownerAnswers,
      videoFiles,
    });

    res.status(201).json(verification);
  } catch (error) {
    next(error);
  }
};

/**
 * Get verification by ID
 * GET /api/items/verification/:id
 */
export const getVerificationById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const { id } = req.params;
    const isAdmin = req.user.role === 'admin';

    const verification = await verificationService.getVerificationById(id, isAdmin);

    if (!verification) {
      res.status(404).json({ message: 'Verification not found' });
      return;
    }

    res.status(200).json(verification);
  } catch (error) {
    next(error);
  }
};

/**
 * Get my verifications
 * GET /api/items/verification/me
 */
export const getMyVerifications = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const verifications = await verificationService.getVerificationsByOwner(req.user.id);

    res.status(200).json(verifications);
  } catch (error) {
    next(error);
  }
};

/**
 * Generate verification questions using AI
 * POST /api/items/generate-questions
 */
export const generateQuestions = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { category, description } = req.body;

    // Validation
    if (!category || !description) {
      res.status(400).json({ message: 'Category and description are required' });
      return;
    }

    // Generate questions using Gemini AI
    const questions = await geminiService.generateVerificationQuestions({
      category,
      description,
    });

    res.status(200).json({ questions });
  } catch (error) {
    next(error);
  }
};

/**
 * Get multiple found items by IDs (batch)
 * POST /api/items/found/batch
 */
export const getFoundItemsByIds = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { itemIds } = req.body;

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      res.status(400).json({ message: 'itemIds array is required' });
      return;
    }

    // Limit batch size to prevent abuse
    if (itemIds.length > 50) {
      res.status(400).json({ message: 'Maximum 50 items can be fetched at once' });
      return;
    }

    const items = await itemService.getFoundItemsByIds(itemIds);

    res.status(200).json(items);
  } catch (error) {
    next(error);
  }
};

/**
 * Get all users (public endpoint for suggestion system)
 * GET /api/items/users
 */
export const getAllUsersPublic = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Only return basic user info, exclude sensitive data
    const users = await User.find()
      .select('name email role createdAt firebaseUid')
      .sort({ createdAt: -1 });
    res.status(200).json(users);
  } catch (error) {
    next(error);
  }
};
