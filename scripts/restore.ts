import "./env.js";
import { openDatabase, migrate } from "../packages/database/index.js";
import { restoreBackup } from "../packages/database/backup.js";
if (process.env.ALLOW_RESTORE !== "true" || !process.argv[2])
  throw new Error(
    "Set ALLOW_RESTORE=true and pass a backup file; target must be empty",
  );
const db = await openDatabase();
await migrate(db);
await restoreBackup(db, process.argv[2], process.env.UPLOAD_DIR || "runtime/private");
await db.close();
console.log(
  "Restore completed. Verify the application and private files before resuming operations.",
);
