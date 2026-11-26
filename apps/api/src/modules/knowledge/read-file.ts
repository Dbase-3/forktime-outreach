// Turns an uploaded file into text for the knowledge library: PDF (pdf-parse,
// text layer only: a scan has none), Word .docx (mammoth), and plain text
// kinds as they are (web pages and XML keep only their words).

import { htmlToText } from "@outreach/core/knowledge";

export class FileProblem extends Error {}

export const UPLOADABLE = /\.(pdf|docx|txt|md|markdown|csv|json|html?|xml)$/i;
const MAX_TEXT = 400_000;

export async function readFileText(name: string, data: Buffer): Promise<{ text: string; pages: number }> {
  if (/\.doc$/i.test(name)) throw new FileProblem("Old Word files (.doc) can't be read. Save it as .docx or PDF and add it again.");
  if (!UPLOADABLE.test(name)) throw new FileProblem("That kind of file can't be read. Use PDF, Word (.docx) or a text file.");
  let text: string;
  let pages = 1;
  if (/\.pdf$/i.test(name)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFParse } = require("pdf-parse") as typeof import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(data) });
    try {
      const out = await parser.getText();
      text = out.text;
      pages = out.total;
    } catch {
      throw new FileProblem("That PDF couldn't be opened. It may be damaged or have a password.");
    } finally {
      await parser.destroy().catch(() => undefined);
    }
    text = text.replace(/\n-- \d+ of \d+ --\n/g, "\n");
  } else if (/\.docx$/i.test(name)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mammoth = require("mammoth") as typeof import("mammoth");
    try {
      text = (await mammoth.extractRawText({ buffer: data })).value;
    } catch {
      throw new FileProblem("That Word file couldn't be opened. It may be damaged.");
    }
  } else {
    text = data.toString("utf8");
    if (/\.(html?|xml)$/i.test(name)) text = htmlToText(text).text;
  }
  text = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new FileProblem(/\.pdf$/i.test(name) ? "This PDF has no text in it (it may be a scan). Paste the text instead." : "That file has no readable text.");
  return { text: text.slice(0, MAX_TEXT), pages };
}
