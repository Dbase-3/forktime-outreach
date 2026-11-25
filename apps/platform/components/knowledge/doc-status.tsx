import { FileText, Globe, Map, Network, Type } from "lucide-react";
import type { KnowledgeDoc } from "@/lib/types";
import { Badge } from "../ui";

export function DocStatus({ doc }: { doc: KnowledgeDoc }) {
  if (doc.status === "ready") return <Badge tone="green" dot>Ready</Badge>;
  if (doc.status === "reading") return <Badge tone="blue" dot>Reading…</Badge>;
  if (doc.status === "waiting") return <Badge tone="gray" dot>Waiting to be read</Badge>;
  return <Badge tone="red" dot>Couldn&rsquo;t read</Badge>;
}

export function DocIcon({ doc, size = 15 }: { doc: Pick<KnowledgeDoc, "kind">; size?: number }) {
  const Icon = { url: Globe, sitemap: Map, site: Network, file: FileText, text: Type }[doc.kind];
  return <Icon size={size} className="shrink-0 text-fg-3" />;
}
