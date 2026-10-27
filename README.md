# Buildflow Project API

Private source workspace containing 25 Next.js project API route handlers and the typed project API client. It is intended to make the project endpoint surface easy to inspect and work on.

## Contents

- `apps/web/src/app/api/projects/` — project collection, import, project detail, files, memory, settings, providers/integrations, GitHub sync, deploys, audit, cost, capabilities, merge and undo routes
- `packages/api-client/src/projects.ts` — typed client functions for the project endpoints

## Production relationship

The live app currently serves these handlers from the private [`Buildflow`](https://github.com/Nexus-Office-room/Buildflow) monorepo. This repository is a private focused source copy, not a separately running API service; changes here do not automatically alter the production backend. Route handlers depend on shared app authentication, Supabase, encryption/secrets, audit, deployment, GitHub, and pipeline modules that remain in the main monorepo.

The endpoint implementation is Next.js App Router code. The route tree is preserved so each URL and handler is easy to locate. Keep credentials and environment files out of this repository.
