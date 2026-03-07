import { Types } from 'mongoose';
import { FoundItem, IFoundItem, FoundItemStatus, IFounderContact, ILocationDetail } from '../models/FoundItem';
import { LostRequest, ILostRequest } from '../models/LostRequest';

export interface CreateFoundItemData {
  _id?: Types.ObjectId;
  imageUrl: string;
  category: string;
  description: string;
  questions: string[];
  founderAnswers: string[];
  found_location: ILocationDetail[];
  founderContact: IFounderContact;
  createdBy?: string;
  analysisMode?: 'pp1' | 'pp2' | null;
  pythonItemId?: string | null;
  faissId?: number | null;
  faissIds?: number[];
  detectedCategory?: string | null;
  detectedDescription?: string | null;
  detectedColor?: string | null;
  vector128?: number[];
  searchable?: boolean;
  pipelineResponse?: Record<string, unknown> | null;
}

export interface FoundItemFilters {
  category?: string;
  status?: FoundItemStatus;
}

export interface CreateLostRequestData {
  category: string;
  description: string;
  owner_location: string;
  floor_id?: string | null;
  hall_name?: string | null;
  owner_location_confidence_stage: number;
  ownerImageUrl?: string | null;
}

export interface AiSearchMatchInput {
  id?: string;
  description?: string;
  category?: string;
  score?: number;
}

export interface AiMatchedFoundItem {
  foundItemId: string;
  category: string;
  description: string;
  score: number;
  found_location: ILocationDetail[];
}

export interface LostRequestSearchResultsUpdate {
  matchedFoundItemIds: string[];
  ownerImageUrl?: string | null;
  imageMatchResults?: Array<{
    foundItemId: string;
    score: number;
  }>;
}

const OWNER_HIDDEN_FOUND_ITEM_FIELDS = [
  'founderAnswers',
  'founderContact',
  'analysisMode',
  'pythonItemId',
  'faissId',
  'faissIds',
  'detectedCategory',
  'detectedDescription',
  'detectedColor',
  'vector128',
  'searchable',
  'pipelineResponse',
] as const;

export const sanitizeFoundItemForOwner = (item: any) => {
  const itemObject = typeof item?.toObject === 'function' ? item.toObject() : item;
  const ownerView = { ...itemObject };

  for (const field of OWNER_HIDDEN_FOUND_ITEM_FIELDS) {
    delete ownerView[field];
  }

  return ownerView;
};

/**
 * Create a new found item
 */
export const createFoundItem = async (data: CreateFoundItemData): Promise<IFoundItem> => {
  const foundItem = await FoundItem.create({
    ...(data._id ? { _id: data._id } : {}),
    imageUrl: data.imageUrl,
    category: data.category,
    description: data.description,
    questions: data.questions,
    founderAnswers: data.founderAnswers,
    found_location: data.found_location,
    founderContact: data.founderContact,
    status: 'available',
    ...(data.createdBy && { createdBy: new Types.ObjectId(data.createdBy) }),
    analysisMode: data.analysisMode ?? null,
    pythonItemId: data.pythonItemId ?? null,
    faissId: data.faissId ?? null,
    faissIds: data.faissIds ?? [],
    detectedCategory: data.detectedCategory ?? null,
    detectedDescription: data.detectedDescription ?? null,
    detectedColor: data.detectedColor ?? null,
    vector128: data.vector128 ?? [],
    searchable: data.searchable ?? false,
    pipelineResponse: data.pipelineResponse ?? null,
  });

  return foundItem;
};

/**
 * List found items with optional filters
 */
export const listFoundItems = async (filters: FoundItemFilters = {}): Promise<IFoundItem[]> => {
  const query: any = {};

  if (filters.category) {
    query.category = filters.category;
  }

  if (filters.status) {
    query.status = filters.status;
  }

  const items = await FoundItem.find(query)
    .sort({ createdAt: -1 })
    .populate('createdBy', 'name email');

  return items;
};

/**
 * Get found item for owner view (without founderAnswers)
 */
export const getFoundItemForOwner = async (id: string): Promise<Partial<IFoundItem> | null> => {
  const item = await FoundItem.findById(id).populate('createdBy', 'name email');

  if (!item) {
    return null;
  }

  return sanitizeFoundItemForOwner(item);
};

/**
 * Get found item for admin view (with all details)
 */
export const getFoundItemForAdmin = async (id: string): Promise<IFoundItem | null> => {
  const item = await FoundItem.findById(id).populate('createdBy', 'name email');
  return item;
};

/**
 * Update found item status
 */
export const updateFoundItemStatus = async (
  id: string,
  status: FoundItemStatus
): Promise<IFoundItem | null> => {
  const item = await FoundItem.findByIdAndUpdate(
    id,
    { status },
    { new: true, runValidators: true }
  );

  return item;
};

/**
 * Create a lost request
 */
export const createLostRequest = async (
  ownerId: string,
  data: CreateLostRequestData
): Promise<ILostRequest> => {
  const lostRequest = await LostRequest.create({
    ownerId: new Types.ObjectId(ownerId),
    category: data.category,
    description: data.description,
    owner_location: data.owner_location,
    floor_id: data.floor_id,
    hall_name: data.hall_name,
    owner_location_confidence_stage: data.owner_location_confidence_stage,
    ownerImageUrl: data.ownerImageUrl ?? null,
  });

  return lostRequest;
};

/**
 * Resolve local FoundItem IDs from Python semantic matches.
 * First tries direct Mongo ObjectId IDs, then exact category+description fallback.
 */
export const resolveFoundItemIdsFromAiMatches = async (
  matches: AiSearchMatchInput[]
): Promise<string[]> => {
  if (!matches || matches.length === 0) return [];

  const resolvedIds = new Set<string>();

  const objectIds = matches
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id && Types.ObjectId.isValid(id)))
    .map((id) => new Types.ObjectId(id));

  if (objectIds.length > 0) {
    const docs = await FoundItem.find({
      _id: { $in: objectIds },
      status: { $ne: 'claimed' },
    }).select('_id');

    docs.forEach((doc) => resolvedIds.add(String(doc._id)));
  }

  const unresolvedTextMatches = matches.filter(
    (m) =>
      Boolean(m.description) &&
      !resolvedIds.has(m.id || '')
  );

  for (const match of unresolvedTextMatches) {
    const doc = await FoundItem.findOne({
      description: match.description,
      ...(match.category ? { category: match.category } : {}),
      status: { $ne: 'claimed' },
    }).select('_id');

    if (doc?._id) {
      resolvedIds.add(String(doc._id));
    }
  }

  return Array.from(resolvedIds);
};

/**
 * Resolve AI match payloads to local FoundItem records with score/location.
 */
export const resolveAiMatchesToFoundItems = async (
  matches: AiSearchMatchInput[]
): Promise<AiMatchedFoundItem[]> => {
  if (!matches || matches.length === 0) return [];

  const resolved: AiMatchedFoundItem[] = [];
  const seen = new Set<string>();

  const toScore = (value?: number): number => {
    if (typeof value !== 'number' || Number.isNaN(value)) return 0;
    // Python may return 0..1 or 0..100, normalize to 0..100
    return value <= 1 ? Math.round(value * 100) : Math.round(value);
  };

  for (const match of matches) {
    let doc: IFoundItem | null = null;

    if (match.id && Types.ObjectId.isValid(match.id)) {
      doc = await FoundItem.findOne({
        _id: new Types.ObjectId(match.id),
        status: { $ne: 'claimed' },
      });
    }

    if (!doc && match.description) {
      doc = await FoundItem.findOne({
        description: match.description,
        ...(match.category ? { category: match.category } : {}),
        status: { $ne: 'claimed' },
      });
    }

    if (!doc) continue;

    const foundItemId = String(doc._id);
    if (seen.has(foundItemId)) continue;
    seen.add(foundItemId);

    resolved.push({
      foundItemId,
      category: doc.category,
      description: doc.description,
      score: toScore(match.score),
      found_location: doc.found_location || [],
    });
  }

  return resolved;
};

/**
 * Update matched found item IDs for a lost request.
 */
export const updateLostRequestSearchResults = async (
  lostRequestId: string,
  data: LostRequestSearchResultsUpdate
): Promise<ILostRequest | null> => {
  const matchedFoundItemIds = data.matchedFoundItemIds
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));

  const imageMatchResults = (data.imageMatchResults || [])
    .filter((result) => Types.ObjectId.isValid(result.foundItemId))
    .map((result) => ({
      foundItemId: new Types.ObjectId(result.foundItemId),
      score: result.score,
    }));

  return LostRequest.findByIdAndUpdate(
    lostRequestId,
    {
      matchedFoundItemIds,
      ...(data.ownerImageUrl !== undefined ? { ownerImageUrl: data.ownerImageUrl } : {}),
      imageMatchResults,
    },
    { new: true }
  );
};

/**
 * Get lost requests by owner
 */
export const getLostRequestsByOwner = async (ownerId: string): Promise<ILostRequest[]> => {
  const requests = await LostRequest.find({ ownerId: new Types.ObjectId(ownerId) })
    .sort({ createdAt: -1 })
    .populate('matchedFoundItemIds');

  return requests;
};

/**
 * Get all found items for admin (with full details)
 */
export const getAllFoundItemsForAdmin = async (): Promise<IFoundItem[]> => {
  const items = await FoundItem.find()
    .sort({ createdAt: -1 })
    .populate('createdBy', 'name email role');

  return items;
};

/**
 * Get multiple found items by IDs (batch operation)
 */
export const getFoundItemsByIds = async (ids: string[]): Promise<IFoundItem[]> => {
  try {
    // Validate and convert IDs to ObjectIds
    const objectIds = ids
      .filter(id => {
        // Check if ID is a valid MongoDB ObjectId
        if (Types.ObjectId.isValid(id)) {
          return true;
        }
        console.warn(`Invalid ObjectId format: ${id}`);
        return false;
      })
      .map(id => new Types.ObjectId(id));

    if (objectIds.length === 0) {
      console.warn('No valid ObjectIds found in the provided IDs');
      return [];
    }

    const items = await FoundItem.find({
      _id: { $in: objectIds }
    })
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    console.log(`Found ${items.length} items out of ${objectIds.length} requested IDs`);
    return items;
  } catch (error) {
    console.error('Error in getFoundItemsByIds:', error);
    throw error;
  }
};
