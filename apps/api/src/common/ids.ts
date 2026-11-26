import { Types } from "mongoose";
import { notFound } from "./errors";

/** A route's id as an ObjectId, or 404 (a malformed id is simply not found). */
export function oid(value: string, what?: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value) || String(new Types.ObjectId(value)) !== value) throw notFound(what);
  return new Types.ObjectId(value);
}
