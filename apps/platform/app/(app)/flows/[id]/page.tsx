import { FlowEditor } from "@/components/flow/flow-editor";

export default function FlowPage({ params }: { params: { id: string } }) {
  return <FlowEditor id={params.id} />;
}
