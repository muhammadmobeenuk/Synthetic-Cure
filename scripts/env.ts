import { existsSync } from "node:fs";
// Explicit environment values take precedence. Files are server-only and gitignored.
if (existsSync(".env")) process.loadEnvFile(".env");
