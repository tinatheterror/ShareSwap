#!/bin/bash
set -e
npm install
npx drizzle-kit push --config=drizzle.config.ts <<< ""
