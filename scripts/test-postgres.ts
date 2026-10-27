import "./env.js";
import { spawnSync } from "node:child_process";
if (!process.env.TEST_DATABASE_URL || !process.env.TEST_RESTORE_DATABASE_URL)
  throw new Error(
    "TEST_DATABASE_URL and TEST_RESTORE_DATABASE_URL are required. Use two isolated, empty PostgreSQL databases; never real operational data.",
  );
const source = new URL(process.env.TEST_DATABASE_URL!);
const target = new URL(process.env.TEST_RESTORE_DATABASE_URL!);
if (source.host === target.host && source.pathname === target.pathname)
  throw new Error("Test and restore databases must be different");
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", "tests/workflows.test.ts"],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
