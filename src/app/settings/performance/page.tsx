import { Suspense } from "react";
import { PerformanceDashboard } from "./performance-page-client";

export default function PerformanceSettingsPage() {
  return (
    <Suspense fallback={null}>
      <PerformanceDashboard />
    </Suspense>
  );
}
