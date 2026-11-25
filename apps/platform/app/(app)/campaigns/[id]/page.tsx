import { CampaignEditor } from "@/components/campaign/campaign-editor";

export default function CampaignPage({ params }: { params: { id: string } }) {
  return <CampaignEditor id={params.id} />;
}
