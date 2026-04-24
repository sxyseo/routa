---
feature_metadata:
  capability_groups:
    - id: workspace-coordination
      name: Workspace Coordination
  features:
    - id: workspace-overview
      name: Workspace Overview
      group: workspace-coordination
      pages:
        - /workspace/:workspaceId/overview
---

# Product Feature Specification

## Frontend Pages

| Page | Route | Source File | Description |
|------|-------|-------------|-------------|
| Workspace / Overview | `/workspace/:workspaceId/overview` | `src/app/workspace/[workspaceId]/overview/page.tsx` |  |
| Settings / Agents | `/settings/agents` | `src/app/settings/agents/page.tsx` |  |

## API Contract Endpoints

### Agents (1)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/agents` | List agents | `src/app/api/agents/route.ts` | `crates/routa-server/src/api/agents.rs` |
