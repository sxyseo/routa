/**
 * Platform Terminology Mapper
 *
 * Provides platform-aware terminology for UI rendering.
 * GitHub uses "Pull Request", GitLab uses "Merge Request".
 * This module centralizes the mapping so UI components don't
 * need to hardcode platform-specific terms.
 */

import { getPlatform, type VCSPlatform } from "./vcs-provider";

/** Terminology key-value pairs that differ between platforms */
export interface PlatformTerminology {
  /** The term for PR/MR (e.g., "Pull Request" or "Merge Request") */
  pullRequestTerm: string;
  /** Short form (e.g., "PR" or "MR") */
  pullRequestShort: string;
  /** Verb form (e.g., "Create Pull Request" or "Create Merge Request") */
  createPullRequest: string;
  /** Specialist label */
  pullRequestSpecialist: string;
  /** Auto-merge label */
  autoMergeAfterPR: string;
  /** Auto-create label */
  autoCreatePullRequest: string;
  /** Tab label for import */
  pullsTab: string;
  /** Loading pulls/MRs */
  loadingPulls: string;
  /** Import pulls/MRs failed */
  importPullsFailed: string;
  /** No pulls/MRs available */
  noPulls: string;
  /** Pulls/MRs loaded count */
  pullsLoaded: string;
}

const GITHUB_TERMINOLOGY: PlatformTerminology = {
  pullRequestTerm: "Pull Request",
  pullRequestShort: "PR",
  createPullRequest: "Create Pull Request",
  pullRequestSpecialist: "PR specialist",
  autoMergeAfterPR: "Auto-merge after PR",
  autoCreatePullRequest: "Auto-create PR on done",
  pullsTab: "Pull Requests",
  loadingPulls: "Loading GitHub pull requests…",
  importPullsFailed: "Failed to import GitHub pull requests.",
  noPulls: "No pull requests available to import.",
  pullsLoaded: "pull requests loaded",
};

const GITLAB_TERMINOLOGY: PlatformTerminology = {
  pullRequestTerm: "Merge Request",
  pullRequestShort: "MR",
  createPullRequest: "Create Merge Request",
  pullRequestSpecialist: "MR specialist",
  autoMergeAfterPR: "Auto-merge after MR",
  autoCreatePullRequest: "Auto-create MR on done",
  pullsTab: "Merge Requests",
  loadingPulls: "Loading GitLab merge requests…",
  importPullsFailed: "Failed to import GitLab merge requests.",
  noPulls: "No merge requests available to import.",
  pullsLoaded: "merge requests loaded",
};

/**
 * Get the terminology set for the given platform.
 * Defaults to GitHub terminology if no platform is specified.
 */
export function getPlatformTerminology(platform?: VCSPlatform): PlatformTerminology {
  const p = platform ?? getPlatform();
  return p === "gitlab" ? GITLAB_TERMINOLOGY : GITHUB_TERMINOLOGY;
}

/**
 * Get the short form for the current platform's PR/MR term.
 * Useful for inline badges and compact UI elements.
 */
export function getPullRequestShort(platform?: VCSPlatform): string {
  return getPlatformTerminology(platform).pullRequestShort;
}

/**
 * Get the full form for the current platform's PR/MR term.
 */
export function getPullRequestTerm(platform?: VCSPlatform): string {
  return getPlatformTerminology(platform).pullRequestTerm;
}
