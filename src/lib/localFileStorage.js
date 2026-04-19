/**
 * Local File Storage Module
 * Handles all file storage operations locally using IndexedDB and Blob storage
 * Replaces Firebase Cloud Storage for PDFs, documents, and other files
 */

import { get, set, del } from 'idb-keyval';

// Storage constants
const FILE_STORE_KEY = (uid, fileId) => `file:${uid}:${fileId}`;
const FILE_MANIFEST_KEY = (uid) => `fileManifest:${uid}`;
const FOLDER_FILE_INDEX_KEY = (uid, folderId) => `folderFiles:${uid}:${folderId}`;

/**
 * Save a file to local storage
 * @param {string} userId - User ID
 * @param {string} folderId - Folder ID where file is stored
 * @param {string} fileName - Name of the file
 * @param {Blob} fileBlob - File content as Blob
 * @param {string} fileId - Unique file identifier
 * @param {Object} metadata - Additional metadata (type, size, uploadedAt, etc.)
 * @returns {Promise<{success: boolean, fileId: string, path: string, url?: string, error?: string}>}
 */
export async function saveFileLocally(userId, folderId, fileName, fileBlob, fileId, metadata = {}) {
  try {
    if (!userId || !folderId || !fileId) {
      throw new Error('Missing required parameters: userId, folderId, or fileId');
    }

    const fileSize = fileBlob.size;
    const fileKey = FILE_STORE_KEY(userId, fileId);
    
    const fileData = {
      fileId,
      fileName,
      folderId,
      size: fileSize,
      type: fileBlob.type,
      createdAt: new Date().toISOString(),
      lastModified: Date.now(),
      metadata: metadata || {},
      blob: fileBlob // Store the actual file blob
    };

    // Save file to IndexedDB
    await set(fileKey, fileData);

    // Update file manifest
    const manifestKey = FILE_MANIFEST_KEY(userId);
    const manifest = (await get(manifestKey)) || { files: {} };
    manifest.files = manifest.files || {};
    manifest.files[fileId] = {
      fileName,
      folderId,
      size: fileSize,
      createdAt: fileData.createdAt,
      type: fileBlob.type
    };
    await set(manifestKey, manifest);

    // Update folder file index
    const folderIndexKey = FOLDER_FILE_INDEX_KEY(userId, folderId);
    const folderIndex = (await get(folderIndexKey)) || { fileIds: [] };
    if (!folderIndex.fileIds.includes(fileId)) {
      folderIndex.fileIds.push(fileId);
    }
    await set(folderIndexKey, folderIndex);

    const storagePath = `users/${userId}/pdfs/${folderId}/${fileName}`;
    
    console.debug(`[localFileStorage] File saved: ${storagePath}`);
    return {
      success: true,
      fileId,
      path: storagePath,
      url: null, // Will be generated via getBlobUrl when needed
      size: fileSize
    };
  } catch (error) {
    console.error('[localFileStorage] Error saving file:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get a file from local storage
 * @param {string} userId - User ID
 * @param {string} fileId - File ID
 * @returns {Promise<{success: boolean, blob?: Blob, metadata?: Object, error?: string}>}
 */
export async function getFileLocally(userId, fileId) {
  try {
    if (!userId || !fileId) {
      throw new Error('Missing required parameters: userId or fileId');
    }

    const fileKey = FILE_STORE_KEY(userId, fileId);
    const fileData = await get(fileKey);

    if (!fileData) {
      return {
        success: false,
        error: 'File not found'
      };
    }

    return {
      success: true,
      blob: fileData.blob,
      metadata: {
        fileName: fileData.fileName,
        folderId: fileData.folderId,
        size: fileData.size,
        type: fileData.type,
        createdAt: fileData.createdAt
      }
    };
  } catch (error) {
    console.error('[localFileStorage] Error getting file:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get a blob URL for a file (for viewing/downloading)
 * @param {string} userId - User ID
 * @param {string} fileId - File ID
 * @returns {Promise<string|null>} Blob URL or null if file not found
 */
export async function getBlobUrl(userId, fileId) {
  try {
    const result = await getFileLocally(userId, fileId);
    if (!result.success || !result.blob) {
      return null;
    }
    return URL.createObjectURL(result.blob);
  } catch (error) {
    console.error('[localFileStorage] Error getting blob URL:', error);
    return null;
  }
}

/**
 * Delete a file from local storage
 * @param {string} userId - User ID
 * @param {string} fileId - File ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteFileLocally(userId, fileId) {
  try {
    if (!userId || !fileId) {
      throw new Error('Missing required parameters: userId or fileId');
    }

    const fileKey = FILE_STORE_KEY(userId, fileId);
    const fileData = await get(fileKey);

    if (!fileData) {
      return {
        success: false,
        error: 'File not found'
      };
    }

    const folderId = fileData.folderId;

    // Delete file blob
    await del(fileKey);

    // Update manifest
    const manifestKey = FILE_MANIFEST_KEY(userId);
    const manifest = await get(manifestKey);
    if (manifest && manifest.files) {
      delete manifest.files[fileId];
      await set(manifestKey, manifest);
    }

    // Update folder index
    const folderIndexKey = FOLDER_FILE_INDEX_KEY(userId, folderId);
    const folderIndex = await get(folderIndexKey);
    if (folderIndex && folderIndex.fileIds) {
      folderIndex.fileIds = folderIndex.fileIds.filter(id => id !== fileId);
      await set(folderIndexKey, folderIndex);
    }

    console.debug(`[localFileStorage] File deleted: ${fileId}`);
    return { success: true };
  } catch (error) {
    console.error('[localFileStorage] Error deleting file:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get all files in a folder
 * @param {string} userId - User ID
 * @param {string} folderId - Folder ID
 * @returns {Promise<{success: boolean, files?: Array, error?: string}>}
 */
export async function getFilesInFolder(userId, folderId) {
  try {
    if (!userId || !folderId) {
      throw new Error('Missing required parameters: userId or folderId');
    }

    const folderIndexKey = FOLDER_FILE_INDEX_KEY(userId, folderId);
    const folderIndex = await get(folderIndexKey);

    if (!folderIndex || !folderIndex.fileIds) {
      return {
        success: true,
        files: []
      };
    }

    const files = [];
    for (const fileId of folderIndex.fileIds) {
      const result = await getFileLocally(userId, fileId);
      if (result.success) {
        files.push({
          fileId,
          ...result.metadata
        });
      }
    }

    return {
      success: true,
      files
    };
  } catch (error) {
    console.error('[localFileStorage] Error getting folder files:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get storage usage for a user
 * @param {string} userId - User ID
 * @returns {Promise<{success: boolean, totalBytes?: number, fileCount?: number, error?: string}>}
 */
export async function getStorageUsage(userId) {
  try {
    if (!userId) {
      throw new Error('Missing required parameter: userId');
    }

    const manifestKey = FILE_MANIFEST_KEY(userId);
    const manifest = await get(manifestKey);

    if (!manifest || !manifest.files) {
      return {
        success: true,
        totalBytes: 0,
        fileCount: 0
      };
    }

    const files = manifest.files;
    const totalBytes = Object.values(files).reduce((sum, file) => sum + (file.size || 0), 0);
    const fileCount = Object.keys(files).length;

    return {
      success: true,
      totalBytes,
      fileCount
    };
  } catch (error) {
    console.error('[localFileStorage] Error getting storage usage:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Clear all files for a user
 * @param {string} userId - User ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function clearUserFiles(userId) {
  try {
    if (!userId) {
      throw new Error('Missing required parameter: userId');
    }

    const manifestKey = FILE_MANIFEST_KEY(userId);
    const manifest = await get(manifestKey);

    if (manifest && manifest.files) {
      // Delete all file blobs
      for (const fileId of Object.keys(manifest.files)) {
        const fileKey = FILE_STORE_KEY(userId, fileId);
        await del(fileKey);
      }
    }

    // Delete manifest
    await del(manifestKey);

    console.debug(`[localFileStorage] All files cleared for user: ${userId}`);
    return { success: true };
  } catch (error) {
    console.error('[localFileStorage] Error clearing user files:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

export default {
  saveFileLocally,
  getFileLocally,
  getBlobUrl,
  deleteFileLocally,
  getFilesInFolder,
  getStorageUsage,
  clearUserFiles
};
