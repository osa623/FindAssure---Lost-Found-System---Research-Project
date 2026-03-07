import axiosClient from './axiosClient';
import {
  FoundItem,
  LostItem,
  OwnerAnswerInput,
  AdminOverview,
  SelectedImageAsset,
  FounderImagePreAnalysisResponse,
} from '../types/models';

const logAxiosRequestError = (context: string, error: any) => {
  const responseStatus = error?.response?.status;
  const responseData = error?.response?.data;
  const message = error?.message || 'Unknown request error';

  console.error(`❌ ${context}:`, {
    message,
    code: error?.code,
    status: responseStatus,
    data: responseData,
  });
};

export interface LostItemSearchResponse extends LostItem {
  aiSearch?: {
    status: 'ok' | 'failed';
    total_matches: number;
    matchedFoundItemIds: string[];
    query_id?: string;
    impression_id?: string;
    detail?: string;
  };
  results: FoundItem[];
}

const buildImageMimeType = (image: SelectedImageAsset): string => {
  if (image.mimeType) {
    return image.mimeType;
  }

  const filename = image.fileName || image.uri.split('/').pop() || 'image.jpg';
  const extension = filename.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
};

export const itemsApi = {
  // IMAGE UPLOAD
  
  // Upload image to server (Cloudinary)
  uploadImage: async (imageUri: string): Promise<string> => {
    try {
      const formData = new FormData();
      
      // Get file info
      const filename = imageUri.split('/').pop() || 'image.jpg';
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : 'image/jpeg';

      // Append image to form data with proper format for React Native
      formData.append('image', {
        uri: imageUri,
        name: filename,
        type: type,
      } as any);

      console.log('📤 Uploading image:', { filename, type, uri: imageUri.substring(0, 50) + '...' });

      // Upload to backend
      const response = await axiosClient.post<{ imageUrl: string; publicId: string }>(
        '/upload/image',
        formData,
        {
          headers: {
            'Accept': 'application/json',
          },
          // Important: Set transformRequest to undefined to let axios handle FormData properly
          transformRequest: (data) => data,
          timeout: 120000,
        }
      );

      console.log('✅ Image uploaded successfully:', response.data.imageUrl);
      return response.data.imageUrl;
    } catch (error: any) {
      logAxiosRequestError('Image upload error', error);
      throw new Error(error.response?.data?.message || 'Failed to upload image');
    }
  },

  // AI QUESTION GENERATION
  
  // Generate verification questions using AI
  generateQuestions: async (data: {
    category: string;
    description: string;
  }): Promise<{ questions: string[] }> => {
    const response = await axiosClient.post<{ questions: string[] }>('/items/generate-questions', data);
    return response.data;
  },

  // FOUNDER ENDPOINTS

  preAnalyzeFoundImages: async (
    images: SelectedImageAsset[]
  ): Promise<FounderImagePreAnalysisResponse> => {
    const formData = new FormData();

    for (const image of images) {
      formData.append('images', {
        uri: image.uri,
        name: image.fileName || `photo_${Date.now()}.jpg`,
        type: buildImageMimeType(image),
      } as any);
    }

    try {
      const response = await axiosClient.post<FounderImagePreAnalysisResponse>(
        '/items/pre-analyze-found-images',
        formData,
        {
          headers: {
            'Accept': 'application/json',
          },
          timeout: 300000,
        }
      );

      return response.data;
    } catch (error: any) {
      logAxiosRequestError('Founder image pre-analysis error', error);
      throw new Error(error.response?.data?.message || error.message || 'Failed to analyze images');
    }
  },
  
  // Report a found item
  reportFoundItem: async (data: {
    images: SelectedImageAsset[];
    preAnalysisToken?: string | null;
    category: string;
    description: string;
    questions: string[];
    founderAnswers: string[];
    found_location: {
      location: string;
      floor_id?: string | null;
      hall_name?: string | null;
    }[];
    founderContact: {
      name: string;
      email: string;
      phone: string;
    };
  }): Promise<FoundItem> => {
    const formData = new FormData();

    for (const image of data.images) {
      formData.append('images', {
        uri: image.uri,
        name: image.fileName || `photo_${Date.now()}.jpg`,
        type: buildImageMimeType(image),
      } as any);
    }

    formData.append('category', data.category);
    formData.append('description', data.description);
    if (data.preAnalysisToken) {
      formData.append('preAnalysisToken', data.preAnalysisToken);
    }
    formData.append('questions', JSON.stringify(data.questions));
    formData.append('founderAnswers', JSON.stringify(data.founderAnswers));
    formData.append('founderContact', JSON.stringify(data.founderContact));
    formData.append('found_location', JSON.stringify(data.found_location));

    try {
      const response = await axiosClient.post<FoundItem>('/items/found', formData, {
        headers: {
          'Accept': 'application/json',
        },
        timeout: 120000,
      });
      return response.data;
    } catch (error: any) {
      logAxiosRequestError('Report found item error', error);
      throw new Error(error.response?.data?.message || error.message || 'Failed to report found item');
    }
  },

  // OWNER ENDPOINTS
  
  // Create a lost item request
  reportLostItem: async (data: {
    category: string;
    description: string;
    owner_location: string;
    floor_id?: string | null;
    hall_name?: string | null;
    owner_location_confidence_stage: number;
    ownerImage?: SelectedImageAsset | null;
  }): Promise<LostItemSearchResponse> => {
    const formData = new FormData();
    formData.append('category', data.category);
    formData.append('description', data.description);
    formData.append('owner_location', data.owner_location);
    formData.append('owner_location_confidence_stage', String(data.owner_location_confidence_stage));

    if (data.floor_id) {
      formData.append('floor_id', data.floor_id);
    }

    if (data.hall_name) {
      formData.append('hall_name', data.hall_name);
    }

    if (data.ownerImage) {
      formData.append('ownerImage', {
        uri: data.ownerImage.uri,
        name: data.ownerImage.fileName || `search_${Date.now()}.jpg`,
        type: buildImageMimeType(data.ownerImage),
      } as any);
    }

    try {
      const response = await axiosClient.post<LostItemSearchResponse>('/items/lost', formData, {
        headers: {
          'Accept': 'application/json',
        },
        timeout: 120000,
      });
      return response.data;
    } catch (error: any) {
      logAxiosRequestError('Report lost item error', error);
      throw new Error(error.response?.data?.message || error.message || 'Failed to search lost item');
    }
  },

  // Get all found items (for owner to browse)
  getFoundItems: async (): Promise<FoundItem[]> => {
    const response = await axiosClient.get<FoundItem[]>('/items/found');
    return response.data;
  },

  // Get a specific found item by ID
  getFoundItemById: async (id: string): Promise<FoundItem> => {
    const response = await axiosClient.get<FoundItem>(`/items/found/${id}`);
    return response.data;
  },

  // Get specific found items by a list of IDs
  getFoundItemsByIds: async (itemIds: string[]): Promise<FoundItem[]> => {
    if (!itemIds.length) return [];
    const response = await axiosClient.post<FoundItem[]>('/items/found/batch', { itemIds });
    return response.data;
  },

  // Submit verification (owner's answers with unified structure)
  submitVerification: async (data: {
    foundItemId: string;
    ownerAnswers: OwnerAnswerInput[];
  }): Promise<any> => {
    try {
      const formData = new FormData();

      // Map question index to word format (0 -> one, 1 -> two, etc.)
      const numberWords = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

      // Prepare the data payload
      const dataPayload = {
        foundItemId: data.foundItemId,
        ownerAnswers: data.ownerAnswers.map(answer => {
          const videoKey = `owner_answer_${numberWords[answer.questionId] || answer.questionId + 1}`;
          return {
            questionId: answer.questionId,
            answer: answer.answer,
            videoKey: videoKey,
          };
        }),
      };

      // Add JSON data as a string in the 'data' field (mimicking Python backend format)
      formData.append('data', JSON.stringify(dataPayload));

      // Add video files if they exist
      for (const answer of data.ownerAnswers) {
        if (answer.videoUri) {
          // Get file info
          const filename = answer.videoUri.split('/').pop() || `video_${answer.questionId}.mp4`;
          const match = /\.(\w+)$/.exec(filename);
          const type = match ? `video/${match[1]}` : 'video/mp4';

          const videoKey = `owner_answer_${numberWords[answer.questionId] || answer.questionId + 1}`;

          console.log(`📤 Adding video for question ${answer.questionId + 1}:`, { 
            videoKey, 
            filename, 
            type,
            uri: answer.videoUri.substring(0, 50) + '...' 
          });

          // Append video to form data
          formData.append(videoKey, {
            uri: answer.videoUri,
            name: filename,
            type: type,
          } as any);
        }
      }

      console.log('📤 Submitting verification with videos...');

      // Send multipart/form-data request
      const response = await axiosClient.post('/items/verification', formData, {
        headers: {
          'Accept': 'application/json',
        },
        timeout: 120000, // 120 seconds for video upload and processing
      });

      console.log('✅ Verification submitted successfully');
      return response.data;
    } catch (error: any) {
      logAxiosRequestError('Verification submission error', error);
      throw new Error(error.response?.data?.message || 'Failed to submit verification');
    }
  },

  // ADMIN ENDPOINTS
  
  // Get admin overview statistics
  getAdminOverview: async (): Promise<AdminOverview> => {
    const response = await axiosClient.get<AdminOverview>('/admin/overview');
    return response.data;
  },

  // Update found item status (admin only)
  updateFoundItemStatus: async (id: string, status: string): Promise<FoundItem> => {
    const response = await axiosClient.patch<FoundItem>(`/admin/items/found/${id}`, { status });
    return response.data;
  },
};
