import "./env.js";
import { openDatabase, migrate } from "../packages/database/index.js";
const db = await openDatabase();
await migrate(db);
await db.close();
console.log("Migrations applied");
