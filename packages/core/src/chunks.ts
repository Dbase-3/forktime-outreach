// Splits a knowledge document into passages an agent can search during a call:
// about 1,200 characters each, cut at headings and paragraphs (a long paragraph
// at sentences), each carrying the heading it sits under. Neighbouring passages
// overlap by one sentence so an answer that spans a cut is still found.

export interface Chunk {
  index: number;
  heading: string;
  text: string;
}

const TARGET = 1200;
const MAX = 1800;

// A sentence ends at . ! or ? followed by a space or a line break, so "9.30" and "e.g.x" don't split.
const sentencesOf = (p: string) => p.split(/(?<=[.!?]["')\]]*)\s+|\n/).map((s) => s.trim()).filter(Boolean);

export function chunkText(text: string, opts: { target?: number; max?: number } = {}): Chunk[] {
  const target = opts.target ?? TARGET;
  const max = opts.max ?? MAX;
  const chunks: Chunk[] = [];
  let heading = "";
  let parts: string[] = [];
  let size = 0;
  const flush = () => {
    const body = parts.join("\n\n").trim();
    if (body) chunks.push({ index: chunks.length, heading, text: body });
    const last = parts.length ? sentencesOf(parts[parts.length - 1]).pop() ?? "" : "";
    parts = last && last.length < 300 ? [last] : []; // one sentence of overlap
    size = parts.join("").length;
  };
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  for (const block of blocks) {
    const h = block.match(/^#{1,6}\s+(.+)$/m);
    if (h && block.split("\n").length <= 2 && block.length < 200) {
      // A new section: close the last one (without carrying its overlap across the heading).
      if (size) flush();
      parts = [];
      size = 0;
      heading = h[1].trim();
      const rest = block.split("\n").slice(1).join("\n").trim();
      if (rest) {
        parts.push(rest);
        size += rest.length;
      }
      continue;
    }
    const pieces = block.length > max ? sentencesOf(block) : [block];
    for (const piece of pieces) {
      if (size && size + piece.length > target) flush();
      parts.push(piece.length > max ? piece.slice(0, max) : piece);
      size += piece.length;
    }
  }
  if (size && parts.some((p) => p.length)) {
    const body = parts.join("\n\n").trim();
    if (body && body !== chunks[chunks.length - 1]?.text.split("\n\n").pop()) chunks.push({ index: chunks.length, heading, text: body });
  }
  return chunks;
}
