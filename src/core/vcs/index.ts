/**
 * VCS Module Exports
 */

export type {
  VCSPlatform,
  VCSRepository,
  VCSPullRequest,
  VCSPullRequestListItem,
  VCSBranch,
  VCSComment,
  VCSFileChange,
  VCSWebhookPayload,
  VCSIssue,
  VCSIssueListItem,
  VCSAccessStatus,
  IVCSProvider,
} from "./vcs-provider";

export {
  GitHubProvider,
} from "./github-provider";

export {
  GitLabProvider,
} from "./gitlab-provider";

export {
  getVCSProvider,
  getVCSProviderForSource,
  resetVCSProvider,
  getPlatform,
  isGitLab,
  isGitHub,
} from "./vcs-provider";

export {
  getPlatformTerminology,
  getPullRequestShort,
  getPullRequestTerm,
  type PlatformTerminology,
} from "./platform-terminology";

export {
  mapGitLabRoleToPermission,
  hasPermission,
  canCreateMergeRequest,
  canMergeToProtected,
  parseAccessLevel,
  GITLAB_ROLE_LABELS,
  type GitLabAccessLevel,
  type InternalPermission,
} from "./gitlab-permission";

export {
  importVCSRepo,
  getCachedWorkspace,
  cleanupExpired,
  listActiveWorkspaces,
  workspaceKey,
  VCSWorkspaceError,
  startVCSWorkspaceCleanup,
  stopVCSWorkspaceCleanup,
} from "./vcs-workspace";

export type {
  VCSImportOptions,
  VCSWorkspace,
  VirtualFileEntry,
  VCSWorkspaceErrorCode,
} from "./vcs-workspace";
