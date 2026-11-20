import { TopBar } from "@/components/top-bar";
import { WorkspaceProvider } from "@/components/workspace-provider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <div className="min-h-screen">
        <TopBar />
        <main className="mx-auto max-w-[1500px] px-4 py-5">{children}</main>
      </div>
    </WorkspaceProvider>
  );
}
