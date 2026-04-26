/**
 * GitLab Permission Mapper
 *
 * Maps GitLab project-level roles to internal permission levels.
 * GitLab roles: Guest(10), Reporter(20), Developer(30), Maintainer(40), Owner(50)
 * Reference: https://docs.gitlab.com/ee/user/permissions.html
 *
 * Internal permission levels:
 * - "none": no access
 * - "read": can view repos, issues, MRs
 * - "write": can create branches, push, create MRs
 * - "admin": can manage project settings, merge to protected branches
 * - "owner": full control including members, visibility, deletion
 */

/** GitLab access level numbers returned by the API */
export type GitLabAccessLevel = 0 | 10 | 20 | 30 | 40 | 50;

/** Internal permission levels used by the system */
export type InternalPermission = "none" | "read" | "write" | "admin" | "owner";

/** Human-readable GitLab role names */
export const GITLAB_ROLE_LABELS: Record<GitLabAccessLevel, string> = {
  0: "No access",
  10: "Guest",
  20: "Reporter",
  30: "Developer",
  40: "Maintainer",
  50: "Owner",
};

/**
 * Mapping from GitLab access level to internal permission.
 *
 * - Guest (10): Read-only access to public projects
 * - Reporter (20): Can create issues, leave comments
 * - Developer (30): Can push to non-protected branches, create MRs
 * - Maintainer (40): Can push to protected branches, manage project settings
 * - Owner (50): Full control
 */
const ACCESS_LEVEL_TO_PERMISSION: Record<GitLabAccessLevel, InternalPermission> = {
  0: "none",
  10: "read",
  20: "read",
  30: "write",
  40: "admin",
  50: "owner",
};

/**
 * Map a GitLab access level to an internal permission level.
 */
export function mapGitLabRoleToPermission(accessLevel: GitLabAccessLevel): InternalPermission {
  return ACCESS_LEVEL_TO_PERMISSION[accessLevel] ?? "none";
}

/**
 * Check if the given permission satisfies the required minimum level.
 * Permission hierarchy: none < read < write < admin < owner
 */
export function hasPermission(current: InternalPermission, required: InternalPermission): boolean {
  const hierarchy: InternalPermission[] = ["none", "read", "write", "admin", "owner"];
  return hierarchy.indexOf(current) >= hierarchy.indexOf(required);
}

/**
 * Check if a user can create merge requests.
 * Developer (30) and above can create MRs.
 */
export function canCreateMergeRequest(accessLevel: GitLabAccessLevel): boolean {
  return hasPermission(mapGitLabRoleToPermission(accessLevel), "write");
}

/**
 * Check if a user can merge merge requests (to protected branches).
 * Maintainer (40) and above can merge to protected branches.
 */
export function canMergeToProtected(accessLevel: GitLabAccessLevel): boolean {
  return hasPermission(mapGitLabRoleToPermission(accessLevel), "admin");
}

/**
 * Parse a GitLab API response for project membership.
 * Returns the access level number, defaulting to 0 (no access).
 */
export function parseAccessLevel(response: { access_level?: number } | undefined | null): GitLabAccessLevel {
  if (!response?.access_level) return 0;
  // Clamp to valid range
  const level = Math.min(50, Math.max(0, response.access_level));
  return level as GitLabAccessLevel;
}
