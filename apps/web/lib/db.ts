import { MongoClient, type Collection, type Db } from "mongodb";
import { env } from "./env";
import type { Call, DncEntry, QueueState, Settings, TranscriptLine, Workspace } from "./types";

// One client per server process (and per hot reload in dev), opened on first use.

type Cache = { client?: Promise<MongoClient>; ready?: Promise<void>; uri?: string };
const cache = globalThis as unknown as { __outreachDb?: Cache };

async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    // One live line per workspace, enforced by the database itself.
    db.collection("calls").createIndex(
      { workspaceId: 1, active: 1 },
      { name: "workspace_active", unique: true, partialFilterExpression: { active: true } },
    ),
    db.collection("calls").createIndex({ workspaceId: 1, status: 1, order: 1 }),
    db.collection("calls").createIndex({ queuedAt: -1 }),
    db.collection("transcripts").createIndex({ callId: 1, seq: 1 }, { unique: true }),
  ]);
  // The original app had a global one-call index. It would stop two separate
  // workspaces from operating independently, so retire it once the scoped
  // index above exists. Mongo's index-not-found error is harmless on a fresh DB.
  await db.collection("calls").dropIndex("active_1").catch((err: { code?: number }) => {
    if (err?.code !== 27) throw err;
  });
}

export async function getDb(): Promise<Db> {
  const uri = env.mongoUri();
  const state = (cache.__outreachDb ??= {});
  if (!state.client || state.uri !== uri) {
    state.uri = uri;
    state.client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 }).connect();
    state.ready = undefined;
  }
  const db = (await state.client).db();
  state.ready ??= ensureIndexes(db);
  await state.ready;
  return db;
}

/** Close the connection (tests). */
export async function closeDb(): Promise<void> {
  const state = cache.__outreachDb;
  if (state?.client) await (await state.client).close();
  cache.__outreachDb = {};
}

type SettingsDoc = Settings & { _id: string; workspaceId?: string };
type QueueDoc = QueueState & { _id: string };

export async function collections() {
  const db = await getDb();
  return {
    calls: db.collection<Call>("calls") as Collection<Call>,
    transcripts: db.collection<TranscriptLine>("transcripts"),
    settings: db.collection<SettingsDoc>("settings"),
    queue: db.collection<QueueDoc>("settings") as unknown as Collection<QueueDoc>,
    dnc: db.collection<DncEntry>("dnc"),
    workspaces: db.collection<Workspace>("workspaces"),
  };
}
