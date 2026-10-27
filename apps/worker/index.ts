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
  // Phase 1: Atomically claim 1 job with lease in a short transaction
  const claim = await db.transaction(async (t) => {
    const j = (
      await t.query(
        "SELECT * FROM jobs WHERE ((status IN ('queued','retry') AND available_at<=now()) OR (status='processing' AND available_at<=now())) AND attempts<3 ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
      )
    ).rows[0];
    if (!j) return null;

    try {
      requireRule(["inventory-export","ocr-extraction"].includes(j.kind), "JOB_KIND", "Unsupported job kind");
      const actor = await owned(t, "users", j.actor_id, { org_id: j.org_id, warehouse_id: j.warehouse_id } as any);
      actor.warehouse_id = j.warehouse_id;
      await validateActor(t, actor);
      requireRule(actor.active, "FORBIDDEN", "Job actor is inactive", 403);

      let doc: any = null;
      if (j.kind === 'ocr-extraction') {
        authorize(actor, 'receive');
        doc = await owned(t, 'documents', j.payload.documentId, actor);
        requireRule(doc.sha256 === j.payload.sourceHash, 'FILE_INTEGRITY', 'Document changed', 422);
        requireRule(
          j.payload.provider === 'local' || (j.payload.provider === 'gemini' && j.payload.externalTransferConfirmed === true),
          'OCR_CONSENT',
          'External transfer was not confirmed',
          422
        );
      } else {
        authorize(actor, 'export');
      }

      const attempts = j.attempts + 1;
      await t.query(
        "UPDATE jobs SET status='processing', attempts=$1, available_at=now() + interval '60 seconds' WHERE id=$2",
        [attempts, j.id]
      );
      return { job: { ...j, attempts }, actor, doc };
    } catch (e) {
      const isFatal = j.kind === 'ocr-extraction' && ((e as any)?.status === 422 || (e as any)?.status === 403);
      const willFail = isFatal || j.attempts >= 2;
      const errorMsg = j.kind === 'ocr-extraction'
        ? 'Document extraction failed. Check provider configuration, file and permissions; manual entry remains available.'
        : 'Export failed; inspect permissions, job type and server diagnostics';
      await t.query(
        "UPDATE jobs SET status=$1, attempts=attempts+1, error=$2, available_at=now()+interval '30 seconds' WHERE id=$3",
        [willFail ? 'failed' : 'retry', errorMsg, j.id]
      );
      return { failedJobId: j.id };
    }
  });

  if (!claim) return null;
  if ('failedJobId' in claim) return claim.failedJobId;

  const { job: j, doc } = claim;

  // Phase 2: Execute bounded work OUTSIDE the database transaction
  try {
    let result: any;
    if (j.kind === 'ocr-extraction') {
      result = await extractDocument(
        doc,
        j.payload.provider,
        path.resolve(options.uploads || process.env.UPLOAD_DIR || 'runtime/private')
      );
    } else {
      const rows: any[] = [];
      let lastCode: string | null = null;
      let lastId: string | null = null;
      while (true) {
        const batch: { rows: any[] } = (lastCode !== null && lastId !== null)
          ? await db.query(
              "SELECT b.id, b.code, b.status, b.condition, l.code AS location FROM boxes b LEFT JOIN pallets p ON p.id=b.pallet_id LEFT JOIN locations l ON l.id=COALESCE(b.location_id,p.location_id) WHERE b.org_id=$1 AND b.warehouse_id=$2 AND (b.code > $3 OR (b.code = $3 AND b.id > $4)) ORDER BY b.code, b.id LIMIT 500",
              [j.org_id, j.warehouse_id, lastCode, lastId]
            )
          : await db.query(
              "SELECT b.id, b.code, b.status, b.condition, l.code AS location FROM boxes b LEFT JOIN pallets p ON p.id=b.pallet_id LEFT JOIN locations l ON l.id=COALESCE(b.location_id,p.location_id) WHERE b.org_id=$1 AND b.warehouse_id=$2 ORDER BY b.code, b.id LIMIT 500",
              [j.org_id, j.warehouse_id]
            );
        if (!batch.rows.length) break;
        for (const r of batch.rows) {
          rows.push({
            code: r.code,
            status: r.status,
            condition: r.condition,
            location: r.location,
          });
        }
        const lastRow: any = batch.rows[batch.rows.length - 1];
        lastCode = lastRow.code;
        lastId = lastRow.id;
        if (batch.rows.length < 500) break;
      }
      result = {
        generatedAt: new Date().toISOString(),
        boxes: rows,
      };
    }

    // Phase 3: Finalize result in short transaction, RECHECKING permissions!
    await db.transaction(async (t) => {
      const currentJob = (await t.query("SELECT * FROM jobs WHERE id=$1 FOR UPDATE", [j.id])).rows[0];
      if (!currentJob || currentJob.status !== 'processing') return;

      const actor = await owned(t, "users", j.actor_id, { org_id: j.org_id, warehouse_id: j.warehouse_id } as any);
      actor.warehouse_id = j.warehouse_id;
      await validateActor(t, actor);
      requireRule(actor.active, "FORBIDDEN", "Job actor is inactive", 403);
      if (j.kind === 'ocr-extraction') {
        authorize(actor, 'receive');
      } else {
        authorize(actor, 'export');
      }

      await t.query(
        "UPDATE jobs SET status='completed', result=$1, error=NULL WHERE id=$2",
        [JSON.stringify(result), j.id]
      );
    });

    return j.id;
  } catch (e) {
    const isFatal = j.kind === 'ocr-extraction' && ((e as any)?.status === 422 || ((e as any)?.status === 403));
    const willFail = isFatal || j.attempts >= 3;
    const errorMsg = j.kind === 'ocr-extraction'
      ? 'Document extraction failed. Check provider configuration, file and permissions; manual entry remains available.'
      : 'Export failed; inspect permissions, job type and server diagnostics';
    await db.query(
      "UPDATE jobs SET status=$1, error=$2, available_at=now()+interval '30 seconds' WHERE id=$3",
      [willFail ? 'failed' : 'retry', errorMsg, j.id]
    );
    return j.id;
  }
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
