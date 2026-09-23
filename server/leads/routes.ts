import { Router } from 'express';
import { asyncHandler } from '../shared/asyncHandler.js';
import { ValidationError } from '../shared/errors.js';
import { leadListRequest } from '../shared/convexClient.js';

const router = Router();

router.post('/rename', asyncHandler(async (req, res) => {
  const { listId, name } = req.body ?? {};
  if (typeof listId !== 'string' || !listId || typeof name !== 'string' || !name.trim())
    throw new ValidationError('List ID and name are required');
  await leadListRequest('rename', { listId, name });
  res.json({ ok: true });
}));

router.post('/delete', asyncHandler(async (req, res) => {
  const { listId } = req.body ?? {};
  if (typeof listId !== 'string' || !listId) throw new ValidationError('List ID is required');
  await leadListRequest('delete', { listId });
  res.json({ ok: true });
}));

export default router;
