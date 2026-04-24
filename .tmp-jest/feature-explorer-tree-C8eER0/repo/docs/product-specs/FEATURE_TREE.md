---
feature_metadata:
  capability_groups:
    - id: workspace-coordination
      name: Workspace Coordination
  features:
    - id: feature-explorer
      name: Feature Explorer
      group: workspace-coordination
      pages:
        - /workspace/:workspaceId/feature-explorer
      apis:
        - GET /api/feature-explorer
---

# Product Feature Specification

## Frontend Pages

| Page | Route | Source File | Description |
|------|-------|-------------|-------------|
| Workspace / Feature Explorer | `/workspace/:workspaceId/feature-explorer` | `src/app/workspace/[workspaceId]/feature-explorer/page.tsx` |  |

## API Contract Endpoints

### Feature-Explorer (1)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/feature-explorer` | List feature explorer features | `src/app/api/feature-explorer/route.ts` | `crates/routa-server/src/api/feature_explorer.rs` |
