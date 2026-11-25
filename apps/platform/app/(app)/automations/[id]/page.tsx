import { AutomationEditor } from "@/components/automation/automation-editor";

export default function AutomationPage({ params }: { params: { id: string } }) {
  return <AutomationEditor id={params.id} />;
}
