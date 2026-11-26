import type { Types } from "mongoose";
import type { Role } from "../db/schemas";

export interface RequestContext {
  userId: Types.ObjectId;
  email: string;
  sessionId: Types.ObjectId;
  /** Set on /w/:ws routes by WorkspaceGuard. */
  workspaceId?: Types.ObjectId;
  role?: Role;
}

export const SESSION_COOKIE = "ft_session";
