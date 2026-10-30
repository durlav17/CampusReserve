import { HttpError } from '../utils/errors.js';
import * as resources from '../services/resourceService.js';
import * as ref from '../services/referenceService.js';

const parseFeatures = (r) => {
  if (!r) return r;
  let features;
  try { features = r.featuresJson ? JSON.parse(r.featuresJson) : null; } catch { features = null; }
  const { featuresJson, ...rest } = r;
  return { ...rest, features };
};

export async function list(req, res) {
  res.json({ items: (await resources.listResources(req.valid.query)).map(parseFeatures) });
}

export async function get(req, res) {
  const r = await resources.getResource(req.valid.params.id);
  if (!r) throw new HttpError(404, 'RESOURCE_NOT_FOUND', 'Resource not found.');
  res.json({ resource: parseFeatures(r) });
}

export async function schedule(req, res) {
  const { from, to } = req.valid.query;
  res.json({ items: await resources.getSchedule(req.valid.params.id, from, to) });
}

export async function slots(req, res) {
  const { date, slotMinutes } = req.valid.query;
  res.json({ date, items: await resources.getDaySlots(req.valid.params.id, date, slotMinutes) });
}

export async function availability(req, res) {
  const { start, end } = req.valid.query;
  const verdict = await resources.checkAvailability(req.valid.params.id, start, end);
  res.json({ verdict, available: verdict === 'AVAILABLE' });
}

export async function create(req, res) {
  const id = await resources.createResource(req.user.userId, req.valid.body);
  res.status(201).json({ resource: parseFeatures(await resources.getResource(id)) });
}

export async function update(req, res) {
  const n = await resources.updateResource(req.user.userId, req.valid.params.id, req.valid.body);
  if (n === 0) throw new HttpError(404, 'RESOURCE_NOT_FOUND', 'Resource not found or nothing to update.');
  res.json({ resource: parseFeatures(await resources.getResource(req.valid.params.id)) });
}

export async function blackouts(req, res) {
  res.json({ items: await resources.listBlackouts(req.valid.params.id) });
}

export async function createBlackout(req, res) {
  const result = await resources.createBlackout(req.user.userId, req.valid.params.id, req.valid.body);
  if (!result) throw new HttpError(404, 'RESOURCE_NOT_FOUND', 'Resource not found.');
  res.status(201).json(result);
}

export async function deleteBlackout(req, res) {
  const n = await resources.deleteBlackout(req.user.userId, req.valid.params.id);
  if (n === 0) throw new HttpError(404, 'NOT_FOUND', 'Blackout not found.');
  res.status(204).end();
}

export const departments = async (_req, res) => res.json({ items: await ref.listDepartments() });
export const buildings = async (_req, res) => res.json({ items: await ref.listBuildings() });
export const categories = async (_req, res) => res.json({ items: await ref.listCategories() });
export const roles = async (_req, res) => res.json({ items: await ref.listRoles() });
