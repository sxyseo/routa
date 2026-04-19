import { redirect } from "next/navigation";
import { getRoutaSystem } from "@/core/routa-system";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const system = getRoutaSystem();
  const workspaces = await system.workspaceStore.listByStatus("active");

  if (workspaces.length > 0) {
    redirect(`/workspace/${workspaces[0].id}/kanban`);
  }

  redirect("/settings");
}
