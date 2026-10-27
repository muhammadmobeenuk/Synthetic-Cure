import "../../scripts/env.js";
import { openDatabase, migrate } from "../../packages/database/index.js";
import { seed } from "../../packages/database/seed.js";
import { createApp } from "./app.js";
import express from "express";
import { workOnce } from "../worker/index.js";
import path from "node:path";
const db = await openDatabase();
await migrate(db);
if (process.env.NODE_ENV !== "production") await seed(db);
const app = createApp(db,{ uploads: process.env.UPLOAD_DIR });
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.resolve("dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    configFile: path.resolve("vite.config.ts"),
    server: { middlewareMode: true },
  });
  app.use(vite.middlewares);
}
const workerTimer = !db.native
  ? setInterval(
      () => void workOnce(db).catch(() => console.error("Worker failed")),
      3000,
    )
  : null;
const requestedPort = process.argv.indexOf("--port");
const port =
  Number(process.env.PORT) ||
  (requestedPort >= 0 ? Number(process.argv[requestedPort + 1]) : 3000);
const server = app.listen(port, "0.0.0.0", () =>
  console.log("JadeSun Warehouse listening on port " + port),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    if (workerTimer) clearInterval(workerTimer);
    server.close(() => {
      void db.close().then(() => process.exit(0));
    });
  });
