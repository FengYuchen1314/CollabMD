import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { IMAGES_DIR, getConfig } from './userService.js';
import { v4 as uuidv4 } from 'uuid';

let s3Client = null;

function getS3Client() {
  if (s3Client) return s3Client;
  const config = getConfig();
  if (config.s3 && config.s3.endpoint) {
    s3Client = new S3Client({
      region: config.s3.region,
      endpoint: `https://${config.s3.endpoint}`,
      credentials: config.s3.accessKeyId && config.s3.secretAccessKey ? {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey
      } : undefined,
      forcePathStyle: config.s3.accessStyle !== 'virtual'
    });
  }
  return s3Client;
}

async function generateUniqueFilename(baseName, ext) {
  let counter = 1;
  let filename = `${baseName}${ext}`;
  const config = getConfig();
  
  while (true) {
    let exists = false;
    if (config.storageType === 's3' && config.s3 && config.s3.endpoint) {
      const client = getS3Client();
      try {
        const folder = config.s3.folder || 'md-image';
        await client.send(new HeadObjectCommand({
          Bucket: config.s3.bucket,
          Key: `${folder}/${filename}`
        }));
        exists = true;
      } catch (error) {
        if (error.name === 'NotFound') {
          exists = false;
        } else {
          throw error;
        }
      }
    } else {
      const localPath = path.join(IMAGES_DIR, filename);
      exists = fs.existsSync(localPath);
    }
    
    if (!exists) {
      return filename;
    }
    
    filename = `${baseName}_${String(counter).padStart(3, '0')}${ext}`;
    counter++;
    
    if (counter > 999) {
      filename = `${baseName}_${Date.now()}${ext}`;
      break;
    }
  }
  return filename;
}

export async function uploadImage(file) {
  const config = getConfig();
  const renameRule = config.imageRenameRule || 'uuid';
  const ext = path.extname(file.originalname);
  
  let filename;
  const baseName = path.basename(file.originalname, ext);
  const safeBaseName = baseName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5-_]/g, '_');
  
  switch (renameRule) {
    case 'original':
      filename = await generateUniqueFilename(safeBaseName, ext);
      break;
    case 'timestamp':
      const timestamp = Date.now();
      filename = `${timestamp}${ext}`;
      break;
    case 'uuid':
    default:
      filename = `${uuidv4()}${ext}`;
      break;
  }

  if (config.storageType === 's3' && config.s3 && config.s3.endpoint) {
    const client = getS3Client();
    const folder = config.s3.folder || 'md-image';
    const key = `${folder}/${filename}`;
    await client.send(new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype
    }));
    let url;
    if (config.s3.accessStyle === 'virtual') {
      url = `https://${config.s3.bucket}.${config.s3.endpoint}/${key}`;
    } else {
      url = `https://${config.s3.endpoint}/${config.s3.bucket}/${key}`;
    }
    return { url, filename };
  }

  const localPath = path.join(IMAGES_DIR, filename);
  fs.writeFileSync(localPath, file.buffer);
  const url = `/api/upload/images/${filename}`;
  return { url, filename };
}

export async function deleteImage(filename) {
  const config = getConfig();

  if (config.storageType === 's3' && config.s3 && config.s3.endpoint) {
    const client = getS3Client();
    const folder = config.s3.folder || 'md-image';
    await client.send(new DeleteObjectCommand({
      Bucket: config.s3.bucket,
      Key: `${folder}/${filename}`
    }));
    return true;
  }

  const localPath = path.join(IMAGES_DIR, filename);
  if (fs.existsSync(localPath)) {
    fs.unlinkSync(localPath);
  }
  return true;
}

export function getImagePath(filename) {
  return path.join(IMAGES_DIR, filename);
}
