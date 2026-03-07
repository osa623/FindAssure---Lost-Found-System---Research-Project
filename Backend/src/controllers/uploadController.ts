import { Request, Response, NextFunction } from 'express';
import {
  upload,
  uploadToCloudinary,
  isCloudinaryConfigured,
  getCloudinaryConfigPreview,
} from '../utils/cloudinary';

/**
 * Upload image endpoint
 * POST /api/upload/image
 */
export const uploadImage = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Debug logging
    console.log('📤 Upload request received');
    console.log('🔑 Cloudinary Config:', getCloudinaryConfigPreview());

    // Check if file exists
    if (!req.file) {
      res.status(400).json({
        message: 'No image file provided',
      });
      return;
    }

    console.log('📁 File received:', req.file.originalname, req.file.size, 'bytes');

    // Check if Cloudinary is configured
    if (!isCloudinaryConfigured()) {
      console.warn('⚠️ Cloudinary not configured - using placeholder');
      // Return a placeholder URL when Cloudinary is not configured
      res.status(200).json({
        message: 'Image uploaded (placeholder - Cloudinary not configured)',
        imageUrl: `https://via.placeholder.com/400x400/007AFF/FFFFFF?text=${encodeURIComponent(req.file.originalname)}`,
        publicId: 'placeholder',
      });
      return;
    }

    try {
      console.log('☁️ Attempting Cloudinary upload...');
      
      // Create upload promise with proper error handling
      const result = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Cloudinary upload timeout'));
        }, 30000);

        uploadToCloudinary(req.file!.buffer, 'findassure/found-items')
          .then((value) => {
            clearTimeout(timeoutId);
            resolve(value);
          })
          .catch((err) => {
            clearTimeout(timeoutId);
            console.error('Cloudinary promise rejected:', err);
            reject(err);
          });
      });

      console.log('✅ Cloudinary upload successful');
      res.status(200).json({
        message: 'Image uploaded successfully',
        imageUrl: result.secure_url,
        publicId: result.public_id,
      });
    } catch (cloudinaryError: any) {
      console.error('❌ Cloudinary upload failed:', cloudinaryError.message || cloudinaryError);
      
      // Return placeholder if Cloudinary fails
      console.log('⚠️ Returning placeholder image');
      res.status(200).json({
        message: 'Image upload failed, using placeholder',
        imageUrl: `https://via.placeholder.com/400x400/FF6B6B/FFFFFF?text=${encodeURIComponent(req.file!.originalname)}`,
        publicId: 'placeholder-error',
        warning: cloudinaryError.message || 'Upload failed',
      });
    }
  } catch (error: any) {
    console.error('❌ Upload endpoint error:', error);
    // Ensure we always send a response
    if (!res.headersSent) {
      res.status(500).json({
        message: 'Upload failed',
        error: error.message,
      });
    }
  }
};

export const uploadMiddleware = upload.single('image');
