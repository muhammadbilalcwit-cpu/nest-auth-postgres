import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import type { Request } from 'express';
import { diskStorage, type StorageEngine } from 'multer';
import { extname } from 'path';

/**
 * Multer disk storage configuration for group avatar uploads.
 * Files are stored in ./uploads/group-avatars with a unique filename.
 */
export const groupAvatarStorage: StorageEngine = diskStorage({
  destination: './uploads/group-avatars',
  filename: (
    req: Request,
    file: Express.Multer.File,
    callback: (error: Error | null, filename: string) => void,
  ): void => {
    const paramId = req.params.id;
    const groupId = Array.isArray(paramId)
      ? paramId[0]
      : (paramId ?? 'unknown');
    const uniqueSuffix = Date.now();
    const ext = extname(file.originalname);
    callback(null, `group-${groupId}-${uniqueSuffix}${ext}`);
  },
});

/**
 * File filter for group avatar uploads.
 * Only allows JPEG, PNG, and WebP images.
 */
export function groupAvatarFileFilter(
  _req: Request,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowedMimes.includes(file.mimetype)) {
    callback(null, true);
  } else {
    callback(
      new BadRequestException(
        'Invalid file type. Only JPEG, PNG and WebP are allowed.',
      ),
      false,
    );
  }
}

/**
 * Complete multer options for group avatar uploads.
 */
export const groupAvatarUploadOptions: MulterOptions = {
  storage: groupAvatarStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: groupAvatarFileFilter,
};
