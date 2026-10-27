import {extractDocument} from './ocr.js';
import path from 'node:path';
import {validateActor} from "../../packages/domain/context.js";
import "../../scripts/env.js";
import { authorize, owned } from "../../packages/domain/services.js";
import { requireRule } from "../../packages/domain/index.js";
import {
  openDatabase,
  migrate,
  type DB,
} from "../../packages/database/index.js";
export async function workOnce(db: DB, options:{uploads?:string}={}) {
  return db.transaction(async (t) => {
    const j = (
      await t.query(
        "SELECT * FROM jobs WHERE status IN ('queued','retry') AND available_at<=now() AND attempts<3 ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
      )
    ).rows[0];
    if (!j) return null;
    await t.query("SAVEPOINT job_attempt");
    try {
      requireRule(["inventory-export","ocr-extraction"].includes(j.kind), "JOB_KIND", "Unsupported job kind");
      const actor = await owned(t, "users", j.actor_id, { org_id: j.org_id,warehouse_id:j.warehouse_id } as any);
      actor.warehouse_id=j.warehouse_id;
      await validateActor(t,actor);
      requireRule(actor.active, "FORBIDDEN", "Job actor is inactive", 403);
      if(j.kind==='ocr-extraction'){
        authorize(actor,'receive');const doc=await owned(t,'documents',j.payload.documentId,actor);requireRule(doc.sha256===j.payload.sourceHash,'FILE_INTEGRITY','Document changed',422);requireRule(j.payload.provider==='local'||(j.payload.provider==='gemini'&&j.payload.externalTransferConfirmed===true),'OCR_CONSENT','External transfer was not confirmed',422);
        const result=await extractDocument(doc,j.payload.provider,path.resolve(options.uploads||process.env.UPLOAD_DIR||'runtime/private'));
        await t.query("UPDATE jobs SET status='completed',attempts=attempts+1,result=$1 WHERE id=$2",[JSON.stringify(result),j.id]);return j.id;
      }
      authorize(actor, "export");
      const rows = (
        await t.query(
          "SELECT b.code,b.status,b.condition,l.code AS location FROM boxes b LEFT JOIN pallets p ON p.id=b.pallet_id LEFT JOIN locations l ON l.id=COALESCE(b.location_id,p.location_id) WHERE b.org_id=$1 AND b.warehouse_id=$2 ORDER BY b.code,b.id",
          [j.org_id,j.warehouse_id],
        )
      ).rows;
      await t.query(
        "UPDATE jobs SET status='completed',attempts=attempts+1,result=$1 WHERE id=$2",
        [
          JSON.stringify({
            generatedAt: new Date().toISOString(),
            boxes: rows,
          }),
          j.id,
        ],
      );
      return j.id;
    } catch (e) {
      await t.query("ROLLBACK TO SAVEPOINT job_attempt");
      await t.query(
        "UPDATE jobs SET status=CASE WHEN $3 OR attempts>=2 THEN 'failed' ELSE 'retry' END,attempts=attempts+1,error=$1,available_at=now()+interval '30 seconds' WHERE id=$2",
        [j.kind==='ocr-extraction'?'Document extraction failed. Check provider configuration, file and permissions; manual entry remains available.':'Export failed; inspect permissions, job type and server diagnostics', j.id, j.kind==='ocr-extraction'&&((e as any)?.status===422||(e as any)?.status===403)],
      );
      return j.id;
    }
  });
}
if (import.meta.url.endsWith(process.argv[1] || "--")) {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "Standalone worker requires PostgreSQL. Development worker runs inside the API process.",
    );
  const db = await openDatabase();
  await migrate(db);
  const timer = setInterval(
    () =>
      void workOnce(db).catch(() =>
        console.error("Worker database operation failed"),
      ),
    3000,
  );
  process.on("SIGINT", () => {
    clearInterval(timer);
    void db.close();
  });
  console.log(
    "Export worker running. PGlite requires the API-embedded worker, not a second writer.",
  );
}
