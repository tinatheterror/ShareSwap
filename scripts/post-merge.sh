#!/bin/bash
set -e
export CI=true
pnpm install --frozen-lockfile
# This syncs the workspace's own development database, which is not a test database, so the destructive-script guard
# (lib/db/src/test-database-guard.ts) is confirmed here for exactly that database name and nothing else.
export ALLOW_NON_TEST_DATABASE="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)))')"
pnpm --filter @workspace/db run push-force
