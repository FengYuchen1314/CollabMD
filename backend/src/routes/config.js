import { Router } from 'express';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import { getConfig, saveConfig } from '../services/userService.js';

const router = Router();

router.get('/', (req, res) => {
  const config = getConfig();
  const safeConfig = { ...config };
  if (safeConfig.s3) {
    safeConfig.s3 = { ...safeConfig.s3 };
    delete safeConfig.s3.secretAccessKey;
  }
  res.json(safeConfig);
});

router.use(authMiddleware);
router.use(adminMiddleware);

router.put('/', (req, res) => {
  const { storageType, s3, imageRenameRule } = req.body;
  const config = getConfig();
  if (storageType) {
    config.storageType = storageType;
  }
  if (s3) {
    config.s3 = {
      region: s3.region || 'auto',
      endpoint: s3.endpoint,
      bucket: s3.bucket,
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
      accessStyle: s3.accessStyle || 'virtual',
      folder: s3.folder || 'md-image'
    };
  }
  if (imageRenameRule) {
    config.imageRenameRule = imageRenameRule;
  }
  saveConfig(config);
  const safeConfig = { ...config };
  if (safeConfig.s3) {
    delete safeConfig.s3.secretAccessKey;
  }
  res.json(safeConfig);
});

export default router;
