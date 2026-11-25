import { AgentEditor } from "@/components/agent/agent-editor";

export default function AgentPage({ params }: { params: { id: string } }) {
  return <AgentEditor id={params.id} />;
}
