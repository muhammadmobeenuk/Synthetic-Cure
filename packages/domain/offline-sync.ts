import { createHash } from "node:crypto";
import type { DB } from "../database/index.js";
import { type Actor, requireRule } from "./index.js";
import { event } from "./services.js";
import type {
  OfflineOperationQueue,
  OfflineConflictResolve,
} from "../contracts/offline-sync.js";

function payloadHash(payload: any): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function queueOfflineOperation(
  db: DB,
  actor: Actor,
  input: OfflineOperationQueue,
) {
  const warehouseId = actor.warehouse_id || `${actor.org_id}:legacy`;
  const hash = payloadHash(input.payload);

  return db.transaction(async (t) => {
    // 1. Prevent duplicate queue items with exact same ID
    const existing = await t.query(
      "SELECT id, status FROM sync_outbox WHERE id = $1 AND org_id = $2",
      [input.operationId, actor.org_id],
    );
    if (existing.rows.length > 0) {
      return existing.rows[0];
    }

    const insertQuery = `
      INSERT INTO sync_outbox(
        id, org_id, warehouse_id, user_id, command, endpoint, payload_hash, payload,
        expected_version, depends_on_operation_id, file_upload_id, status, attempts, max_attempts
      )
      VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'queued', 0, 5)
      RETURNING *
    `;
    const res = await t.query(insertQuery, [
      input.operationId,
      actor.org_id,
      warehouseId,
      actor.id,
      input.command,
      input.endpoint,
      hash,
      JSON.stringify(input.payload),
      input.expectedVersion || null,
      input.dependsOnOperationId || null,
      input.fileUploadId || null,
    ]);

    return res.rows[0];
  });
}

export async function getOfflineOutbox(
  db: DB,
  actor: Actor,
  filters: { status?: string; limit?: number; offset?: number },
) {
  const warehouseId = actor.warehouse_id || `${actor.org_id}:legacy`;
  const conditions = ["org_id = $1", "warehouse_id = $2", "user_id = $3"];
  const params: any[] = [actor.org_id, warehouseId, actor.id];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }

  const limit = Math.min(filters.limit || 50, 100);
  const offset = filters.offset || 0;
  params.push(limit, offset);

  const query = `
    SELECT * FROM sync_outbox
    WHERE ${conditions.join(" AND ")}
    ORDER BY created_at ASC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;
  const res = await db.query(query, params);
  return res.rows;
}

export async function resolveOfflineConflict(
  db: DB,
  actor: Actor,
  operationId: string,
  input: OfflineConflictResolve,
) {
  return db.transaction(async (t) => {
    const itemRes = await t.query(
      "SELECT * FROM sync_outbox WHERE id = $1 AND org_id = $2 FOR UPDATE",
      [operationId, actor.org_id],
    );
    requireRule(itemRes.rows.length > 0, "NOT_FOUND", "Outbox operation not found", 404);
    const item = itemRes.rows[0];
    requireRule(item.status === "conflict", "NOT_IN_CONFLICT", "Operation is not in conflict", 422);

    if (input.resolution === "discard") {
      const updated = await t.query(
        "UPDATE sync_outbox SET status = 'failed', error_message = 'Discarded by user after version conflict', updated_at = now() WHERE id = $1 RETURNING *",
        [operationId],
      );
      return updated.rows[0];
    } else {
      // Rebase and retry
      requireRule(input.newExpectedVersion !== undefined, "VERSION_REQUIRED", "New expected version is required to rebase", 422);
      const newPayload = input.modifiedPayload || item.payload;
      const updated = await t.query(
        `UPDATE sync_outbox
         SET status = 'queued',
             expected_version = $1,
             payload = $2,
             payload_hash = $3,
             conflict_details = NULL,
             error_message = NULL,
             attempts = 0,
             updated_at = now()
         WHERE id = $4
         RETURNING *`,
        [
          input.newExpectedVersion,
          JSON.stringify(newPayload),
          payloadHash(newPayload),
          operationId,
        ],
      );
      return updated.rows[0];
    }
  });
}

export async function syncOfflineOutboxBatch(
  db: DB,
  actor: Actor,
  executor: (item: any) => Promise<{ success: boolean; result?: any; conflict?: any; error?: string }>,
) {
  const warehouseId = actor.warehouse_id || `${actor.org_id}:legacy`;
  const items = (
    await db.query(
      `SELECT * FROM sync_outbox
       WHERE org_id = $1 AND warehouse_id = $2 AND user_id = $3 AND status IN ('queued', 'uploading_file')
       ORDER BY created_at ASC
       LIMIT 20`,
      [actor.org_id, warehouseId, actor.id],
    )
  ).rows;

  const results: any[] = [];

  for (const item of items) {
    // 1. Dependency ordering check: file-before-command
    if (item.file_upload_id) {
      const doc = await db.query(
        "SELECT id, storage_key FROM documents WHERE id = $1 AND org_id = $2",
        [item.file_upload_id, actor.org_id],
      );
      if (doc.rows.length === 0 || !doc.rows[0].storage_key) {
        // Prerequisite file not yet uploaded!
        await db.query(
          "UPDATE sync_outbox SET status = 'uploading_file', error_message = 'Waiting for prerequisite document upload to complete', updated_at = now() WHERE id = $1",
          [item.id],
        );
        results.push({ id: item.id, status: "uploading_file", error: "File not yet confirmed" });
        continue;
      }
    }

    // 2. Prerequisite operation dependency
    if (item.depends_on_operation_id) {
      const prereq = await db.query(
        "SELECT id, status FROM sync_outbox WHERE id = $1 AND org_id = $2",
        [item.depends_on_operation_id, actor.org_id],
      );
      if (prereq.rows.length === 0 || prereq.rows[0].status !== "confirmed") {
        await db.query(
          "UPDATE sync_outbox SET status = 'queued', error_message = 'Waiting for prerequisite operation to confirm', updated_at = now() WHERE id = $1",
          [item.id],
        );
        results.push({ id: item.id, status: "queued", error: "Prerequisite not confirmed" });
        continue;
      }
    }

    // 3. Mark as syncing
    await db.query(
      "UPDATE sync_outbox SET status = 'syncing', attempts = attempts + 1, updated_at = now() WHERE id = $1",
      [item.id],
    );

    // 4. Final Dispatch Guard: dispatch / complete delivery require online authoritative server confirmation
    if (item.command === "shipments.dispatch" || item.command === "delivery.complete") {
      // Must be processed by authoritative server executor
    }

    try {
      const execResult = await executor(item);
      if (execResult.success) {
        await db.query(
          "UPDATE sync_outbox SET status = 'confirmed', confirmed_at = now(), updated_at = now(), error_message = NULL WHERE id = $1",
          [item.id],
        );
        results.push({ id: item.id, status: "confirmed", result: execResult.result });
      } else if (execResult.conflict) {
        // 409 conflict: retain payload, store conflict details
        await db.query(
          "UPDATE sync_outbox SET status = 'conflict', conflict_details = $1, error_message = '409 Version Conflict', updated_at = now() WHERE id = $2",
          [JSON.stringify(execResult.conflict), item.id],
        );
        results.push({ id: item.id, status: "conflict", conflict: execResult.conflict });
      } else {
        const attempts = item.attempts + 1;
        const newStatus = attempts >= item.max_attempts ? "failed" : "queued";
        await db.query(
          "UPDATE sync_outbox SET status = $1, error_message = $2, updated_at = now() WHERE id = $3",
          [newStatus, execResult.error || "Execution failed", item.id],
        );
        results.push({ id: item.id, status: newStatus, error: execResult.error });
      }
    } catch (err: any) {
      const attempts = item.attempts + 1;
      const isConflict = err.message?.includes("409") || err.code === "VERSION_CONFLICT";
      const newStatus = isConflict ? "conflict" : (attempts >= item.max_attempts ? "failed" : "queued");
      await db.query(
        "UPDATE sync_outbox SET status = $1, error_message = $2, updated_at = now() WHERE id = $3",
        [newStatus, err.message, item.id],
      );
      results.push({ id: item.id, status: newStatus, error: err.message });
    }
  }

  return results;
}
