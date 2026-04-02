"use client";

import { useEffect, useMemo, useState } from "react";
import { HarnessGitHubActionsFlowGallery } from "@/client/components/harness-github-actions-flow-gallery";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import { HarnessSectionCard, HarnessSectionStateFrame } from "@/client/components/harness-section-card";
import type {
  GitHubActionsFlow,
  GitHubActionsFlowsResponse,
} from "@/client/hooks/use-harness-settings-data";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import type { GitHubWorkflowCategory as WorkflowCategoryKey } from "@/core/github/workflow-classifier";

type FlowState = {
  error: string | null;
  flows: GitHubActionsFlow[];
  loadedContextKey: string;
};

type HarnessGitHubActionsFlowPanelProps = {
  workspaceId: string;
  codebaseId?: string;
  repoPath?: string;
  repoLabel: string;
  unsupportedMessage?: string | null;
  data?: GitHubActionsFlowsResponse | null;
  loading?: boolean;
  error?: string | null;
  variant?: "full" | "compact";
  initialCategory?: WorkflowCategoryKey;
  hideHeader?: boolean;
};

function normalizeFlows(flows: GitHubActionsFlowsResponse["flows"] | null | undefined): GitHubActionsFlow[] {
  return Array.isArray(flows)
    ? flows.map((flow) => ({
      ...flow,
      jobs: Array.isArray(flow.jobs)
        ? flow.jobs.map((job) => ({
          ...job,
          needs: Array.isArray(job.needs) ? job.needs : [],
        }))
        : [],
    }))
    : [];
}

export function HarnessGitHubActionsFlowPanel({
  workspaceId,
  codebaseId,
  repoPath,
  repoLabel: _repoLabel,
  unsupportedMessage,
  data,
  loading,
  error,
  variant = "full",
  initialCategory,
  hideHeader = false,
}: HarnessGitHubActionsFlowPanelProps) {
  const hasExternalState = loading !== undefined || error !== undefined || data !== undefined;
  const hasContext = Boolean(workspaceId && repoPath);
  const contextKey = hasContext ? `${workspaceId}:${codebaseId ?? "repo-only"}:${repoPath}` : "";

  const [flowState, setFlowState] = useState<FlowState>({
    error: null,
    flows: [],
    loadedContextKey: "",
  });

  useEffect(() => {
    if (hasExternalState || !hasContext) {
      return;
    }

    let cancelled = false;

    const timer = window.setTimeout(() => {
      if (cancelled) {
        return;
      }

      const query = new URLSearchParams();
      query.set("workspaceId", workspaceId);
      if (codebaseId) {
        query.set("codebaseId", codebaseId);
      }
      if (repoPath) {
        query.set("repoPath", repoPath);
      }

      void desktopAwareFetch(`/api/harness/github-actions?${query.toString()}`)
        .then(async (response) => {
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load GitHub Actions workflows");
          }
          if (cancelled) {
            return;
          }
          setFlowState({
            error: null,
            flows: normalizeFlows(Array.isArray(payload?.flows) ? payload.flows as GitHubActionsFlow[] : []),
            loadedContextKey: contextKey,
          });
        })
        .catch((fetchError: unknown) => {
          if (cancelled) {
            return;
          }
          setFlowState({
            error: fetchError instanceof Error ? fetchError.message : String(fetchError),
            flows: [],
            loadedContextKey: contextKey,
          });
        });
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [codebaseId, contextKey, hasContext, hasExternalState, repoPath, workspaceId]);

  const resolvedFlowState = hasExternalState
    ? {
      error: error ?? null,
      flows: normalizeFlows(data?.flows),
      loadedContextKey: contextKey,
    }
    : flowState;

  const visibleFlows = useMemo(
    () => (hasContext && resolvedFlowState.loadedContextKey === contextKey ? resolvedFlowState.flows : []),
    [contextKey, hasContext, resolvedFlowState.flows, resolvedFlowState.loadedContextKey],
  );

  const isLoading = hasExternalState
    ? Boolean(loading)
    : (hasContext && resolvedFlowState.loadedContextKey !== contextKey && !resolvedFlowState.error);

  if (isLoading) {
    return (
      <HarnessSectionCard
        title="CI/CD"
        hideHeader={hideHeader}
        variant={variant}
      >
        <HarnessSectionStateFrame>Loading GitHub Actions workflows...</HarnessSectionStateFrame>
      </HarnessSectionCard>
    );
  }

  if (unsupportedMessage) {
    return (
      <HarnessSectionCard
        title="CI/CD"
        hideHeader={hideHeader}
        variant={variant}
      >
        <HarnessUnsupportedState className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-4 text-[11px] text-amber-800" />
      </HarnessSectionCard>
    );
  }

  if (resolvedFlowState.error) {
    return (
      <HarnessSectionCard
        title="CI/CD"
        hideHeader={hideHeader}
        variant={variant}
      >
        <HarnessSectionStateFrame tone="error">{resolvedFlowState.error}</HarnessSectionStateFrame>
      </HarnessSectionCard>
    );
  }

  if (visibleFlows.length === 0) {
    return (
      <HarnessSectionCard
        title="CI/CD"
        hideHeader={hideHeader}
        variant={variant}
      >
        <HarnessSectionStateFrame>
          Select a repository to inspect workflow flows.
        </HarnessSectionStateFrame>
      </HarnessSectionCard>
    );
  }

  return (
    <HarnessSectionCard
      title="CI/CD"
      hideHeader={hideHeader}
      variant={variant}
    >
      <HarnessGitHubActionsFlowGallery
        key={initialCategory ?? "Validation"}
        flows={visibleFlows}
        variant={variant}
        initialCategory={initialCategory}
      />
    </HarnessSectionCard>
  );
}
