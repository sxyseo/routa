/**
 * Workspace / Archive History - /workspace/:workspaceId/archive
 * Independent archive history view for browsing completed and archived tasks.
 */
import { ArchivePageClient } from "./archive-page-client";

export async function generateStaticParams() {
  if (process.env.ROUTA_BUILD_STATIC === "1") {
    return [{ workspaceId: "__placeholder__" }];
  }
  return [];
}

export default function WorkspaceArchivePage() {
  return <ArchivePageClient />;
}
