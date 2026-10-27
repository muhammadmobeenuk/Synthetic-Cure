import "./env.js";
import { openDatabase } from "../packages/database/index.js";
import { writeBackup } from "../packages/database/backup.js";
const db = await openDatabase();
const output =
  process.argv[2] ||
  "runtime/backups/" + new Date().toISOString().replaceAll(":", "-") + ".json";
await writeBackup(db, output, process.env.UPLOAD_DIR || "runtime/private");
await db.close();
console.log("Backup written: " + output);
