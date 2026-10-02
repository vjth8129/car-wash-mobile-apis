# Car Wash Management API

A production-ready, multi-tenant **Car Wash Management System** backend: multiple
car washes ("tenants"), owners/managers/staff, database-driven RBAC, a fully
dynamic mobile-app menu/config API, services, customers, vehicles, bookings,
and an order/job workflow.

The mobile/web client is intentionally "dumb" - it never hardcodes menus,
roles, permissions, or tenant configuration. Everything comes from the API.

## 1. Overview

```
Platform
│
├── Car Wash A ── Owner, Manager, Staff, App Users
├── Car Wash B ── Owner, Staff
└── Car Wash C ── Owner
```

A user belongs to exactly one car wash (except the platform `SUPER_ADMIN`, who
belongs to none and manages the platform itself). Every tenant-owned query is
scoped server-side by `carWashId` derived from the authenticated user - never
from client input. See [docs/multi-tenancy.md](docs/multi-tenancy.md) for the
full explanation and the tests that enforce it.

## 2. Architecture

```
Route → Middleware (auth/validate) → Controller → Service → Repository → PostgreSQL
```

See [docs/architecture.md](docs/architecture.md) for the full layering
rationale and folder structure.

## 3. Technology stack

Node.js · TypeScript · Express · PostgreSQL · Drizzle ORM · JWT · argon2 · Zod ·
Swagger/OpenAPI (`swagger-jsdoc` + `swagger-ui-express`) · Pino (`pino-http`) ·
Docker/Docker Compose · ESLint · Prettier · Jest + Supertest.

## 4. Folder structure

```
src/
  config/        env, logger, swagger spec
  constants/     permission keys, system roles
  controllers/   req/res only
  db/            drizzle schema, migrations, client, seed
  middlewares/   authenticate, authorize, validate, rate-limit, error handler
  repositories/  Drizzle queries (tenant-scoped)
  routes/        Express routers + OpenAPI annotations
  services/      business logic, tenant scoping, transactions
  types/         Express Request augmentation
  utils/         password, jwt, tokens, pagination, response helpers
  validators/    Zod schemas
  app.ts server.ts
tests/
  auth/ rbac/ tenant-isolation/ services/ users/ bookings/ helpers/
docs/
  architecture.md authentication.md authorization.md multi-tenancy.md api.md database.md
```

## 5. Environment setup

```bash
cp .env.example .env
```

Key variables (full list in `.env.example`):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `JWT_RESET_SECRET` | signing secrets - **generate real random values in production** (`openssl rand -hex 64`) |
| `ACCESS_TOKEN_EXPIRES_IN` / `REFRESH_TOKEN_EXPIRES_IN` / `RESET_TOKEN_EXPIRES_IN` | token lifetimes |
| `CORS_ORIGIN` | comma-separated allowed origins, or `*` |
| `MAIL_PROVIDER` | `console` (dev, logs the reset link) or `smtp` (production) |

Never commit `.env`.

## 6. Docker setup

```bash
docker compose up -d postgres   # PostgreSQL only, for running the API on the host
# or
docker compose up               # PostgreSQL + API (hot-reloading) + pgAdmin
```

Services: `postgres` (5432 in-container → mapped host port, see
`docker-compose.yml`), `api` (hot reload via `tsx watch`), `pgadmin` (optional,
web UI for the database).

> The exact host ports in `docker-compose.yml` were chosen to avoid colliding
> with other local services; check that file for the current mapping before
> connecting a GUI client.

## 7. PostgreSQL setup (without Docker)

Point `DATABASE_URL` at any PostgreSQL 14+ instance you control - no
Docker-specific behavior is required.

## 8. Migrations

```bash
npm run db:generate   # generate a new migration from schema changes
npm run db:migrate    # apply all pending migrations to DATABASE_URL
```

A fresh database only needs `npm run db:migrate` - migration `.sql` files are
committed under `src/db/migrations/`.

## 9. Seed data

```bash
npm run db:seed
```

Idempotent - safe to run repeatedly (uses `onConflictDoNothing`/find-or-create,
never duplicates roles, permissions, menus, car washes, users, or services).

Seeds:

- Platform super admin: **`9000000100` / `SuperAdmin@123`** (username `superadmin`)
- Car wash **Sparkle Car Wash** (`SPARKLE001`, ACTIVE, INR, Asia/Kolkata)
- **`9000000101` / `Owner@123`**, **`9000000102` / `Manager@123`**,
  **`9000000103` / `Staff@123`** (usernames `owner`, `manager`, `staff`; all under
  Sparkle Car Wash). Users sign in with their mobile number; the username still
  works for older accounts.
- All permissions from spec section 6, system roles (`SUPER_ADMIN`, `OWNER`,
  `MANAGER`, `STAFF`, `CUSTOMER`) with their role-permission mappings
- The dynamic menu tree (Dashboard, Operations > Bookings/Orders/Customers/Vehicles,
  Management > Users/Roles/Services/Car Washes, Reports)
- 4 sample services, 2 sample customers with vehicles, 1 sample booking + order

> ⚠️ **These are development-only credentials.** Rotate/remove them before any
> production deployment.

## 10. Running locally

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev            # tsx watch, http://localhost:5000
```

## 11. Testing

```bash
npm test
```

Tests run against a **separate** database (`.env.test` → `carwash_test`, same
Postgres instance) so they never touch your development data. A Jest
`globalSetup` runs migrations and a dedicated two-tenant seed
(`tests/helpers/reset-and-seed.ts`) once before the suite.

Coverage (41 tests): login success/failure, `/auth/me`, refresh rotation +
reuse rejection, logout revocation, forgot/reset password (including one-time
use and expired-token rejection), permission-granted/denied, role-based access,
unauthenticated access, dynamic menu reflecting resolved permissions, services
CRUD + validation + duplicate rejection + pagination, users CRUD + role
assignment + delegation limits, bookings create/update/cancel + conflict
detection + invalid-relation rejection + status-transition rejection, and a
dedicated **tenant-isolation** suite proving Car Wash A's owner can never read,
list, or write Car Wash B's services, customers, users, bookings, or the car
wash record itself - even when a `carWashId` is injected into the request body.

## 12. Swagger documentation

Once the server is running:

- Swagger UI: `http://localhost:5000/api/docs`
- Raw OpenAPI 3.0 spec: `http://localhost:5000/api/docs.json`

Every route file carries `@openapi` JSDoc annotations; tags mirror spec
section 30 (Authentication, Users, Roles, Permissions, Car Washes, Services,
Customers, Vehicles, Bookings, Orders, App, Reports, Health). Bearer JWT auth
is documented via the `bearerAuth` security scheme.

## 13. Authentication flow

See [docs/authentication.md](docs/authentication.md): login → short-lived JWT
access token + opaque, hashed, rotating refresh token; forgot/reset password
with hashed one-time tokens and no user enumeration.

## 14. RBAC explanation

See [docs/authorization.md](docs/authorization.md): permissions and roles are
database rows, not hardcoded strings; `authenticate` re-resolves permissions
from the DB on every request; permission delegation prevents an owner from
granting permissions they don't hold.

## 15. Multi-tenant architecture

See [docs/multi-tenancy.md](docs/multi-tenancy.md).

## 16. API examples

```bash
# Login
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"phone":"9000000101","password":"Owner@123"}'

# Onboard another car wash with its first owner (platform admin only).
# The owner signs in with their mobile number and must change the password.
curl -X POST http://localhost:5000/api/v1/car-washes \
  -H "Authorization: Bearer $SUPERADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Aqua Shine","code":"AQUA001","owner":{"name":"Aqua Owner","phone":"9000000201","username":"aqua_owner","password":"Welcome@123"}}'

# Session bootstrap
curl http://localhost:5000/api/v1/auth/me   -H "Authorization: Bearer $TOKEN"
curl http://localhost:5000/api/v1/app/menu  -H "Authorization: Bearer $TOKEN"
curl http://localhost:5000/api/v1/app/config -H "Authorization: Bearer $TOKEN"

# Create a booking
curl -X POST http://localhost:5000/api/v1/bookings \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"customerId":"...","vehicleId":"...","serviceId":"...","bookingDate":"2026-12-01","startTime":"10:00"}'
```

Full request/response schemas: `/api/docs`. More narrative examples:
[docs/api.md](docs/api.md).

## 17. Development credentials

See section 9 above. Development only - do not reuse in production.

## 18. Production deployment notes

- Set real, random `JWT_*_SECRET` values (`openssl rand -hex 64`) and a real
  `MAIL_PROVIDER=smtp` integration (wire `nodemailer` or your provider's SDK
  into `src/utils/mailer.ts`'s `SmtpMailProvider`).
- Set `NODE_ENV=production` - this disables verbose CSP relaxation in Helmet
  and stack traces in error responses.
- `CORS_ORIGIN` should be an explicit comma-separated allow-list, never `*`.
- Run `npm run build && npm start` (compiled output in `dist/`), or use the
  multi-stage `Dockerfile` (build stage + slim `node:20-alpine` runtime stage).
- Run `npm run db:migrate` as a release step before starting new instances;
  never run `db:seed` against production (or only run it once, deliberately,
  to bootstrap the very first `SUPER_ADMIN` - then rotate that password
  immediately).
- Point `/health/live` and `/health/ready` at your orchestrator's
  liveness/readiness probes.
- Consider adding a reverse proxy / API gateway for TLS termination; the app
  already sets `trust proxy` for correct `req.ip` behind one.

## Project scripts

```bash
npm run dev          # tsx watch dev server
npm run build        # tsc -> dist/
npm run start        # run compiled dist/server.js
npm run lint          npm run lint:fix
npm run format        npm run format:check
npm run test           npm run test:watch
npm run db:generate   npm run db:migrate   npm run db:push   npm run db:seed
```

## Acceptance criteria checklist

- [x] Login, JWT, refresh rotation, logout, forgot/reset password
- [x] Roles, permissions, role-permission mapping, and API authorization all DB-driven
- [x] Multiple car washes, tenant-scoped users/data, cross-tenant access rejected (see tenant-isolation tests)
- [x] `GET /api/v1/app/menu` returns menus per resolved permissions
- [x] Owner manages users/roles/services/customers/vehicles/bookings (subject to permissions)
- [x] Super admin manages car washes/owners/platform configuration
- [x] Per-car-wash service catalog
- [x] Customers, vehicles, bookings, and the check-in → order/job workflow
- [x] `docker compose up` + migrate + seed brings up a working stack
- [x] Swagger at `/api/docs`
- [x] Automated tests covering authentication, RBAC, CRUD, and tenant isolation
