import { DncCard } from "@/components/dnc-card";
import { SettingsForm } from "@/components/settings-form";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <SettingsForm />
      <DncCard />
    </div>
  );
}
