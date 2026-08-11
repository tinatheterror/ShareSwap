#!/bin/bash
set -e
export CI=true
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push-force
