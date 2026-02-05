import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import type { Request } from 'express';
import { diskStorage, type StorageEngine } from 'multer';
import { extname } from 'path';

/**
 * Allowed MIME types and their categories
 */
export const ALLOWED_ATTACHMENT_TYPES = {
  image: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/heif',
  ],
  video: [
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-msvideo',
    'video/x-matroska',
  ],
  document: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'application/zip',
    'application/x-rar-compressed',
    'application/json',
  ],
  voice: [
    'audio/webm',
    'audio/ogg',
    'audio/mp3',
    'audio/mpeg',
    'audio/mp4',
    'audio/wav',
    'audio/x-m4a',
  ],
};

/**
 * Size limits per attachment type (in bytes)
 */
export const ATTACHMENT_SIZE_LIMITS = {
  image: 10 * 1024 * 1024, // 10MB
  video: 50 * 1024 * 1024, // 50MB
  document: 25 * 1024 * 1024, // 25MB
  voice: 5 * 1024 * 1024, // 5MB
};

/**
 * Get attachment type from MIME type
 */
export function getAttachmentType(
  mimeType: string,
): 'image' | 'video' | 'document' | 'voice' | null {
  if (ALLOWED_ATTACHMENT_TYPES.image.includes(mimeType)) return 'image';
  if (ALLOWED_ATTACHMENT_TYPES.video.includes(mimeType)) return 'video';
  if (ALLOWED_ATTACHMENT_TYPES.document.includes(mimeType)) return 'document';
  if (ALLOWED_ATTACHMENT_TYPES.voice.includes(mimeType)) return 'voice';
  return null;
}

/**
 * Get all allowed MIME types
 */
export function getAllAllowedMimeTypes(): string[] {
  return [
    ...ALLOWED_ATTACHMENT_TYPES.image,
    ...ALLOWED_ATTACHMENT_TYPES.video,
    ...ALLOWED_ATTACHMENT_TYPES.document,
    ...ALLOWED_ATTACHMENT_TYPES.voice,
  ];
}

/**
 * Multer disk storage configuration for chat attachments.
 * Files are stored in ./uploads/chat-attachments with a unique filename.
 */
export const chatAttachmentStorage: StorageEngine = diskStorage({
  destination: './uploads/chat-attachments',
  filename: (
    req: Request,
    file: Express.Multer.File,
    callback: (error: Error | null, filename: string) => void,
  ): void => {
    const userId = (req as Request & { user?: { id: number } }).user?.id ?? 0;
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = extname(file.originalname).toLowerCase();
    const attachmentType = getAttachmentType(file.mimetype) ?? 'file';
    callback(null, `${attachmentType}-${userId}-${uniqueSuffix}${ext}`);
  },
});

/**
 * File filter for chat attachments.
 * Validates MIME type against allowed types.
 */
export function chatAttachmentFileFilter(
  _req: Request,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  const allAllowed = getAllAllowedMimeTypes();
  if (allAllowed.includes(file.mimetype)) {
    callback(null, true);
  } else {
    callback(
      new BadRequestException(
        `Invalid file type: ${file.mimetype}. Allowed types: images, videos, documents, and voice notes.`,
      ),
      false,
    );
  }
}

/**
 * Complete multer options for chat attachments.
 * Uses the maximum size limit (video: 50MB) - actual validation is done in controller
 */
export const chatAttachmentUploadOptions: MulterOptions = {
  storage: chatAttachmentStorage,
  limits: {
    fileSize: ATTACHMENT_SIZE_LIMITS.video, // 50MB max (largest allowed)
  },
  fileFilter: chatAttachmentFileFilter,
};

/**
 * Multer options specifically for voice notes (smaller size limit)
 */
export const voiceNoteUploadOptions: MulterOptions = {
  storage: chatAttachmentStorage,
  limits: {
    fileSize: ATTACHMENT_SIZE_LIMITS.voice, // 5MB max
  },
  fileFilter: (
    _req: Request,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ): void => {
    if (ALLOWED_ATTACHMENT_TYPES.voice.includes(file.mimetype)) {
      callback(null, true);
    } else {
      callback(
        new BadRequestException(
          'Invalid file type for voice note. Only audio files are allowed.',
        ),
        false,
      );
    }
  },
};
