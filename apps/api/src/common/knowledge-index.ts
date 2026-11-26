// Keeps each knowledge document's passages in step with its text, and finds
// the passages that answer a question. Search is MongoDB text search (stemmed
// words; a section heading counts ×3 and the document's name ×2, since a
// passage rarely repeats what its title says) over this workspace's documents; an agent sees only
// documents shared with every agent or attached to it. Embeddings plug in here
// once the vector store is chosen.

import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { chunkText } from "@outreach/core/chunks";
import { Types } from "mongoose";
import type { M } from "../db/models";

export interface Passage {
  docId: string;
  docName: string;
  heading: string;
  text: string;
  score: number;
}

@Injectable()
export class KnowledgeIndex {
  constructor(
    @InjectModel("KnowledgeChunk") private readonly chunks: M<"KnowledgeChunk">,
    @InjectModel("Knowledge") private readonly docs: M<"Knowledge">,
    @InjectModel("Agent") private readonly agents: M<"Agent">,
  ) {}

  /** Re-cuts one document (call after its text changes, or with no text to clear it). */
  async reindex(docId: Types.ObjectId): Promise<number> {
    const doc = await this.docs.findById(docId, { workspaceId: 1, name: 1, content: 1, status: 1, deletedAt: 1 }).lean();
    await this.chunks.deleteMany({ docId });
    if (!doc || doc.deletedAt || doc.status !== "ready" || !doc.content) return 0;
    const parts = chunkText(doc.content);
    if (parts.length) await this.chunks.insertMany(parts.map((c) => ({ workspaceId: doc.workspaceId, docId, docName: (doc.name ?? "").replace(/\.(pdf|docx|txt|md|csv|json|html?|xml)$/i, ""), index: c.index, heading: c.heading, text: c.text })));
    return parts.length;
  }

  async reindexWorkspace(workspaceId: Types.ObjectId): Promise<void> {
    const docs = await this.docs.find({ workspaceId, deletedAt: null, status: "ready" }, { _id: 1 }).lean();
    for (const d of docs) await this.reindex(d._id);
  }

  /** The best passages for a question, from every document or only those an agent can use. */
  async search(workspaceId: Types.ObjectId, query: string, opts: { agentId?: string; limit?: number } = {}): Promise<Passage[]> {
    const q = query.trim().slice(0, 300);
    if (!q) return [];
    const usable = { workspaceId, deletedAt: null, status: "ready" };
    let docFilter: Record<string, unknown> = usable;
    if (opts.agentId && Types.ObjectId.isValid(opts.agentId)) {
      const agent = await this.agents.findOne({ _id: new Types.ObjectId(opts.agentId), workspaceId, deletedAt: null }, { "draft.knowledgeIds": 1 }).lean();
      const attached = ((agent?.draft as { knowledgeIds?: string[] } | undefined)?.knowledgeIds ?? []).filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
      docFilter = { ...usable, $or: [{ availableToAll: true }, { _id: { $in: attached } }] };
    }
    const docs = await this.docs.find(docFilter, { name: 1 }).lean();
    if (!docs.length) return [];
    const names = new Map(docs.map((d) => [String(d._id), d.name ?? ""]));
    const scope = { workspaceId, docId: { $in: docs.map((d) => d._id) } };
    // MongoDB's text score doesn't weigh how rare a word is, so "price" (in a document's name) would beat
    // "ceramic" (in one passage). Each word is scored on its own and weighted by rarity (BM25's idf).
    const terms = [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}$]+/u).filter((t) => t.length > 1))].slice(0, 8);
    const run = async () => {
      const [total, perTerm] = await Promise.all([
        this.chunks.countDocuments(scope),
        Promise.all(terms.map((t) => this.chunks.find({ ...scope, $text: { $search: t } }, { score: { $meta: "textScore" } }).sort({ score: { $meta: "textScore" } }).limit(200).lean())),
      ]);
      const scores = new Map<string, number>();
      for (const hits of perTerm) {
        if (!hits.length) continue; // a stop word, or nowhere
        const idf = Math.log(1 + (total - hits.length + 0.5) / (hits.length + 0.5));
        for (const h of hits) {
          // Saturated like BM25 (k = 1.2): one word matched in a title can't outweigh two of the question's words matched in the text.
          const tf = (h as unknown as { score: number }).score ?? 0;
          scores.set(String(h._id), (scores.get(String(h._id)) ?? 0) + idf * ((tf * 2.2) / (tf + 1.2)));
        }
      }
      const top = [...scores.entries()].sort((x, y) => y[1] - x[1]).slice(0, Math.min(10, opts.limit ?? 4));
      const full = await this.chunks.find({ _id: { $in: top.map(([id]) => new Types.ObjectId(id)) } }, { docId: 1, heading: 1, text: 1 }).lean();
      return top.flatMap(([id, score]) => {
        const r = full.find((x) => String(x._id) === id);
        return r ? [{ ...r, score }] : [];
      });
    };
    let rows;
    try {
      rows = await run();
    } catch (err) {
      // On a fresh database the text index may still be building: build it, then ask again.
      if ((err as { code?: number }).code !== 27) throw err;
      await this.chunks.createIndexes();
      rows = await run();
    }
    return rows.map((r) => ({ docId: String(r.docId), docName: names.get(String(r.docId)) ?? "", heading: r.heading ?? "", text: r.text, score: Math.round(r.score * 100) / 100 }));
  }
}
