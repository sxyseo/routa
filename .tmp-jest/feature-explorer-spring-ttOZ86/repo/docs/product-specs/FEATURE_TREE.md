---
feature_metadata:
  capability_groups:
    - id: administration
      name: Administration
  features:
    - id: admin-dashboard
      name: Admin Dashboard
      group: administration
      pages:
        - /admin/dashboard
      apis:
        - GET /admin/dashboard
---

# Product Feature Specification

## Frontend Pages

| Page | Route | Source File | Description |
|------|-------|-------------|-------------|
| Admin Dashboard | `/admin/dashboard` | `src/main/resources/templates/dashboard.html` |  |

## API Contract Endpoints

### Admin (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/admin/dashboard` | Render Dashboard |

## Spring MVC API Routes

### Admin (1)

| Method | Endpoint | Source Files |
|--------|----------|--------------|
| GET | `/admin/dashboard` | `src/main/java/com/example/controller/AdminController.java` |
