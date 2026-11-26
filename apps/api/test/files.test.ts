// Knowledge files: PDF and Word read on the server by a job, the file deleted after.

import type { INestApplication } from "@nestjs/common";
import { startApp, withWorkspace } from "./helpers";

let app: INestApplication;
let stop: () => Promise<void>;
beforeAll(async () => ({ app, stop } = await startApp()));
afterAll(() => stop());

/** A one-page PDF with real text (offsets computed, so it's a valid file). */
function pdfWith(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** A minimal .docx (built with jszip, which mammoth itself uses). */
async function docxWith(text: string): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const JSZip = require(require.resolve("jszip", { paths: [require.resolve("mammoth")] }));
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("knowledge files", () => {
  it("reads a PDF and a Word file into text, attached to an agent, and keeps no copy of the file", async () => {
    const { agent, ws } = await withWorkspace(app, "files@example.com", { sample: true });
    const agentId = (await agent.get(`${ws}/agents`)).body[0].id;

    const pdf = (await agent.post(`${ws}/knowledge/upload`).field("availableToAll", "false").field("attachTo", agentId).attach("file", pdfWith("Service hours are 7am to 6pm on weekdays."), "Service hours.pdf").expect(201)).body;
    const pdfDoc = (await agent.get(`${ws}/knowledge/${pdf.id}`)).body;
    expect(pdfDoc).toMatchObject({ status: "ready", name: "Service hours.pdf", pages: 1 });
    expect(pdfDoc.content).toContain("Service hours are 7am to 6pm on weekdays.");
    expect((await agent.get(`${ws}/agents/${agentId}`)).body.knowledgeIds).toContain(pdf.id);

    const word = (await agent.post(`${ws}/knowledge/upload`).attach("file", await docxWith("Loan cars must be booked a day ahead."), "Loan cars.docx").expect(201)).body;
    expect((await agent.get(`${ws}/knowledge/${word.id}`)).body).toMatchObject({ status: "ready", content: "Loan cars must be booked a day ahead.", availableToAll: false });

    // Nothing left waiting: the files are deleted once read.
    const uploads = app.get("UploadModel", { strict: false });
    expect(await uploads.countDocuments({})).toBe(0);
  });

  it("says plainly what it can't read", async () => {
    const { agent, ws } = await withWorkspace(app, "files2@example.com");
    const old = await agent.post(`${ws}/knowledge/upload`).attach("file", Buffer.from("x"), "Old.doc").expect(422);
    expect(old.body.error.message).toContain(".docx or PDF");
    await agent.post(`${ws}/knowledge/upload`).attach("file", Buffer.from("x"), "photo.png").expect(422);
    const broken = (await agent.post(`${ws}/knowledge/upload`).attach("file", Buffer.from("not really a pdf"), "broken.pdf").expect(201)).body;
    const doc = (await agent.get(`${ws}/knowledge/${broken.id}`)).body;
    expect(doc.status).toBe("failed");
    expect(doc.error).toMatch(/couldn't be opened/);
    const scan = (await agent.post(`${ws}/knowledge/upload`).attach("file", pdfWith(""), "scan.pdf").expect(201)).body;
    expect((await agent.get(`${ws}/knowledge/${scan.id}`)).body.error).toMatch(/no text in it/);
    const big = await agent.post(`${ws}/knowledge/upload`).attach("file", Buffer.alloc(16 * 1024 * 1024, 32), "big.txt");
    expect(big.status).toBe(413);
    expect(big.body.error.message).toContain("15 MB");
  });
});

describe("knowledge search", () => {
  it("finds the passage that answers a question, only from documents the agent can use", async () => {
    const { agent, ws } = await withWorkspace(app, "search@example.com", { sample: true });
    const hits = (await agent.post(`${ws}/knowledge/search`).send({ query: "when is the service centre open on weekdays?" }).expect(201)).body;
    expect(hits[0].docName).toBe("Opening hours & location");
    expect(hits[0].text).toContain("7:30am to 5pm");

    // A new document is searchable at once; an edit replaces its passages; a deleted one is gone.
    const doc = (await agent.post(`${ws}/knowledge`).send({ kind: "text", name: "Detailing", content: "Ceramic coating costs $890 and takes two days.", availableToAll: true }).expect(201)).body;
    expect((await agent.post(`${ws}/knowledge/search`).send({ query: "ceramic coating price" })).body[0].docId).toBe(doc.id);
    const full = (await agent.get(`${ws}/knowledge/${doc.id}`)).body;
    await agent.patch(`${ws}/knowledge/${doc.id}`).send({ version: full.version, content: "Window tinting costs $350." }).expect(200);
    expect((await agent.post(`${ws}/knowledge/search`).send({ query: "ceramic coating" })).body.some((h: { docId: string }) => h.docId === doc.id)).toBe(false);
    expect((await agent.post(`${ws}/knowledge/search`).send({ query: "tinting" })).body[0].docId).toBe(doc.id);
    await agent.delete(`${ws}/knowledge/${doc.id}`).expect(200);
    expect((await agent.post(`${ws}/knowledge/search`).send({ query: "tinting" })).body).toEqual([]);

    // An agent finds shared documents and its own attached ones, nothing else.
    const agents = (await agent.get(`${ws}/agents`)).body as { id: string; knowledgeIds: string[] }[];
    const list = (await agent.get(`${ws}/knowledge`)).body as { id: string; name: string; availableToAll: boolean }[];
    const priv = list.find((k) => k.name === "Service menu & prices")!;
    expect(priv.availableToAll).toBe(false);
    const withIt = agents.find((a) => a.knowledgeIds.includes(priv.id));
    const without = agents.find((a) => !a.knowledgeIds.includes(priv.id));
    const ask = (agentId?: string) => agent.post(`${ws}/knowledge/search`).send({ query: "major service price", agentId }).then((r) => r.body as { docId: string }[]);
    if (withIt) expect((await ask(withIt.id)).some((h) => h.docId === priv.id)).toBe(true);
    if (without) expect((await ask(without.id)).some((h) => h.docId === priv.id)).toBe(false);
    expect((await ask()).some((h) => h.docId === priv.id)).toBe(true); // the library page searches everything

    // Other workspaces never see these passages.
    const other = await withWorkspace(app, "search-other@example.com");
    expect((await other.agent.post(`${other.ws}/knowledge/search`).send({ query: "service centre open" })).body).toEqual([]);
  });
});
