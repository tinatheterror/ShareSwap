import { defineConfig } from "drizzle-kit";
import path from "path";
import * as schema from "./src/schema";
import { managedTableNames } from "./src/managed-tables";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Only the tables the schema declares. Tables the app creates at runtime are not in the schema, and
  // push (with or without --force) would otherwise drop them. See src/managed-tables.ts.
  tablesFilter: managedTableNames(schema),
});
