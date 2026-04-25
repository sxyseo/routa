import type { Metadata } from "next";
import { SystemJobsPageClient } from "./page-client";

export const metadata: Metadata = {
  title: "System Jobs",
  description: "Monitor system background tasks health and execution history",
};

export default function SystemJobsPage() {
  return <SystemJobsPageClient />;
}
