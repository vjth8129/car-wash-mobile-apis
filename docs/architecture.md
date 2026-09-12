# Architecture

## Layered request flow

Every request flows through the same layers. Business logic never lives in route
handlers, and repositories never contain business rules - they only run queries.

```
Route  →  Middleware  →  Controller  →  Service  →  Repository  →  Database
```

```mermaid
flowchart LR
    A[Route] --> B[authenticate]
    B --> C[requirePermission / requireRole]
    C --> D[validate (Zod)]
    D --> E[Controller]
    E --> F[Service - business rules, tenant scoping]
    F --> G[Repository - Drizzle queries]
    G --> H[(PostgreSQL)]
```

- **Routes** (`src/routes/*.routes.ts`) wire an HTTP verb + path to middleware and a
  controller function. They also carry the OpenAPI JSDoc annotations consumed by
  `swagger-jsdoc`.
- **Middleware** (`src/middlewares/*`) handles authentication, authorization,
  request validation, rate limiting, and error translation. See
  [authorization.md](./authorization.md).
- **Controllers** (`src/controllers/*.controller.ts`) only translate between
  `req`/`res` and the service layer - parsing params/query, calling a service
  function, and shaping the response with `sendSuccess`/`sendList`.
- **Services** (`src/services/*.service.ts`) contain the actual business rules:
  tenant scoping, permission-delegation checks, status-transition validation,
  cross-entity validation (e.g. a booking's vehicle must belong to its customer),
  and audit logging. Multi-step writes are wrapped in `db.transaction(...)`.
- **Repositories** (`src/repositories/*.repository.ts`) are the only files that
  import Drizzle query builders directly. They take already-validated,
  already-scoped parameters and return rows.

## Folder structure

```
src/
  config/        env loading, logger, swagger spec
  constants/     permission keys, system role definitions
  controllers/   thin req/res adapters
  db/            drizzle client, schema, migrations, seed
  middlewares/   auth, authorization, validation, rate limiting, error handling
  repositories/  Drizzle queries, one file per aggregate
  routes/        Express routers + OpenAPI annotations
  services/      business logic
  types/         Express Request augmentation (req.user)
  utils/         password hashing, JWT, tokens, pagination, response helpers
  validators/    Zod schemas, one file per module
  app.ts         Express app wiring (no listen())
  server.ts      process entrypoint (listen + graceful shutdown)
tests/
  auth/ rbac/ tenant-isolation/ services/ users/ bookings/
  helpers/       supertest app helpers, DB reset/seed for tests
```

## Why this split

A bug fix or a new endpoint should only ever touch 2-3 files (route, service,
maybe a validator) - not require threading a change through a monolithic
controller. Repositories are intentionally "dumb": every access-control decision
(tenant scoping, permission delegation, status transitions) lives in the service
layer so it's auditable in one place per module.
