import { CheckInClient } from "./check-in-client";

export default async function CheckInPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return <CheckInClient workspaceId={workspaceId} />;
}