import "./env.js";
import { openDatabase, migrate } from "../packages/database/index.js";
import { seed } from "../packages/database/seed.js";
const db = await openDatabase();
await migrate(db);
await seed(db);
await db.close();
console.log("Seed/provisioning complete");
