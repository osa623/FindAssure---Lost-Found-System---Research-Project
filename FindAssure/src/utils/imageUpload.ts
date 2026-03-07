import axios from 'axios';
import { BASE_URL } from '../config/api.config';

/**
 * Upload image to backend (Cloudinary)
 * @param imageUri Local file URI from image picker
 * @returns Cloudinary URL of uploaded image
 */
export const uploadImage = async (imageUri: string): Promise<string> => {
  try {
    // Create form data
    const formData = new FormData();
    
    // Get file info
    const filename = imageUri.split('/').pop() || 'image.jpg';
    const match = /\.(\w+)$/.exec(filename);
    const type = match ? `image/${match[1]}` : 'image/jpeg';

    // Append image to form data
    formData.append('image', {
      uri: imageUri,
      name: filename,
      type: type,
    } as any);

    // Upload to backend
    const response = await axios.post(`${BASE_URL}/upload/image`, formData, {
      headers: {
        'Accept': 'application/json',
      },
      timeout: 120000,
    });

    if (response.data && response.data.imageUrl) {
      return response.data.imageUrl;
    } else {
      throw new Error('Failed to get image URL from response');
    }
  } catch (error) {
    console.error('Error uploading image:', error);
    throw new Error('Failed to upload image. Please try again.');
  }
};

/**
 * Check if URI is a local file or remote URL
 */
export const isLocalFile = (uri: string): boolean => {
  return uri.startsWith('file://') || uri.startsWith('ph://');
};
