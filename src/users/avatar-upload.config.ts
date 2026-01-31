import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import type { Request } from 'express';
import { diskStorage, type StorageEngine } from 'multer';
import { extname } from 'path';
import type { RequestWithUser } from '../common/interfaces/request-with-user.interface';

/**
 * Multer disk storage configuration for avatar uploads.
 * Files are stored in ./uploads/avatars with a unique filename.
 */
export const avatarStorage: StorageEngine = diskStorage({
  destination: './uploads/avatars',
  filename: (
    req: Request,
    file: Express.Multer.File,
    callback: (error: Error | null, filename: string) => void,
  ): void => {
    const typedReq = req as unknown as RequestWithUser;
    const userId = typedReq.user?.id ?? 'unknown';
    const uniqueSuffix = Date.now();
    const ext = extname(file.originalname);
    callback(null, `user-${userId}-${uniqueSuffix}${ext}`);
  },
});

/**
 * File filter for avatar uploads.
 * Only allows JPEG, PNG, and WebP images.
 */
export function avatarFileFilter(
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
 * Complete multer options for avatar uploads.
 */
export const avatarUploadOptions: MulterOptions = {
  storage: avatarStorage,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB max
  },
  fileFilter: avatarFileFilter,
};
