import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import { Request } from 'express';
import fs from 'fs';
import path from 'path';

const resolveCloudinaryConfig = () => {
  const cloudinaryUrl = (process.env.CLOUDINARY_URL || '').trim();
  if (cloudinaryUrl) {
    try {
      const parsed = new URL(cloudinaryUrl);
      return {
        cloud_name: (parsed.hostname || '').trim(),
        api_key: decodeURIComponent((parsed.username || '').trim()),
        api_secret: decodeURIComponent((parsed.password || '').trim()),
      };
    } catch (error) {
      console.error('Invalid CLOUDINARY_URL format');
    }
  }

  return {
    cloud_name: (process.env.CLOUDINARY_CLOUD_NAME || '').trim(),
    api_key: (process.env.CLOUDINARY_API_KEY || '').trim(),
    api_secret: (process.env.CLOUDINARY_API_SECRET || '').trim(),
  };
};

const configureCloudinary = () => {
  const cfg = resolveCloudinaryConfig();
  cloudinary.config({
    cloud_name: cfg.cloud_name,
    api_key: cfg.api_key,
    api_secret: cfg.api_secret,
    secure: true,
    // Prevent Cloudinary SDK from emitting its own unhandled promise rejections
    disable_promise: true,
  });
  return cfg;
};

export const getCloudinaryConfigPreview = () => {
  const cfg = resolveCloudinaryConfig();
  return {
    cloud_name: cfg.cloud_name || 'NOT SET',
    api_key: cfg.api_key ? `***${cfg.api_key.slice(-4)}` : 'NOT SET',
    api_secret: cfg.api_secret ? 'SET' : 'NOT SET',
  };
};

// Configure Multer for memory storage (we'll upload to Cloudinary from memory)
const storage = multer.memoryStorage();
const tempUploadDir = path.join(process.cwd(), 'tmp', 'item-images');

fs.mkdirSync(tempUploadDir, { recursive: true });

const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Accept images only
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'));
  }
};

export const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
});

const tempDiskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, tempUploadDir);
  },
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname || '') || '.jpg';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1_000_000_000)}${extension}`);
  },
});

export const uploadTempImages = multer({
  storage: tempDiskStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

// Configure Multer for video files (for verification)
const videoFileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Accept video files only
  if (file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    cb(new Error('Only video files are allowed'));
  }
};

export const uploadVideos = multer({
  storage: storage,
  fileFilter: videoFileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size for videos
  },
});

/**
 * Upload image buffer to Cloudinary
 * @param buffer Image buffer from multer
 * @param folder Cloudinary folder name
 * @returns Cloudinary upload result with secure URL
 */
export const uploadToCloudinary = (
  buffer: Buffer,
  folder: string = 'findassure'
): Promise<{ secure_url: string; public_id: string }> => {
  return new Promise((resolve, reject) => {
    try {
      configureCloudinary();
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: folder,
          resource_type: 'image',
          disable_promise: true,
          transformation: [
            { width: 1000, height: 1000, crop: 'limit' }, // Limit max dimensions
            { quality: 'auto:good' }, // Automatic quality optimization
          ],
        },
        (error, result) => {
          if (error) {
            console.error('Cloudinary callback error:', error);
            reject(error);
          } else if (result) {
            resolve({
              secure_url: result.secure_url,
              public_id: result.public_id,
            });
          } else {
            reject(new Error('Upload failed - no result returned'));
          }
        }
      );

      uploadStream.on('error', (err) => {
        console.error('Cloudinary stream error:', err);
        reject(err);
      });

      uploadStream.end(buffer);
    } catch (error) {
      console.error('Cloudinary synchronous error:', error);
      reject(error);
    }
  });
};

/**
 * Delete image from Cloudinary
 * @param publicId Public ID of the image to delete
 */
export const deleteFromCloudinary = async (publicId: string): Promise<void> => {
  try {
    configureCloudinary();
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error('Error deleting image from Cloudinary:', error);
    throw error;
  }
};

/**
 * Check if Cloudinary is configured
 */
export const isCloudinaryConfigured = (): boolean => {
  const cfg = resolveCloudinaryConfig();
  return !!(
    cfg.cloud_name &&
    cfg.api_key &&
    cfg.api_secret
  );
};

export default cloudinary;
