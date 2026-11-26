// Saving with a version check: the client sends the version it edited; the
// save only lands if nobody saved in between. Otherwise 409 "stale" with the
// current document, so the screen can reload it (no silent overwrites).

import type { FilterQuery, Model, Types, UpdateQuery } from "mongoose";
import { notFound, stale } from "./errors";

export async function saveVersioned<T extends { version: number }>(
  model: Model<T>,
  filter: { _id: Types.ObjectId; workspaceId: Types.ObjectId },
  version: number,
  update: UpdateQuery<T>,
  out: (doc: T) => unknown,
  what?: string,
): Promise<T> {
  const live = { ...filter, deletedAt: null } as FilterQuery<T>;
  const next = await model.findOneAndUpdate({ ...live, version } as FilterQuery<T>, { ...update, $inc: { version: 1 } } as UpdateQuery<T>, { new: true }).lean<T>();
  if (next) return next;
  const current = await model.findOne(live).lean<T>();
  if (!current) throw notFound(what);
  throw stale(out(current));
}
