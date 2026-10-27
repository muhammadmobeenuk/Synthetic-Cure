import {ocrStatus} from '../worker/ocr.js';
import {
  inboundList,
  createSupplier,
  createExpectedReceipt,
  receiveExpectedBox,
  cancelExpectedReceipt,
  listPurchaseOrders,
  getPurchaseOrder,
  createPurchaseOrder,
  receivePurchaseOrderLine,
  cancelPurchaseOrder,
  listDiscrepancies,
  reportDiscrepancy,
  reviewDiscrepancy,
  listSupplierReturns,
  createSupplierReturn,
  authorizeSupplierReturn,
  dispatchSupplierReturn,
} from '../../packages/domain/inbound.js';
import {
  supplierCreate,
  expectedCreate,
  expectedReceive,
  expectedCancel,
  purchaseOrderCreate,
  purchaseOrderReceive,
  purchaseOrderCancel,
  discrepancyReport,
  discrepancyReview,
  supplierReturnCreate,
  supplierReturnAuthorize,
  supplierReturnDispatch,
} from '../../packages/contracts/inbound.js';
import {
  listStockOwners,
  createStockOwner,
  listUnitConversions,
  createUnitConversion,
  getInventoryBalances,
  getInventoryLedger,
  adjustInventory,
  moveInventory,
  reserveInventory,
  releaseInventory,
} from '../../packages/domain/inventory.js';
import {
  ownerCreate,
  unitConversionCreate,
  inventoryAdjust,
  inventoryMove,
  inventoryReserve,
  inventoryRelease,
} from '../../packages/contracts/inventory.js';
import {
  listTasks,
  createPutawayTask,
  assignTask,
  completeTask,
  cancelTask,
  listReplenishmentPolicies,
  setReplenishmentPolicy,
  triggerReplenishment,
} from '../../packages/domain/tasks.js';
import {
  putawayTaskCreate,
  taskAssign,
  taskComplete,
  taskCancel,
  replenishmentPolicySet,
  replenishmentTrigger,
} from '../../packages/contracts/tasks.js';
import {
  listTransferOrders,
  getTransferOrder,
  createTransferOrder,
  dispatchTransferOrder,
  receiveTransferOrder,
  cancelTransferOrder,
} from '../../packages/domain/transfers.js';
import {
  transferOrderCreate,
  transferOrderDispatch,
  transferOrderReceive,
  transferOrderCancel,
} from '../../packages/contracts/transfers.js';
import {
  previewProductImport,
  reviewProductImport,
  commitProductImport,
  listProductImports,
  listCsvImports,
  reviewCsvImport,
  previewCsvImport,
  commitCsvImport,
  exportCsvImportErrors,
} from '../../packages/domain/imports.js';
import {
  productImportPreview,
  productImportCommit,
  importedProduct,
  csvImportPreview,
  csvImportCommit,
} from '../../packages/contracts/imports.js';
import {
  getWarehouseOnboarding,
  saveOnboardingStep,
  completeOnboardingReview,
} from '../../packages/domain/onboarding.js';
import {
  onboardingStepSave,
  onboardingReviewComplete,
} from '../../packages/contracts/onboarding.js';
import {workerOrderSheet} from '../../packages/domain/worker-sheet.js';
import {palletGroupList,palletGroupReconciliation,createPalletGroup,changePalletGroup} from '../../packages/domain/pallet-groups.js';
import {errorCsv} from '../../packages/domain/csv.js';
import {contexts,permittedWarehouses,resolveActor,validateActor,legacyWarehouse} from "../../packages/domain/context.js";
import {accessDirectory,changeMembership,createWarehouse,reviewWarehouse,changeWarehouseGrant,provisionStaff} from "../../packages/domain/access.js";
import { configuration, configureCompany } from "../../packages/domain/configuration.js";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import session from "express-session";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import bcrypt from "bcryptjs";
import {
  randomBytes,
  randomUUID as uuid,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { LocalPrivateStorage } from "./storage.js";
import path from "node:path";
import { z } from "zod";
import type { DB } from "../../packages/database/index.js";
import * as schemas from "../../packages/contracts/index.js";
import { DomainError, requireRule } from "../../packages/domain/index.js";
import {
  authorize,
  owned,
  version,
  event,
  command,
  services,
  boxState,
  invalidate,
  permissions,
  type Actor,
} from "../../packages/domain/services.js";
declare module "express-session" {
  interface SessionData {
    userId: string;
    companyId?:string;
    warehouseId?:string|null;
    csrf: string;
  }
}
declare global {
  namespace Express {
    interface Request {
      actor: Actor;
      requestId: string;
    }
  }
}
class DatabaseSessions extends session.Store {
  constructor(private db: DB) {
    super();
  }
  get(sid: string, cb: any) {
    this.db
      .query("SELECT data FROM sessions WHERE sid=$1 AND expires_at>now()", [
        sid,
      ])
      .then((r) => cb(null, r.rows[0]?.data || null))
      .catch(cb);
  }
  set(sid: string, data: any, cb: any) {
    this.db
      .query(
        "INSERT INTO sessions VALUES($1,$2,$3) ON CONFLICT(sid) DO UPDATE SET data=$2,expires_at=$3",
        [
          sid,
          JSON.stringify(data),
          new Date(data.cookie.expires || Date.now() + 8 * 3600000),
        ],
      )
      .then(() => cb?.())
      .catch(cb);
  }
  destroy(sid: string, cb: any) {
    this.db
      .query("DELETE FROM sessions WHERE sid=$1", [sid])
      .then(() => cb?.())
      .catch(cb);
  }
}
export function createApp(
  db: DB,
  options: { uploads?: string; demo?: boolean } = {},
) {
  const app = express();
  const production = process.env.NODE_ENV === "production";
  const demo =
    !production && (options.demo ?? process.env.DEMO_MODE !== "false");
  const uploads = path.resolve(options.uploads || "runtime/private");
  const storage = new LocalPrivateStorage(uploads);
  const secret =
    process.env.SESSION_SECRET ||
    (!production ? randomBytes(48).toString("hex") : "");
  if (secret.length < 32)
    throw new Error("SESSION_SECRET must have at least 32 characters");
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use((req, res, next) => {
    req.requestId = uuid();
    res.setHeader("X-Request-ID", req.requestId);
    next();
  });
  app.use(helmet({ contentSecurityPolicy: production ? undefined : false }));
  app.use(express.json({ limit: "1mb" }));
  app.use(
    session({
      name: "jadesun.sid",
      secret,
      resave: false,
      saveUninitialized: false,
      store: new DatabaseSessions(db),
      cookie: {
        httpOnly: true,
        sameSite: "strict",
        secure: production,
        maxAge: 8 * 3600000,
      },
    }),
  );
  app.get("/api/health", (_req, res) =>
    res.json({ status: "ok", app: "Synthetic Cure Warehouse" }),
  );
  app.get("/api/ready", async (_req, res) => {
    try {
      await db.query("SELECT 1");
      const uploadRoot = path.resolve(options.uploads || process.env.UPLOAD_DIR || "runtime/private");
      const probeKey = ".readiness-probe-" + Date.now();
      const probePath = path.join(uploadRoot, probeKey);
      await mkdir(uploadRoot, { recursive: true });
      await writeFile(probePath, "probe", { mode: 0o600 });
      await unlink(probePath);

      res.json({
        status: "ready",
        database: db.native ? "PostgreSQL" : "PGlite development",
        storage: "accessible",
        demo,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(503).json({
        status: "unready",
        error: err.message || "Readiness check failed",
        database: db.native ? "PostgreSQL" : "PGlite development",
      });
    }
  });
  app.use("/api/v1", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/api/v1/session", async (req, res) => {
    if (!req.session.csrf) req.session.csrf = randomBytes(24).toString("hex");
    const identity=req.session.userId ? (await db.query("SELECT id,name,email,org_id AS home_org_id FROM users WHERE id=$1 AND active",[req.session.userId])).rows[0] : null;
    const user=identity ? await resolveActor(db,identity.id,req.session.companyId,req.session.warehouseId) : null;
    res.json({
      user,
      identity,
      companies:identity ? await contexts(db,identity.id) : [],
      warehouses:user ? await permittedWarehouses(db,user) : [],
      csrf: req.session.csrf,
      demo,
      permissions: user ? permissions[user.role] : [],
      database: db.native ? "PostgreSQL" : "PGlite development",
    });
  });
  app.use("/api/v1", (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const token = req.get("X-CSRF-Token") || "";
    const expected = req.session.csrf || "";
    if (
      !expected ||
      token.length !== expected.length ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(expected))
    )
      return next(
        new DomainError(
          403,
          "CSRF",
          "Session security token expired. Reload your session; your draft remains.",
        ),
      );
    next();
  });
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  app.use("/api/v1/auth", loginLimiter);
  async function login(req: Request, res: Response, id: string, selected?:Actor) {
    const actor=selected || await resolveActor(db,id);
    requireRule(actor,"NO_MEMBERSHIP","No active company membership. Contact an administrator.",403);
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((e) => (e ? reject(e) : resolve())),
    );
    req.session.userId = id;
    req.session.companyId=actor.org_id;
    req.session.warehouseId=actor.warehouse_id;
    req.session.csrf = randomBytes(24).toString("hex");
    await new Promise<void>((resolve, reject) =>
      req.session.save((e) => (e ? reject(e) : resolve())),
    );
    res.json({ ok: true });
  }
  app.post("/api/v1/auth/login", async (req, res) => {
    const p = z
      .object({ email: z.email(), password: z.string().max(200) })
      .parse(req.body);
    const user = (
      await db.query(
        "SELECT * FROM users WHERE lower(email)=lower($1) AND active=true",
        [p.email],
      )
    ).rows[0];
    const valid =
      user?.password_hash &&
      (await bcrypt.compare(p.password, user.password_hash));
    requireRule(valid, "LOGIN_FAILED", "Email or password is incorrect", 401);
    await login(req, res, user.id);
  });
  app.post("/api/v1/auth/demo", async (req, res) => {
    requireRule(demo, "DEMO_DISABLED", "Demo sign-in is unavailable", 404);
    const id = z
      .enum(["demo-admin", "demo-driver", "demo-reviewer", "demo-operator"])
      .default("demo-admin")
      .parse(req.body.userId);
    const user = (
      await db.query(
        "SELECT u.id FROM users u JOIN organizations o ON o.id=u.org_id WHERE u.id=$1 AND o.demo=true",
        [id],
      )
    ).rows[0];
    requireRule(user, "DEMO_MISSING", "Run the synthetic seed first", 503);
    await login(req, res, id);
  });
  app.post("/api/v1/auth/context", async(req,res)=>{
    requireRule(req.session.userId,"UNAUTHENTICATED","Sign in to choose a company",401);
    const p=schemas.contextSwitch.parse(req.body);
    const actor=await resolveActor(db,req.session.userId,p.companyId,p.warehouseId===null?undefined:p.warehouseId);
    requireRule(actor&&actor.org_id===p.companyId,"FORBIDDEN","Company is not assigned to you",403);
    if(p.warehouseId)requireRule(actor.warehouse_id===p.warehouseId,"WAREHOUSE_ACCESS","Warehouse is not assigned to you",403);
    await db.transaction(async t=>{await validateActor(t,actor);await event(t,actor,actor.id,"session.context_changed",{companyId:actor.org_id,warehouseId:actor.warehouse_id});});
    await login(req,res,actor.id,actor);
  });
  app.post("/api/v1/auth/logout",async(req,res)=>{
    await new Promise<void>((resolve,reject)=>req.session.destroy(e=>e?reject(e):resolve()));
    res.clearCookie("jadesun.sid");res.json({ok:true});
  });
  app.use("/api/v1", async (req,_res,next)=>{
    const a=req.session.userId ? await resolveActor(db,req.session.userId,req.session.companyId,req.session.warehouseId) : null;
    requireRule(a,"UNAUTHENTICATED","Select an active company or sign in. Pending work remains on this device.",401);
    req.actor=a;
    const expectedCompany=req.get("X-Company-Context"),expectedWarehouse=req.get("X-Warehouse-Context");
    requireRule((!expectedCompany||expectedCompany===a.org_id)&&(!expectedWarehouse||expectedWarehouse===(a.warehouse_id||"none")),"CONTEXT_CHANGED","Workspace changed in this session or another tab. Reopen the current workspace; your pending work remains.",409);
    const path=req.originalUrl.split('?')[0];
    const setup=["/api/v1/workspace","/api/v1/company-configuration","/api/v1/company-configuration/history","/api/v1/access/directory","/api/v1/access/memberships","/api/v1/access/warehouse-grants","/api/v1/warehouses"];
    requireRule(a.warehouse_id||setup.includes(path)||/^\/api\/v1\/warehouses\/[^/]+\/review$/.test(path),"WAREHOUSE_ACCESS","Choose an assigned warehouse. Pending work is preserved.",403);
    next();
  });
  const run =
    (
      schema: z.ZodType,
      action: string,
      name: (req: Request) => string,
      fn: (t: DB, a: Actor, p: any, req: Request) => Promise<any>,
    ) =>
    async (req: Request, res: Response) => {
      authorize(req.actor, action);
      const p = schema.parse(req.body);
      if (req.actor.role === "driver") {
        const shipment = await owned(
          db,
          "shipments",
          String(req.params.id),
          req.actor,
        );
        const trip = await owned(db, "trips", shipment.trip_id, req.actor);
        requireRule(
          trip.driver_id === req.actor.id,
          "FORBIDDEN",
          "This trip is not assigned to you",
          403,
        );
      }
      res.json(
        await command(db, req.actor, name(req), p, (t) =>
          fn(t, req.actor, p, req),
        ),
      );
    };
  app.get("/api/v1/workspace", async (req, res) => {
    const a = req.actor,
      org = a.org_id;
    const take = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const data: Record<string, any> = {
      demo,
      permissions: permissions[a.role],
      database: db.native ? "PostgreSQL" : "PGlite development",
      configuration: await configuration(db, a),
      warehouse:(await permittedWarehouses(db,a)).find(w=>w.id===a.warehouse_id)||null,
    };
    if(!a.warehouse_id) return res.json(data);
    if (a.role === "driver") {
      data.trips = (
        await db.query(
          "SELECT * FROM trips WHERE org_id=$1 AND driver_id=$2 AND warehouse_id=$5 ORDER BY business_date,id LIMIT $3 OFFSET $4",
          [org, a.id, take, offset,a.warehouse_id||"__none__"],
        )
      ).rows;
      data.stops = (
        await db.query(
          "SELECT s.*,d.name,d.address FROM stops s JOIN trips t ON t.id=s.trip_id JOIN destinations d ON d.id=s.destination_id WHERE t.org_id=$1 AND t.warehouse_id=$3 AND t.driver_id=$2 ORDER BY t.business_date,s.position,s.id LIMIT 200",
          [org, a.id,a.warehouse_id||"__none__"],
        )
      ).rows;
      data.shipments = (
        await db.query(
          "SELECT s.*,o.code AS order_code FROM shipments s JOIN trips t ON t.id=s.trip_id JOIN orders o ON o.id=s.order_id WHERE s.org_id=$1 AND s.warehouse_id=$3 AND t.driver_id=$2 ORDER BY s.created_at,s.id LIMIT 200",
          [org, a.id,a.warehouse_id||"__none__"],
        )
      ).rows;
      data.shipmentLines = (
        await db.query(
          "SELECT sl.*,b.code AS box_code,p.name AS product_name FROM shipment_lines sl JOIN shipments s ON s.id=sl.shipment_id JOIN trips t ON t.id=s.trip_id JOIN boxes b ON b.id=sl.box_id JOIN products p ON p.id=sl.product_id WHERE sl.org_id=$1 AND sl.warehouse_id=$3 AND t.driver_id=$2 ORDER BY sl.id LIMIT 500",
          [org, a.id,a.warehouse_id||"__none__"],
        )
      ).rows;
      return res.json(data);
    }
    const queries: Record<string, [string, any[]]> = {
      authorizations: [
        "SELECT * FROM destination_authorizations WHERE org_id=$1 ORDER BY created_at,id LIMIT 200",
        [org],
      ],
      boxes: [
        `SELECT b.*,c.name customer_name,c.name_zh customer_name_zh,p.code pallet_code,l.code location_code,COALESCE(b.location_id,p.location_id) effective_location_id,(SELECT count(*)::int FROM documents d WHERE d.box_id=b.id) photo_count FROM boxes b LEFT JOIN customers c ON c.id=b.customer_id LEFT JOIN pallets p ON p.id=b.pallet_id LEFT JOIN locations l ON l.id=COALESCE(b.location_id,p.location_id) WHERE b.org_id=$1 AND b.warehouse_id=$4 ORDER BY b.created_at DESC,b.id LIMIT $2 OFFSET $3`,
        [org, take, offset,a.warehouse_id||"__none__"],
      ],
      contents: [
        "SELECT c.*,p.name product_name,p.name_zh,p.sku FROM contents c JOIN products p ON p.id=c.product_id WHERE c.org_id=$1 AND c.warehouse_id=$2 ORDER BY c.id LIMIT 500",
        [org,a.warehouse_id||"__none__"],
      ],
      customers: [
        "SELECT * FROM customers WHERE org_id=$1 ORDER BY code,id LIMIT 200",
        [org],
      ],
      destinations: [
        "SELECT * FROM destinations WHERE org_id=$1 ORDER BY name,id LIMIT 200",
        [org],
      ],
      products: [
        "SELECT * FROM products WHERE org_id=$1 ORDER BY sku,id LIMIT 200",
        [org],
      ],
      locations: [
        "SELECT * FROM locations WHERE org_id=$1 AND warehouse_id=$2 ORDER BY code,id LIMIT 200",
        [org,a.warehouse_id||"__none__"],
      ],
      pallets: [
        "SELECT p.*,l.code location_code,(SELECT count(*)::int FROM boxes b WHERE b.pallet_id=p.id) box_count FROM pallets p JOIN locations l ON l.id=p.location_id WHERE p.org_id=$1 AND p.warehouse_id=$2 ORDER BY p.created_at,p.id LIMIT 200",
        [org,a.warehouse_id||"__none__"],
      ],
      orders: [
        "SELECT o.*,c.name customer_name,d.name destination_name FROM orders o JOIN customers c ON c.id=o.customer_id JOIN destinations d ON d.id=o.destination_id WHERE o.org_id=$1 AND o.warehouse_id=$2 ORDER BY o.created_at DESC,o.id LIMIT 200",
        [org,a.warehouse_id||"__none__"],
      ],
      orderLines: [
        "SELECT l.*,p.name product_name FROM order_lines l JOIN products p ON p.id=l.product_id WHERE l.org_id=$1 AND l.warehouse_id=$2 ORDER BY l.id LIMIT 500",
        [org,a.warehouse_id||"__none__"],
      ],
      allocations: [
        "SELECT * FROM allocations WHERE org_id=$1 AND warehouse_id=$2 ORDER BY id LIMIT 500",
        [org,a.warehouse_id||"__none__"],
      ],
      preparations: [
        "SELECT * FROM preparations WHERE org_id=$1 AND warehouse_id=$2 ORDER BY business_date DESC,id LIMIT 100",
        [org,a.warehouse_id||"__none__"],
      ],
      preparationOrders: [
        "SELECT po.* FROM preparation_orders po JOIN preparations p ON p.id=po.preparation_id WHERE p.org_id=$1 AND p.warehouse_id=$2 ORDER BY po.preparation_id,po.order_id LIMIT 500",
        [org,a.warehouse_id||"__none__"],
      ],
      trips: [
        "SELECT t.*,u.name driver_name FROM trips t LEFT JOIN users u ON u.id=t.driver_id WHERE t.org_id=$1 AND t.warehouse_id=$2 ORDER BY business_date DESC,t.id LIMIT 100",
        [org,a.warehouse_id||"__none__"],
      ],
      stops: [
        "SELECT s.*,d.name,d.address FROM stops s JOIN destinations d ON d.id=s.destination_id WHERE s.org_id=$1 AND s.warehouse_id=$2 ORDER BY trip_id,position,id LIMIT 500",
        [org,a.warehouse_id||"__none__"],
      ],
      shipments: [
        "SELECT s.*,o.code order_code,d.name destination_name FROM shipments s JOIN orders o ON o.id=s.order_id JOIN destinations d ON d.id=s.destination_id WHERE s.org_id=$1 AND s.warehouse_id=$2 ORDER BY s.created_at,s.id LIMIT 200",
        [org,a.warehouse_id||"__none__"],
      ],
      shipmentLines: [
        "SELECT sl.*,b.code box_code,p.name product_name FROM shipment_lines sl JOIN boxes b ON b.id=sl.box_id JOIN products p ON p.id=sl.product_id WHERE sl.org_id=$1 AND sl.warehouse_id=$2 ORDER BY sl.id LIMIT 500",
        [org,a.warehouse_id||"__none__"],
      ],
      issues: [
        "SELECT i.*,b.code box_code FROM issues i LEFT JOIN boxes b ON b.id=i.box_id WHERE i.org_id=$1 AND i.warehouse_id=$2 ORDER BY i.created_at DESC,i.id LIMIT 200",
        [org,a.warehouse_id||"__none__"],
      ],
      documents: [
        "SELECT id,box_id,name,mime,size,created_at FROM documents WHERE org_id=$1 AND warehouse_id=$2 ORDER BY created_at DESC,id LIMIT 200",
        [org,a.warehouse_id||"__none__"],
      ],
      users: [
        "SELECT u.id,u.name,u.email,m.role FROM users u JOIN company_memberships m ON m.user_id=u.id JOIN warehouse_grants g ON g.user_id=m.user_id AND g.org_id=m.org_id WHERE m.org_id=$1 AND m.active AND u.active AND g.warehouse_id=$2 AND g.active ORDER BY u.name,u.id",
        [org,a.warehouse_id||"__none__"],
      ],
      marks: [
        "SELECT * FROM tracking_marks WHERE org_id=$1 ORDER BY symbol,id",
        [org],
      ],
      events: [
        "SELECT e.*,u.name actor_name FROM inventory_events e JOIN users u ON u.id=e.actor_id WHERE e.org_id=$1 AND e.warehouse_id=$2 ORDER BY e.created_at DESC,e.id LIMIT 50",
        [org,a.warehouse_id||"__none__"],
      ],
      jobs: [
        "SELECT id,kind,status,attempts,error,CASE WHEN kind='ocr-extraction' THEN NULL ELSE result END result,created_at FROM jobs WHERE org_id=$1 AND warehouse_id=$2 ORDER BY created_at DESC,id LIMIT 50",
        [org,a.warehouse_id||"__none__"],
      ],
      lots: [
        "SELECT * FROM lots WHERE org_id=$1 ORDER BY received_at,id LIMIT 200",
        [org],
      ],
      counts: [
        `SELECT (SELECT count(*)::int FROM boxes WHERE org_id=$1 AND warehouse_id=$2) boxes,
                (SELECT count(*)::int FROM pallets WHERE org_id=$1 AND warehouse_id=$2) pallets,
                (SELECT count(*)::int FROM orders WHERE org_id=$1 AND warehouse_id=$2 AND status='open') orders,
                (SELECT count(*)::int FROM issues WHERE org_id=$1 AND warehouse_id=$2 AND status='open') issues,
                (SELECT count(*)::int FROM products WHERE org_id=$1) products,
                (SELECT count(*)::int FROM locations WHERE org_id=$1 AND warehouse_id=$2) locations,
                (SELECT count(*)::int FROM shipments WHERE org_id=$1 AND warehouse_id=$2 AND status NOT IN ('cancelled','completed')) shipments,
                (SELECT count(*)::int FROM trips WHERE org_id=$1 AND warehouse_id=$2 AND status='planned') trips,
                (SELECT COALESCE(sum(c.quantity), 0)::text FROM contents c WHERE c.org_id=$1 AND c.warehouse_id=$2 AND c.verified=true) stock_confirmed_units`,
        [org,a.warehouse_id||"__none__"],
      ],
    };
    for (const [key, [sql, params]] of Object.entries(queries)) {
      if (key === "jobs" && !permissions[a.role]?.some(p => p === "*" || p === "export")) {
        data[key] = [];
        continue;
      }
      data[key] = (await db.query(sql, params)).rows;
    }
    res.json(data);
  });
  app.get("/api/v1/search", async (req, res) => {
    requireRule(req.actor && req.actor.id, "UNAUTHENTICATED", "Staff identity is unauthenticated", 401);
    const parsed = schemas.searchParams.parse(req.query);
    const { entity, q, limit } = parsed;
    const a = req.actor;
    const org = a.org_id;

    if (a.role === "driver") {
      requireRule(["trips", "shipments"].includes(entity), "FORBIDDEN", "Drivers access only assigned trip records", 403);
    }

    const warehouseScoped = !["products", "customers"].includes(entity);
    if (warehouseScoped) {
      requireRule(a.warehouse_id, "WAREHOUSE_ACCESS", "Select an assigned warehouse", 403);
    }
    const wh = a.warehouse_id || "__none__";

    let afterId = "";
    if (parsed.cursor) {
      requireRule(
        typeof parsed.cursor === "string" && parsed.cursor.length <= 1024 && /^[A-Za-z0-9_-]+$/.test(parsed.cursor),
        "CURSOR",
        "Invalid cursor format",
        422,
      );
      try {
        const decoded = JSON.parse(Buffer.from(parsed.cursor, "base64url").toString("utf8"));
        requireRule(
          decoded && decoded.entity === entity && decoded.q === q && typeof decoded.afterId === "string",
          "CURSOR",
          "Invalid cursor payload",
          422,
        );
        afterId = decoded.afterId;
      } catch (e: any) {
        if (e instanceof DomainError) throw e;
        throw new DomainError(422, "CURSOR", "Invalid cursor encoding");
      }
    }

    const term = `%${q.trim()}%`;
    let items: any[] = [];
    let totalCount = 0;
    let completeAggregates: Record<string, any> = {};

    if (entity === "boxes") {
      const countRes = await db.query(
        `SELECT count(*)::int n,
                count(*) FILTER (WHERE condition='good')::int good_count,
                count(*) FILTER (WHERE condition='damaged')::int damaged_count,
                count(*) FILTER (WHERE condition='hold')::int hold_count
         FROM boxes b
         LEFT JOIN customers c ON c.id=b.customer_id
         LEFT JOIN locations l ON l.id=b.location_id
         WHERE b.org_id=$1 AND b.warehouse_id=$2
           AND ($3 = '' OR b.id ILIKE $4 OR b.code ILIKE $4 OR b.source_label ILIKE $4 OR c.name ILIKE $4 OR l.code ILIKE $4)`,
        [org, wh, q.trim(), term],
      );
      totalCount = countRes.rows[0].n;
      completeAggregates = {
        total: totalCount,
        good: countRes.rows[0].good_count,
        damaged: countRes.rows[0].damaged_count,
        hold: countRes.rows[0].hold_count,
      };

      items = (
        await db.query(
          `SELECT b.*, c.name customer_name, c.name_zh customer_name_zh, p.code pallet_code, l.code location_code,
                  COALESCE(b.location_id, p.location_id) effective_location_id,
                  (SELECT count(*)::int FROM documents d WHERE d.box_id=b.id) photo_count
           FROM boxes b
           LEFT JOIN customers c ON c.id=b.customer_id
           LEFT JOIN pallets p ON p.id=b.pallet_id
           LEFT JOIN locations l ON l.id=COALESCE(b.location_id, p.location_id)
           WHERE b.org_id=$1 AND b.warehouse_id=$2
             AND ($3 = '' OR b.id ILIKE $4 OR b.code ILIKE $4 OR b.source_label ILIKE $4 OR c.name ILIKE $4 OR l.code ILIKE $4)
             AND b.id > $5
           ORDER BY b.id
           LIMIT $6`,
          [org, wh, q.trim(), term, afterId, limit + 1],
        )
      ).rows;
    } else if (entity === "products") {
      const countRes = await db.query(
        `SELECT count(*)::int n FROM products
         WHERE org_id=$1 AND ($2 = '' OR sku ILIKE $3 OR name ILIKE $3 OR name_zh ILIKE $3)`,
        [org, q.trim(), term],
      );
      totalCount = countRes.rows[0].n;
      completeAggregates = { total: totalCount };

      items = (
        await db.query(
          `SELECT * FROM products
           WHERE org_id=$1
             AND ($2 = '' OR sku ILIKE $3 OR name ILIKE $3 OR name_zh ILIKE $3)
             AND id > $4
           ORDER BY id
           LIMIT $5`,
          [org, q.trim(), term, afterId, limit + 1],
        )
      ).rows;
    } else if (entity === "orders") {
      const countRes = await db.query(
        `SELECT count(*)::int n,
                count(*) FILTER (WHERE status='open')::int open_count,
                count(*) FILTER (WHERE status='cancelled')::int cancelled_count,
                count(*) FILTER (WHERE status='completed')::int completed_count
         FROM orders o
         JOIN customers c ON c.id=o.customer_id
         JOIN destinations d ON d.id=o.destination_id
         WHERE o.org_id=$1 AND o.warehouse_id=$2
           AND ($3 = '' OR o.code ILIKE $4 OR c.name ILIKE $4 OR d.name ILIKE $4)`,
        [org, wh, q.trim(), term],
      );
      totalCount = countRes.rows[0].n;
      completeAggregates = {
        total: totalCount,
        open: countRes.rows[0].open_count,
        cancelled: countRes.rows[0].cancelled_count,
        completed: countRes.rows[0].completed_count,
      };

      items = (
        await db.query(
          `SELECT o.*, c.name customer_name, d.name destination_name
           FROM orders o
           JOIN customers c ON c.id=o.customer_id
           JOIN destinations d ON d.id=o.destination_id
           WHERE o.org_id=$1 AND o.warehouse_id=$2
             AND ($3 = '' OR o.code ILIKE $4 OR c.name ILIKE $4 OR d.name ILIKE $4)
             AND o.id > $5
           ORDER BY o.id
           LIMIT $6`,
          [org, wh, q.trim(), term, afterId, limit + 1],
        )
      ).rows;
    } else if (entity === "pallets") {
      const countRes = await db.query(
        `SELECT count(*)::int n FROM pallets p
         JOIN locations l ON l.id=p.location_id
         WHERE p.org_id=$1 AND p.warehouse_id=$2
           AND ($3 = '' OR p.code ILIKE $4 OR l.code ILIKE $4)`,
        [org, wh, q.trim(), term],
      );
      totalCount = countRes.rows[0].n;
      completeAggregates = { total: totalCount };

      items = (
        await db.query(
          `SELECT p.*, l.code location_code, (SELECT count(*)::int FROM boxes b WHERE b.pallet_id=p.id) box_count
           FROM pallets p
           JOIN locations l ON l.id=p.location_id
           WHERE p.org_id=$1 AND p.warehouse_id=$2
             AND ($3 = '' OR p.code ILIKE $4 OR l.code ILIKE $4)
             AND p.id > $5
           ORDER BY p.id
           LIMIT $6`,
          [org, wh, q.trim(), term, afterId, limit + 1],
        )
      ).rows;
    } else if (entity === "locations") {
      const countRes = await db.query(
        `SELECT count(*)::int n FROM locations
         WHERE org_id=$1 AND warehouse_id=$2
           AND ($3 = '' OR code ILIKE $4 OR name ILIKE $4)`,
        [org, wh, q.trim(), term],
      );
      totalCount = countRes.rows[0].n;
      completeAggregates = { total: totalCount };

      items = (
        await db.query(
          `SELECT * FROM locations
           WHERE org_id=$1 AND warehouse_id=$2
             AND ($3 = '' OR code ILIKE $4 OR name ILIKE $4)
             AND id > $5
           ORDER BY id
           LIMIT $6`,
          [org, wh, q.trim(), term, afterId, limit + 1],
        )
      ).rows;
    } else if (entity === "shipments") {
      const driverFilter = a.role === "driver" ? " AND t.driver_id=$5" : "";
      const driverParams = a.role === "driver" ? [org, wh, q.trim(), term, a.id] : [org, wh, q.trim(), term];

      const countRes = await db.query(
        `SELECT count(*)::int n,
                count(*) FILTER (WHERE s.status='ready')::int ready_count,
                count(*) FILTER (WHERE s.status='dispatched')::int dispatched_count,
                count(*) FILTER (WHERE s.status='completed')::int completed_count
         FROM shipments s
         JOIN orders o ON o.id=s.order_id
         JOIN destinations d ON d.id=s.destination_id
         LEFT JOIN trips t ON t.id=s.trip_id
         WHERE s.org_id=$1 AND s.warehouse_id=$2
           AND ($3 = '' OR s.id ILIKE $4 OR o.code ILIKE $4 OR d.name ILIKE $4)` + driverFilter,
        driverParams,
      );
      totalCount = countRes.rows[0].n;
      completeAggregates = {
        total: totalCount,
        ready: countRes.rows[0].ready_count,
        dispatched: countRes.rows[0].dispatched_count,
        completed: countRes.rows[0].completed_count,
      };

      const queryParams = a.role === "driver"
        ? [org, wh, q.trim(), term, a.id, afterId, limit + 1]
        : [org, wh, q.trim(), term, afterId, limit + 1];

      const afterClause = a.role === "driver" ? " AND s.id > $6" : " AND s.id > $5";
      const limitClause = a.role === "driver" ? " LIMIT $7" : " LIMIT $6";

      items = (
        await db.query(
          `SELECT s.*, o.code order_code, d.name destination_name
           FROM shipments s
           JOIN orders o ON o.id=s.order_id
           JOIN destinations d ON d.id=s.destination_id
           LEFT JOIN trips t ON t.id=s.trip_id
           WHERE s.org_id=$1 AND s.warehouse_id=$2
             AND ($3 = '' OR s.id ILIKE $4 OR o.code ILIKE $4 OR d.name ILIKE $4)` +
            driverFilter +
            afterClause +
            " ORDER BY s.id" +
            limitClause,
          queryParams,
        )
      ).rows;
    } else if (entity === "customers") {
      const countRes = await db.query(
        `SELECT count(*)::int n FROM customers
         WHERE org_id=$1 AND ($2 = '' OR code ILIKE $3 OR name ILIKE $3 OR name_zh ILIKE $3)`,
        [org, q.trim(), term],
      );
      totalCount = countRes.rows[0].n;
      completeAggregates = { total: totalCount };

      items = (
        await db.query(
          `SELECT * FROM customers
           WHERE org_id=$1
             AND ($2 = '' OR code ILIKE $3 OR name ILIKE $3 OR name_zh ILIKE $3)
             AND id > $4
           ORDER BY id
           LIMIT $5`,
          [org, q.trim(), term, afterId, limit + 1],
        )
      ).rows;
    } else if (entity === "trips") {
      const driverFilter = a.role === "driver" ? " AND t.driver_id=$5" : "";
      const driverParams = a.role === "driver" ? [org, wh, q.trim(), term, a.id] : [org, wh, q.trim(), term];

      const countRes = await db.query(
        `SELECT count(*)::int n FROM trips t
         LEFT JOIN users u ON u.id=t.driver_id
         WHERE t.org_id=$1 AND t.warehouse_id=$2
           AND ($3 = '' OR t.code ILIKE $4 OR u.name ILIKE $4 OR t.vehicle ILIKE $4)` + driverFilter,
        driverParams,
      );
      totalCount = countRes.rows[0].n;
      completeAggregates = { total: totalCount };

      const queryParams = a.role === "driver"
        ? [org, wh, q.trim(), term, a.id, afterId, limit + 1]
        : [org, wh, q.trim(), term, afterId, limit + 1];

      const afterClause = a.role === "driver" ? " AND t.id > $6" : " AND t.id > $5";
      const limitClause = a.role === "driver" ? " LIMIT $7" : " LIMIT $6";

      items = (
        await db.query(
          `SELECT t.*, u.name driver_name
           FROM trips t
           LEFT JOIN users u ON u.id=t.driver_id
           WHERE t.org_id=$1 AND t.warehouse_id=$2
             AND ($3 = '' OR t.code ILIKE $4 OR u.name ILIKE $4 OR t.vehicle ILIKE $4)` +
            driverFilter +
            afterClause +
            " ORDER BY t.id" +
            limitClause,
          queryParams,
        )
      ).rows;
    } else if (entity === "issues") {
      const countRes = await db.query(
        `SELECT count(*)::int n FROM issues i
         LEFT JOIN boxes b ON b.id=i.box_id
         WHERE i.org_id=$1 AND i.warehouse_id=$2
           AND ($3 = '' OR i.kind ILIKE $4 OR b.code ILIKE $4 OR i.note ILIKE $4)`,
        [org, wh, q.trim(), term],
      );
      totalCount = countRes.rows[0].n;
      completeAggregates = { total: totalCount };

      items = (
        await db.query(
          `SELECT i.*, b.code box_code
           FROM issues i
           LEFT JOIN boxes b ON b.id=i.box_id
           WHERE i.org_id=$1 AND i.warehouse_id=$2
             AND ($3 = '' OR i.kind ILIKE $4 OR b.code ILIKE $4 OR i.note ILIKE $4)
             AND i.id > $5
           ORDER BY i.id
           LIMIT $6`,
          [org, wh, q.trim(), term, afterId, limit + 1],
        )
      ).rows;
    } else if (entity === "documents") {
      const countRes = await db.query(
        `SELECT count(*)::int n FROM documents
         WHERE org_id=$1 AND warehouse_id=$2
           AND ($3 = '' OR name ILIKE $4 OR mime ILIKE $4)`,
        [org, wh, q.trim(), term],
      );
      totalCount = countRes.rows[0].n;
      completeAggregates = { total: totalCount };

      items = (
        await db.query(
          `SELECT id, box_id, name, mime, size, created_at FROM documents
           WHERE org_id=$1 AND warehouse_id=$2
             AND ($3 = '' OR name ILIKE $4 OR mime ILIKE $4)
             AND id > $5
           ORDER BY id
           LIMIT $6`,
          [org, wh, q.trim(), term, afterId, limit + 1],
        )
      ).rows;
    }

    const hasMore = items.length > limit;
    const resultRows = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ entity, afterId: resultRows[resultRows.length - 1].id, q })).toString("base64url")
      : null;

    res.json({
      entity,
      query: q,
      totalCount,
      completeAggregates,
      count: resultRows.length,
      hasMore,
      nextCursor,
      items: resultRows,
    });
  });
  app.get("/api/v1/boxes/:id", async (req, res) => {
    requireRule(
      req.actor.role !== "driver",
      "FORBIDDEN",
      "Drivers access only assigned trip manifests",
      403,
    );
    res.json(await boxState(db, req.actor, String(req.params.id)));
  });
  app.post(
    "/api/v1/receipts",
    run(
      schemas.receipt,
      "receive",
      () => "receipt",
      (t, a, p) => services.receipt(t, a, p),
    ),
  );
  app.post(
    "/api/v1/boxes/:id/confirm-label",
    run(
      schemas.confirm,
      "receive",
      (r) => "confirm:" + r.params.id,
      (t, a, p, r) => services.confirm(t, a, String(r.params.id), p),
    ),
  );
  app.post(
    "/api/v1/boxes/:id/move",
    run(
      schemas.movement,
      "move",
      (r) => "move-box:" + r.params.id,
      (t, a, p, r) => services.move(t, a, "boxes", String(r.params.id), p),
    ),
  );
  app.post(
    "/api/v1/pallets/:id/move",
    run(
      schemas.movement,
      "move",
      (r) => "move-pallet:" + r.params.id,
      (t, a, p, r) => services.move(t, a, "pallets", String(r.params.id), p),
    ),
  );
  app.post(
    "/api/v1/pallets",
    run(
      schemas.palletCreate,
      "pack",
      () => "pallet-create",
      (t, a, p) => services.pallet(t, a, p),
    ),
  );
  for (const remove of [false, true])
    app.post(
      "/api/v1/pallets/:id/" + (remove ? "remove-boxes" : "add-boxes"),
      run(
        schemas.membership,
        "pack",
        (r) => (remove ? "remove:" : "add:") + r.params.id,
        (t, a, p, r) =>
          services.membership(t, a, String(r.params.id), p, remove),
      ),
    );
  app.post(
    "/api/v1/pallets/:id/verify",
    run(
      schemas.versioned,
      "pack",
      (r) => "verify:" + r.params.id,
      (t, a, p, r) => services.verifyPallet(t, a, String(r.params.id), p),
    ),
  );
  app.post(
    "/api/v1/orders",
    run(
      schemas.orderCreate,
      "order",
      () => "order-create",
      (t, a, p) => services.order(t, a, p),
    ),
  );
  app.post(
    "/api/v1/orders/:id/allocate",
    run(
      schemas.allocate,
      "prepare",
      (r) => "allocate:" + r.params.id,
      (t, a, p, r) => services.allocate(t, a, String(r.params.id), p),
    ),
  );
  app.post(
    "/api/v1/orders/:id/cancel",
    run(
      schemas.versioned.extend({ reason: z.string().min(3).max(500) }),
      "order",
      (r) => "cancel:" + r.params.id,
      (t, a, p, r) => services.cancel(t, a, String(r.params.id), p),
    ),
  );
  app.post(
    "/api/v1/preparation-batches",
    run(
      schemas.prepare,
      "prepare",
      () => "preparation-create",
      (t, a, p) => services.preparation(t, a, p),
    ),
  );
  app.post(
    "/api/v1/preparation-batches/:batchId/orders/:id/advance",
    run(
      schemas.advance,
      "prepare",
      (r) => "advance:" + r.params.id,
      (t, a, p, r) =>
        services.advance(
          t,
          a,
          String(r.params.batchId),
          String(r.params.id),
          p,
        ),
    ),
  );
  app.post(
    "/api/v1/trips",
    run(
      schemas.tripCreate,
      "dispatch",
      () => "trip-create",
      (t, a, p) => services.trip(t, a, p),
    ),
  );
  app.post(
    "/api/v1/shipments/:id/load",
    run(
      schemas.versioned.extend({ boxId: schemas.id }),
      "dispatch",
      (r) => "load:" + r.params.id,
      (t, a, p, r) => services.load(t, a, String(r.params.id), p),
    ),
  );
  app.post(
    "/api/v1/shipments/:id/dispatch",
    run(
      schemas.versioned.extend({
        partialApproved: z.boolean().optional(),
        reason: z.string().max(1000).optional(),
        addressOverride: z.boolean().optional(),
        addressOverrideReason: z.string().max(1000).optional(),
      }),
      "dispatch",
      (r) => "dispatch:" + r.params.id,
      (t, a, p, r) => services.dispatch(t, a, String(r.params.id), p),
    ),
  );
  app.post(
    "/api/v1/shipments/:id/handover",
    run(
      schemas.handover,
      "handover",
      (r) => "handover:" + r.params.id,
      (t, a, p, r) => services.handover(t, a, String(r.params.id), p),
    ),
  );
  app.post(
    "/api/v1/boxes/:id/repack",
    run(
      schemas.versioned.extend({
        contentsId: schemas.id,
        quantity: schemas.quantity,
        locationId: schemas.id,
        reason: z.string().min(3).max(500),
      }),
      "pack",
      (r) => "repack:" + r.params.id,
      (t, a, p, r) => services.repack(t, a, String(r.params.id), p),
    ),
  );
  app.post(
    "/api/v1/review-issues",
    run(
      schemas.reportIssue,
      "review",
      () => "issue-create",
      async (t, a, p) => {
        if (p.boxId) {
          await owned(t, "boxes", p.boxId, a, true);
          await invalidate(t, a, p.boxId);
        }
        const id = uuid();
        await t.query(
          "INSERT INTO issues(id,org_id,box_id,kind,note,warehouse_id) VALUES($1,$2,$3,$4,$5,$6)",
          [id, a.org_id, p.boxId, p.kind, p.note,a.warehouse_id],
        );
        await event(t, a, p.boxId || id, "issue.reported", {
          issueId: id,
          kind: p.kind,
          note: p.note,
        });
        return owned(t, "issues", id, a);
      },
    ),
  );
  app.post(
    "/api/v1/review-issues/:id/resolve",
    run(
      schemas.command.extend({ resolution: z.string().min(3).max(2000) }),
      "adjust",
      (r) => "resolve:" + r.params.id,
      async (t, a, p, r) => {
        const old = await owned(t, "issues", String(r.params.id), a, true);
        requireRule(
          old.status === "open",
          "ISSUE_STATE",
          "Issue is already resolved",
        );
        await t.query(
          "UPDATE issues SET status='resolved',resolution=$1 WHERE id=$2",
          [p.resolution, old.id],
        );
        await event(t, a, old.box_id || old.id, "issue.resolved", {
          issueId: old.id,
          resolution: p.resolution,
          stockAdjusted: false,
        });
        return owned(t, "issues", old.id, a);
      },
    ),
  );
  app.post(
    "/api/v1/trips/:id/reassign",
    run(
      schemas.versioned.extend({
        driverId: schemas.id,
        reason: z.string().min(3).max(500),
      }),
      "dispatch",
      (r) => "reassign:" + r.params.id,
      async (t, a, p, r) => {
        const trip = await owned(t, "trips", String(r.params.id), a, true);
        version(trip, p.expectedVersion);
        const driver = await owned(t, "users", p.driverId, a);
        requireRule(
          driver.role === "driver" && driver.active,
          "DRIVER_ROLE",
          "Choose an active driver",
        );
        await t.query(
          "UPDATE trips SET driver_id=$1,version=version+1 WHERE id=$2",
          [p.driverId, trip.id],
        );
        await event(t, a, trip.id, "trip.driver_reassigned", {
          from: trip.driver_id,
          to: p.driverId,
          reason: p.reason,
        });
        return owned(t, "trips", trip.id, a);
      },
    ),
  );
  app.post(
    "/api/v1/preparation-batches/:id/carry",
    run(
      schemas.versioned.extend({
        businessDate: z.iso.date(),
        reason: z.string().min(3).max(500),
      }),
      "prepare",
      (r) => "carry:" + r.params.id,
      async (t, a, p, r) => {
        const old = await owned(
          t,
          "preparations",
          String(r.params.id),
          a,
          true,
        );
        version(old, p.expectedVersion);
        await t.query(
          "UPDATE preparations SET business_date=$1,version=version+1 WHERE id=$2",
          [p.businessDate, old.id],
        );
        await event(t, a, old.id, "preparation.carried_forward", {
          from: old.business_date,
          to: p.businessDate,
          reason: p.reason,
        });
        return owned(t, "preparations", old.id, a);
      },
    ),
  );
  app.post(
    "/api/v1/orders/:id/unallocate",
    run(
      schemas.versioned.extend({
        boxId: schemas.id,
        reason: z.string().min(3).max(500),
      }),
      "prepare",
      (r) => "unallocate:" + r.params.id,
      async (t, a, p, r) => {
        const o = await owned(t, "orders", String(r.params.id), a, true);
        version(o, p.expectedVersion);
        const b = await owned(t, "boxes", p.boxId, a, true);
        requireRule(
          b.status === "confirmed",
          "CUSTODY_STATE",
          "Cannot unallocate dispatched goods",
        );
        requireRule(
          !(
            await t.query(
              "SELECT id FROM shipments WHERE order_id=$1 AND status NOT IN ('ready','needs_recheck','cancelled')",
              [o.id],
            )
          ).rows.length,
          "CUSTODY_STATE",
          "Shipment has left the warehouse",
        );
        await invalidate(t, a, b.id);
        await t.query(
          "DELETE FROM shipment_lines WHERE box_id=$1 AND shipment_id IN (SELECT id FROM shipments WHERE order_id=$2)",
          [b.id, o.id],
        );
        await t.query(
          "DELETE FROM allocations WHERE box_id=$1 AND order_id=$2",
          [b.id, o.id],
        );
        await t.query("UPDATE orders SET version=version+1 WHERE id=$1", [
          o.id,
        ]);
        await event(t, a, o.id, "stock.unallocated", {
          boxId: b.id,
          reason: p.reason,
        });
        return owned(t, "orders", o.id, a);
      },
    ),
  );
  const catalogSchemas: Record<string, z.ZodObject<any>> = {
    customers: z.object({
      code: z.string().min(1).max(80),
      name: z.string().min(1).max(200),
      name_zh: z.string().max(200).nullable(),
    }),
    destinations: z.object({
      customer_id: schemas.id.nullable(),
      name: z.string().min(1).max(200),
      address: z.string().max(1000).nullable(),
      verified: z.boolean(),
    }),
    products: importedProduct,
    locations: z.object({
      code: z.string().min(1).max(80),
      name: z.string().min(1).max(200),
      kind: z.enum(["floor", "rack", "shelf", "staging"]),
      restrictions: z.string().max(1000).nullable(),
    }),
    lots: z.object({
      product_id: schemas.id,
      reference: z.string().min(1).max(100),
      expires_on: z.iso.date().nullable(),
    }),
    tracking_marks: z.object({
      symbol: z.string().min(1).max(80),
      meaning: z.string().max(500).nullable(),
      scope: z.string().min(1).max(100),
    }),
  };
  app.post("/api/v1/catalogs/:kind", async (req, res) => {
    authorize(req.actor, "adjust");
    const table = String(req.params.kind);
    requireRule(catalogSchemas[table], "NOT_FOUND", "Catalogue not found", 404);
    const p = schemas.command
      .extend({ record: catalogSchemas[table] })
      .parse(req.body);
    res.json(
      await command(db, req.actor, "catalog:" + table, p, async (t) => {
        const id = uuid(),
          record = p.record as Record<string, any>;
        if(table==="locations")record.warehouse_id=req.actor.warehouse_id;
        if (table === "destinations")
          requireRule(
            !record.verified || !!record.address?.trim(),
            "ADDRESS_REQUIRED",
            "A verified destination needs an address",
          );
        if (record.customer_id)
          await owned(t, "customers", record.customer_id, req.actor);
        if (record.product_id)
          await owned(t, "products", record.product_id, req.actor);
        const keys = Object.keys(record);
        await t.query(
          `INSERT INTO ${table}(id,org_id,${keys.join(",")}) VALUES(${Array.from({ length: keys.length + 2 }, (_, i) => "$" + (i + 1)).join(",")})`,
          [id, req.actor.org_id, ...Object.values(record)],
        );
        await event(t, req.actor, id, table + ".created", record);
        return owned(t, table, id, req.actor);
      }),
    );
  });
  app.post(
    "/api/v1/destination-authorizations",
    run(
      schemas.command.extend({
        customerId: schemas.id,
        destinationId: schemas.id,
        reason: z.string().min(3).max(1000),
      }),
      "adjust",
      () => "destination-authorize",
      async (t, a, p) => {
        await owned(t, "customers", p.customerId, a);
        await owned(t, "destinations", p.destinationId, a);
        const id = uuid();
        await t.query(
          "INSERT INTO destination_authorizations(id,org_id,customer_id,destination_id,reason) VALUES($1,$2,$3,$4,$5)",
          [id, a.org_id, p.customerId, p.destinationId, p.reason],
        );
        await event(t, a, id, "destination.authorized", {
          customerId: p.customerId,
          destinationId: p.destinationId,
          reason: p.reason,
        });
        return owned(t, "destination_authorizations", id, a);
      },
    ),
  );
  app.post(
    "/api/v1/boxes/:id/condition",
    run(
      schemas.versioned.extend({
        condition: z.enum(["good", "damaged", "hold"]),
        reason: z.string().min(3).max(1000),
      }),
      "adjust",
      (r) => "box-condition:" + r.params.id,
      async (t, a, p, r) => {
        const b = await owned(t, "boxes", String(r.params.id), a, true);
        version(b, p.expectedVersion);
        requireRule(
          !["dispatched", "delivered", "returned"].includes(b.status),
          "CUSTODY_STATE",
          "Use return disposition for goods in delivery custody",
        );
        const contents = (
          await t.query("SELECT verified FROM contents WHERE box_id=$1", [b.id])
        ).rows;
        await invalidate(t, a, b.id);
        await t.query(
          "UPDATE boxes SET condition=$1,status=$2,version=version+1 WHERE id=$3",
          [
            p.condition,
            p.condition === "good" &&
            contents.length &&
            contents.every((c) => c.verified)
              ? "confirmed"
              : "hold",
            b.id,
          ],
        );
        await event(t, a, b.id, "box.condition_adjusted", {
          from: b.condition,
          to: p.condition,
          reason: p.reason,
        });
        return boxState(t, a, b.id);
      },
    ),
  );
  app.post(
    "/api/v1/orders/:id/amend",
    run(
      schemas.versioned.extend({
        orderLineId: schemas.id,
        quantity: schemas.quantity,
        reason: z.string().min(3).max(1000),
      }),
      "order",
      (r) => "order-amend:" + r.params.id,
      async (t, a, p, r) => {
        const o = await owned(t, "orders", String(r.params.id), a, true);
        version(o, p.expectedVersion);
        requireRule(
          o.status === "open",
          "ORDER_STATE",
          "Only open orders can be amended",
        );
        requireRule(
          !(
            await t.query(
              "SELECT id FROM shipments WHERE order_id=$1 AND status IN ('dispatched','partial','completed')",
              [o.id],
            )
          ).rows.length,
          "CUSTODY_STATE",
          "Create a new order for goods already in delivery custody",
        );
        const line = await owned(t, "order_lines", p.orderLineId, a, true);
        requireRule(
          line.order_id === o.id,
          "ORDER_LINE",
          "Line belongs to another order",
        );
        const allocated = (
          await t.query(
            "SELECT COALESCE(sum(quantity),0)::text total FROM allocations WHERE order_line_id=$1",
            [line.id],
          )
        ).rows[0].total;
        const Decimal = (await import("decimal.js")).default;
        requireRule(
          new Decimal(p.quantity).gte(allocated),
          "UNALLOCATE_FIRST",
          "Release excess allocations before reducing demand",
        );
        await t.query("UPDATE order_lines SET quantity=$1 WHERE id=$2", [
          p.quantity,
          line.id,
        ]);
        await t.query("UPDATE orders SET version=version+1 WHERE id=$1", [
          o.id,
        ]);
        await t.query(
          "UPDATE preparation_orders SET checked=false,stage=CASE WHEN stage='ready' THEN 'checking' ELSE stage END WHERE order_id=$1",
          [o.id],
        );
        await t.query(
          "UPDATE shipments SET status='needs_recheck',version=version+1 WHERE order_id=$1 AND status IN ('ready','needs_recheck')",
          [o.id],
        );
        await t.query(
          "UPDATE shipment_lines SET loaded=false WHERE shipment_id IN (SELECT id FROM shipments WHERE order_id=$1)",
          [o.id],
        );
        await event(t, a, o.id, "order.amended", {
          lineId: line.id,
          from: line.quantity,
          to: p.quantity,
          unit: line.unit,
          reason: p.reason,
          recheckRequired: true,
        });
        return owned(t, "orders", o.id, a);
      },
    ),
  );
  app.post(
    "/api/v1/preparation-batches/:id/add-orders",
    run(
      schemas.versioned.extend({
        orderIds: z.array(schemas.id).min(1).max(100),
      }),
      "prepare",
      (r) => "prep-add:" + r.params.id,
      async (t, a, p, r) => {
        const b = await owned(t, "preparations", String(r.params.id), a, true);
        version(b, p.expectedVersion);
        for (const id of [...new Set<string>(p.orderIds)].sort()) {
          const o = await owned(t, "orders", id, a, true);
          requireRule(
            o.status === "open",
            "ORDER_STATE",
            "Choose an open order",
          );
          requireRule(
            !(
              await t.query(
                "SELECT order_id FROM preparation_orders WHERE order_id=$1",
                [id],
              )
            ).rows.length,
            "ALREADY_PLANNED",
            "Order already belongs to a batch",
            409,
          );
          await t.query(
            "INSERT INTO preparation_orders(preparation_id,order_id) VALUES($1,$2)",
            [b.id, id],
          );
        }
        await t.query("UPDATE preparations SET version=version+1 WHERE id=$1", [
          b.id,
        ]);
        await event(t, a, b.id, "preparation.orders_added", {
          orderIds: p.orderIds,
        });
        return owned(t, "preparations", b.id, a);
      },
    ),
  );
  app.post(
    "/api/v1/preparation-batches/:id/remove-order",
    run(
      schemas.versioned.extend({
        orderId: schemas.id,
        reason: z.string().min(3).max(1000),
      }),
      "prepare",
      (r) => "prep-remove:" + r.params.id,
      async (t, a, p, r) => {
        const b = await owned(t, "preparations", String(r.params.id), a, true);
        version(b, p.expectedVersion);
        await owned(t, "orders", p.orderId, a, true);
        const po = (
          await t.query(
            "SELECT * FROM preparation_orders WHERE preparation_id=$1 AND order_id=$2 FOR UPDATE",
            [b.id, p.orderId],
          )
        ).rows[0];
        requireRule(
          po?.stage === "selected",
          "PROCESSING_STARTED",
          "Only an order whose processing has not started can be removed",
        );
        requireRule(
          !(
            await t.query("SELECT id FROM allocations WHERE order_id=$1", [
              p.orderId,
            ])
          ).rows.length,
          "UNALLOCATE_FIRST",
          "Release allocations before removing this order",
        );
        await t.query(
          "DELETE FROM preparation_orders WHERE preparation_id=$1 AND order_id=$2",
          [b.id, p.orderId],
        );
        await t.query("UPDATE preparations SET version=version+1 WHERE id=$1", [
          b.id,
        ]);
        await event(t, a, b.id, "preparation.order_removed", {
          orderId: p.orderId,
          reason: p.reason,
        });
        return owned(t, "preparations", b.id, a);
      },
    ),
  );
  app.post(
    "/api/v1/counts",
    run(
      schemas.command.extend({
        locationId: schemas.id,
        observedCodes: z.array(z.string().min(1).max(120)).max(1000),
      }),
      "review",
      () => "count-create",
      async (t, a, p) => {
        await owned(t, "locations", p.locationId, a);
        const id = uuid();
        const expected = (
          await t.query(
            "SELECT b.code FROM boxes b LEFT JOIN pallets pal ON pal.id=b.pallet_id WHERE b.org_id=$1 AND COALESCE(b.location_id,pal.location_id)=$2 AND b.status NOT IN ('dispatched','delivered') ORDER BY b.code,b.id",
            [a.org_id, p.locationId],
          )
        ).rows.map((r) => r.code);
        await t.query(
          "INSERT INTO counts(id,org_id,location_id,expected_codes,status) VALUES($1,$2,$3,$4,$5)",
          [id, a.org_id, p.locationId, JSON.stringify(expected), "submitted"],
        );
        const observed = [...new Set<string>(p.observedCodes)];
        for (const code of observed)
          await t.query(
            "INSERT INTO count_observations(id,org_id,count_id,box_code,actor_id) VALUES($1,$2,$3,$4,$5)",
            [uuid(), a.org_id, id, code, a.id],
          );
        const missing = expected.filter((code) => !observed.includes(code)),
          unexpected = observed.filter((code) => !expected.includes(code));
        if (missing.length || unexpected.length)
          await t.query(
            "INSERT INTO issues(id,org_id,kind,note,warehouse_id) VALUES($1,$2,$3,$4,$5)",
            [
              uuid(),
              a.org_id,
              "count discrepancy",
              JSON.stringify({
                countId: id,
                locationId: p.locationId,
                missing,
                unexpected,
              }),
              a.warehouse_id,
            ],
          );
        await event(t, a, id, "count.submitted", {
          locationId: p.locationId,
          expected,
          observed,
          missing,
          unexpected,
          stockAdjusted: false,
        });
        return {
          id,
          status: "submitted",
          missing,
          unexpected,
          observedCount: observed.length,
          stockAdjusted: false,
        };
      },
    ),
  );
  app.post(
    "/api/v1/returns/:id/disposition",
    run(
      schemas.versioned.extend({
        disposition: z.enum(["release", "quarantine"]),
        locationId: schemas.id,
        reason: z.string().min(3).max(1000),
      }),
      "adjust",
      (r) => "return-disposition:" + r.params.id,
      async (t, a, p, r) => {
        const b = await owned(t, "boxes", String(r.params.id), a, true);
        version(b, p.expectedVersion);
        requireRule(
          b.status === "returned",
          "RETURN_STATE",
          "Only returned boxes can be dispositioned",
        );
        await owned(t, "locations", p.locationId, a);
        const lines = (
          await t.query(
            "SELECT * FROM shipment_lines WHERE box_id=$1 ORDER BY id FOR UPDATE",
            [b.id],
          )
        ).rows;
        const ct = (
          await t.query("SELECT * FROM contents WHERE box_id=$1 FOR UPDATE", [
            b.id,
          ])
        ).rows;
        requireRule(
          ct.length === 1 && lines.length === 1,
          "RETURN_RECONCILIATION",
          "Mixed returns require a supervised quantity reconciliation",
        );
        const returned = lines[0].returned;
        requireRule(
          Number(returned) > 0,
          "NO_RETURN",
          "No returned quantity was recorded",
        );
        if (b.pallet_id)
          await t.query(
            "UPDATE pallets SET manifest_revision=manifest_revision+1,checked_revision=NULL,version=version+1 WHERE id=$1",
            [b.pallet_id],
          );
        await t.query("DELETE FROM allocations WHERE box_id=$1", [b.id]);
        await t.query("UPDATE contents SET quantity=$1 WHERE id=$2", [
          returned,
          ct[0].id,
        ]);
        await t.query(
          "UPDATE boxes SET pallet_id=NULL,location_id=$1,status=$2,condition=$3,version=version+1 WHERE id=$4",
          [
            p.locationId,
            p.disposition === "release" ? "confirmed" : "hold",
            p.disposition === "release" ? "good" : "hold",
            b.id,
          ],
        );
        await t.query(
          "UPDATE issues SET status='resolved',resolution=$1 WHERE box_id=$2 AND kind='return disposition' AND status='open'",
          [p.reason, b.id],
        );
        await event(t, a, b.id, "return.dispositioned", {
          disposition: p.disposition,
          quantity: returned,
          unit: ct[0].unit,
          locationId: p.locationId,
          reason: p.reason,
          previousContentsQuantity: ct[0].quantity,
        });
        return boxState(t, a, b.id);
      },
    ),
  );
  app.post(
    "/api/v1/orders/:id/pick-loose",
    run(
      schemas.loosePick,
      "prepare",
      (r) => "loose-pick:" + r.params.id,
      (t, a, p, r) => services.loosePick(t, a, String(r.params.id), p),
    ),
  );
  app.post(
    "/api/v1/products/:id/traceability",
    run(
      schemas.traceability,
      "configure",
      (r) => "traceability:" + r.params.id,
      (t, a, p, r) =>
        services.configureTraceability(t, a, String(r.params.id), p),
    ),
  );
  app.post(
    "/api/v1/destinations/:id/verify-address",
    run(
      schemas.versioned.extend({
        address: z.string().trim().min(3).max(1000),
        reason: z.string().min(3).max(1000),
      }),
      "adjust",
      (r) => "verify-address:" + r.params.id,
      async (t, a, p, r) => {
        const d = await owned(t, "destinations", String(r.params.id), a, true);
        version(d, p.expectedVersion);
        await t.query(
          "UPDATE destinations SET address=$1,verified=true,version=version+1 WHERE id=$2",
          [p.address, d.id],
        );
        await event(t, a, d.id, "destination.address_verified", {
          before: { address: d.address, verified: d.verified },
          address: p.address,
          reason: p.reason,
        });
        return owned(t, "destinations", d.id, a);
      },
    ),
  );
  app.post("/api/v1/company-configuration", run(schemas.companyConfiguration,"configure",()=>"company-configuration",(t,a,p)=>configureCompany(t,a,p)));
  app.get("/api/v1/company-configuration/history", async(req,res)=>{
    authorize(req.actor,"configure");
    res.json((await db.query("SELECT * FROM company_configuration_revisions WHERE org_id=$1 ORDER BY version DESC LIMIT 100",[req.actor.org_id])).rows);
  });
  app.get("/api/v1/access/directory",async(req,res)=>res.json(await accessDirectory(db,req.actor)));
  app.post("/api/v1/access/staff",run(schemas.staffProvision,"manage_access",()=>"access-staff",(t,a,p)=>provisionStaff(t,a,p)));
  app.post("/api/v1/access/memberships",run(schemas.membershipChange,"manage_access",()=>"access-membership",(t,a,p)=>changeMembership(t,a,p)));
  app.post("/api/v1/warehouses",run(schemas.warehouseCreate,"manage_access",()=>"warehouse-create",(t,a,p)=>createWarehouse(t,a,p)));
  app.post("/api/v1/warehouses/:id/review",run(schemas.warehouseReview,"manage_access",r=>"warehouse-review:"+r.params.id,(t,a,p,r)=>reviewWarehouse(t,a,String(r.params.id),p)));
  app.post("/api/v1/access/warehouse-grants",run(schemas.warehouseGrant,"manage_access",()=>"access-warehouse",(t,a,p)=>changeWarehouseGrant(t,a,p)));
  app.post('/api/v1/imports/products/preview',run(productImportPreview,'configure',()=> 'import-products-preview',(t,a,p)=>previewProductImport(t,a,p)));
  app.post('/api/v1/imports/products/:id/commit',run(productImportCommit,'configure',r=>'import-products-commit:'+r.params.id,(t,a,p,r)=>commitProductImport(t,a,String(r.params.id),p)));
  app.get('/api/v1/imports/products',async(req,res)=>res.json(await listProductImports(db,req.actor,typeof req.query.before==='string'?req.query.before:undefined)));
  app.get('/api/v1/imports/products/:id',async(req,res)=>res.json(await reviewProductImport(db,req.actor,String(req.params.id))));
  app.get('/api/v1/imports/products/:id/errors.csv',async(req,res)=>{const report=await reviewProductImport(db,req.actor,String(req.params.id));res.type('text/csv').setHeader('Content-Disposition','attachment; filename="product-import-errors.csv"');res.send(errorCsv(report));});
  app.get('/api/v1/pallet-groups',async(req,res)=>res.json(await palletGroupList(db,req.actor)));
  app.get('/api/v1/inbound',async(req,res)=>res.json(await inboundList(db,req.actor)));
  app.post('/api/v1/suppliers',run(supplierCreate,'configure',()=> 'supplier-create',(t,a,p)=>createSupplier(t,a,p)));
  app.post('/api/v1/expected-receipts',run(expectedCreate,'receive',()=> 'expected-create',(t,a,p)=>createExpectedReceipt(t,a,p)));
  app.post('/api/v1/expected-receipts/:id/receive',run(expectedReceive,'receive',r=>'expected-receive:'+r.params.id,(t,a,p,r)=>receiveExpectedBox(t,a,String(r.params.id),p)));
  app.post('/api/v1/expected-receipts/:id/cancel',run(expectedCancel,'adjust',r=>'expected-cancel:'+r.params.id,(t,a,p,r)=>cancelExpectedReceipt(t,a,String(r.params.id),p)));
  app.get('/api/v1/pallet-groups/:id/reconciliation',async(req,res)=>res.json(await palletGroupReconciliation(db,req.actor,String(req.params.id),req.query.cursor)));
  app.post('/api/v1/pallet-groups',run(schemas.palletGroupCreate,'dispatch',()=> 'pallet-group-create',(t,a,p)=>createPalletGroup(t,a,p)));
  app.post('/api/v1/pallet-groups/:id/add',run(schemas.palletGroupChange,'dispatch',r=>'pallet-group-add:'+r.params.id,(t,a,p,r)=>changePalletGroup(t,a,String(r.params.id),p,false)));
  app.post('/api/v1/pallet-groups/:id/remove',run(schemas.palletGroupChange,'dispatch',r=>'pallet-group-remove:'+r.params.id,(t,a,p,r)=>changePalletGroup(t,a,String(r.params.id),p,true)));

  // --- P1 Stock Owners & Inventory Balances / Ledger ---
  app.get("/api/v1/stock-owners", async (req, res) => res.json(await listStockOwners(db, req.actor)));
  app.post("/api/v1/stock-owners", run(ownerCreate, "configure", () => "stock-owner-create", (t, a, p) => createStockOwner(t, a, p)));
  app.get("/api/v1/inventory/owners", async (req, res) => res.json({ owners: await listStockOwners(db, req.actor) }));
  app.post("/api/v1/inventory/owners", run(ownerCreate, "configure", () => "owner-create", (t, a, p) => createStockOwner(t, a, p)));
  app.get("/api/v1/inventory/balances", async (req, res) => res.json(await getInventoryBalances(db, req.actor, {
    productId: typeof req.query.productId === "string" ? req.query.productId : undefined,
    locationId: typeof req.query.locationId === "string" ? req.query.locationId : undefined,
    ownerId: typeof req.query.ownerId === "string" ? req.query.ownerId : undefined,
  })));
  app.get("/api/v1/inventory/ledger", async (req, res) => res.json(await getInventoryLedger(db, req.actor, {
    productId: typeof req.query.productId === "string" ? req.query.productId : undefined,
    locationId: typeof req.query.locationId === "string" ? req.query.locationId : undefined,
    ownerId: typeof req.query.ownerId === "string" ? req.query.ownerId : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  })));
  app.post("/api/v1/inventory/adjust", run(inventoryAdjust, "adjust", () => "inventory-adjust", (t, a, p) => adjustInventory(t, a, p)));
  app.post("/api/v1/inventory/move/:id", run(inventoryMove, "adjust", (r) => "inventory-move:" + r.params.id, (t, a, p, r) => moveInventory(t, a, String(r.params.id), p)));
  app.post("/api/v1/inventory/reserve", run(inventoryReserve, "prepare", () => "inventory-reserve", (t, a, p) => reserveInventory(t, a, p)));
  app.post("/api/v1/inventory/release", run(inventoryRelease, "prepare", () => "inventory-release", (t, a, p) => releaseInventory(t, a, p)));
  app.get("/api/v1/products/:id/conversions", async (req, res) => res.json(await listUnitConversions(db, req.actor, String(req.params.id))));
  app.post("/api/v1/products/:id/conversions", run(unitConversionCreate, "configure", (r) => "unit-conversion:" + r.params.id, (t, a, p, r) => createUnitConversion(t, a, String(r.params.id), p)));

  // --- P1 Multi-line Purchase Orders ---
  app.get("/api/v1/purchase-orders", async (req, res) => res.json(await listPurchaseOrders(db, req.actor)));
  app.get("/api/v1/purchase-orders/:id", async (req, res) => res.json(await getPurchaseOrder(db, req.actor, String(req.params.id))));
  app.post("/api/v1/purchase-orders", run(purchaseOrderCreate, "receive", () => "po-create", (t, a, p) => createPurchaseOrder(t, a, p)));
  app.post("/api/v1/purchase-orders/:id/receive", run(purchaseOrderReceive, "receive", (r) => "po-receive:" + r.params.id, (t, a, p, r) => receivePurchaseOrderLine(t, a, String(r.params.id), p)));
  app.post("/api/v1/purchase-orders/:id/cancel", run(purchaseOrderCancel, "adjust", (r) => "po-cancel:" + r.params.id, (t, a, p, r) => cancelPurchaseOrder(t, a, String(r.params.id), p)));

  // --- P1 Inbound Discrepancies ---
  app.get("/api/v1/discrepancies", async (req, res) => res.json(await listDiscrepancies(db, req.actor, typeof req.query.status === "string" ? req.query.status : undefined)));
  app.get("/api/v1/discrepancies/:id", async (req, res) => res.json(await owned(db, "inbound_discrepancies", String(req.params.id), req.actor)));
  app.post("/api/v1/discrepancies", run(discrepancyReport, "receive", () => "discrepancy-report", (t, a, p) => reportDiscrepancy(t, a, p)));
  app.post("/api/v1/discrepancies/:id/review", run(discrepancyReview, "adjust", (r) => "discrepancy-review:" + r.params.id, (t, a, p, r) => reviewDiscrepancy(t, a, String(r.params.id), p)));

  // --- P1 Supplier Returns ---
  app.get("/api/v1/supplier-returns", async (req, res) => res.json(await listSupplierReturns(db, req.actor)));
  app.post("/api/v1/supplier-returns", run(supplierReturnCreate, "adjust", () => "supplier-return-create", (t, a, p) => createSupplierReturn(t, a, p)));
  app.post("/api/v1/supplier-returns/:id/authorize", run(supplierReturnAuthorize, "adjust", (r) => "supplier-return-auth:" + r.params.id, (t, a, p, r) => authorizeSupplierReturn(t, a, String(r.params.id), p)));
  app.post("/api/v1/supplier-returns/:id/dispatch", run(supplierReturnDispatch, "dispatch", (r) => "supplier-return-disp:" + r.params.id, (t, a, p, r) => dispatchSupplierReturn(t, a, String(r.params.id), p)));

  // --- P1 Putaway & Replenishment Tasks ---
  app.get("/api/v1/tasks", async (req, res) => res.json(await listTasks(db, req.actor, {
    kind: typeof req.query.kind === "string" ? req.query.kind : undefined,
    status: typeof req.query.status === "string" ? req.query.status : undefined,
  })));
  app.post("/api/v1/tasks/putaway", run(putawayTaskCreate, "receive", () => "task-putaway-create", (t, a, p) => createPutawayTask(t, a, p)));
  app.post("/api/v1/tasks/:id/assign", run(taskAssign, "prepare", (r) => "task-assign:" + r.params.id, (t, a, p, r) => assignTask(t, a, String(r.params.id), p)));
  app.post("/api/v1/tasks/:id/complete", run(taskComplete, "prepare", (r) => "task-complete:" + r.params.id, (t, a, p, r) => completeTask(t, a, String(r.params.id), p)));
  app.post("/api/v1/tasks/:id/cancel", run(taskCancel, "prepare", (r) => "task-cancel:" + r.params.id, (t, a, p, r) => cancelTask(t, a, String(r.params.id), p)));
  app.get("/api/v1/replenishment-policies", async (req, res) => res.json(await listReplenishmentPolicies(db, req.actor)));
  app.post("/api/v1/replenishment-policies", run(replenishmentPolicySet, "configure", () => "replenishment-policy-set", (t, a, p) => setReplenishmentPolicy(t, a, p)));
  app.post("/api/v1/replenishment/trigger", run(replenishmentTrigger, "prepare", () => "replenishment-trigger", (t, a, p) => triggerReplenishment(t, a, p)));

  // --- P1 Inter-Warehouse Transfers ---
  app.get("/api/v1/transfers", async (req, res) => res.json(await listTransferOrders(db, req.actor)));
  app.get("/api/v1/transfers/:id", async (req, res) => res.json(await getTransferOrder(db, req.actor, String(req.params.id))));
  app.post("/api/v1/transfers", run(transferOrderCreate, "dispatch", () => "transfer-create", (t, a, p) => createTransferOrder(t, a, p)));
  app.post("/api/v1/transfers/:id/dispatch", run(transferOrderDispatch, "dispatch", (r) => "transfer-dispatch:" + r.params.id, (t, a, p, r) => dispatchTransferOrder(t, a, String(r.params.id), p)));
  app.post("/api/v1/transfers/:id/receive", run(transferOrderReceive, "receive", (r) => "transfer-receive:" + r.params.id, (t, a, p, r) => receiveTransferOrder(t, a, String(r.params.id), p)));
  app.post("/api/v1/transfers/:id/cancel", run(transferOrderCancel, "adjust", (r) => "transfer-cancel:" + r.params.id, (t, a, p, r) => cancelTransferOrder(t, a, String(r.params.id), p)));

  // --- P1 Multi-Entity CSV Imports ---
  app.get("/api/v1/csv-imports", async (req, res) => res.json(await listCsvImports(db, req.actor, typeof req.query.entityType === "string" ? req.query.entityType : undefined)));
  app.get("/api/v1/csv-imports/:id", async (req, res) => res.json(await reviewCsvImport(db, req.actor, String(req.params.id))));
  app.post("/api/v1/csv-imports/preview", run(csvImportPreview, "configure", () => "csv-import-preview", (t, a, p) => previewCsvImport(t, a, p)));
  app.post("/api/v1/csv-imports/:id/commit", run(csvImportCommit, "configure", (r) => "csv-import-commit:" + r.params.id, (t, a, p, r) => commitCsvImport(t, a, String(r.params.id), p)));
  app.get("/api/v1/csv-imports/:id/errors.csv", async (req, res) => {
    const csv = await exportCsvImportErrors(db, req.actor, String(req.params.id));
    res.type("text/csv").setHeader("Content-Disposition", 'attachment; filename="import-errors.csv"');
    res.send(csv);
  });

  // --- P1 Guided Resumable Onboarding & Readiness Review ---
  app.get("/api/v1/onboarding", async (req, res) => res.json(await getWarehouseOnboarding(db, req.actor)));
  app.post("/api/v1/onboarding/step", run(onboardingStepSave, "configure", () => "onboarding-step", (t, a, p) => saveOnboardingStep(t, a, p)));
  app.post("/api/v1/onboarding/review", run(onboardingReviewComplete, "configure", () => "onboarding-review", (t, a, p) => completeOnboardingReview(t, a, p)));

  app.get('/api/v1/ai/status',async(req,res)=>{authorize(req.actor,'receive');res.json(await ocrStatus())});
  app.post('/api/v1/documents/:id/extract',run(schemas.extractionRequest,'receive',r=>'extract:'+r.params.id,async(t,a,p,r)=>{
    const doc=await owned(t,'documents',String(r.params.id),a);requireRule(['image/jpeg','image/png','image/webp'].includes(doc.mime),'OCR_TYPE','Select a JPEG, PNG or WebP image',422);
    const status=await ocrStatus();requireRule(status[p.provider as 'local'|'gemini'].configured,'OCR_NOT_CONFIGURED','Selected OCR provider is not configured',422);
    const id=uuid();await t.query("INSERT INTO jobs(id,org_id,actor_id,kind,warehouse_id,payload) VALUES($1,$2,$3,'ocr-extraction',$4,$5)",[id,a.org_id,a.id,a.warehouse_id,JSON.stringify({documentId:doc.id,provider:p.provider,sourceHash:doc.sha256,externalTransferConfirmed:p.confirmExternalTransfer})]);
    await event(t,a,doc.box_id||doc.id,'document.extraction_requested',{jobId:id,documentId:doc.id,provider:p.provider,externalTransferConfirmed:p.confirmExternalTransfer});return {id,status:'queued'};
  }));
  app.get('/api/v1/extractions/:id',async(req,res)=>{authorize(req.actor,'receive');const j=await owned(db,'jobs',String(req.params.id),req.actor);requireRule(j.kind==='ocr-extraction','NOT_FOUND','Extraction not found',404);await owned(db,'documents',j.payload.documentId,req.actor);res.json({id:j.id,status:j.status,attempts:j.attempts,error:j.error,result:j.status==='completed'?j.result:null})});
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (
        !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(
          file.mimetype,
        )
      )
        return cb(
          new DomainError(422, "UPLOAD_TYPE", "Use JPEG, PNG, WebP or PDF"),
        );
      cb(null, true);
    },
  });
  app.post(
    "/api/v1/boxes/:id/photo",
    (req, _res, next) => {
      authorize(req.actor, "receive");
      next();
    },
    upload.single("file"),
    async (req, res) => {
      const bid = String(req.params.id);
      await owned(db, "boxes", bid, req.actor);
      requireRule(req.file, "FILE_REQUIRED", "Select a file");
      const file = req.file;
      const buf = file.buffer;
      const valid =
        file.mimetype === "image/jpeg"
          ? buf[0] === 255 && buf[1] === 216
          : file.mimetype === "image/png"
            ? buf
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : file.mimetype === "image/webp"
              ? buf.toString("ascii", 0, 4) === "RIFF" &&
                buf.toString("ascii", 8, 12) === "WEBP"
              : buf.toString("ascii", 0, 5) === "%PDF-";
      requireRule(
        valid,
        "UPLOAD_SIGNATURE",
        "File contents do not match its declared type",
      );
      const p = schemas.command.parse(req.body),
        id = uuid(),
        key = uuid();
      await storage.write(key, buf);
      try {
        const result = await command(
          db,
          req.actor,
          "photo:" + bid,
          {
            ...p,
            hash: createHash("sha256").update(buf).digest("hex"),
            mime: file.mimetype,
          },
          async (t) => {
            await t.query(
              "INSERT INTO documents(id,org_id,box_id,name,storage_key,mime,sha256,size) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
              [
                id,
                req.actor.org_id,
                bid,
                path.basename(file.originalname).slice(0, 200),
                key,
                file.mimetype,
                createHash("sha256").update(buf).digest("hex"),
                file.size,
              ],
            );
            await event(t, req.actor, bid, "box.photo_attached", {
              documentId: id,
            });
            return { id, name: file.originalname };
          },
        );
        if (result.id !== id) await storage.remove(key);
        res.json(result);
      } catch (e) {
        await storage.remove(key).catch(() => {});
        throw e;
      }
    },
  );
  app.get("/api/v1/documents/:id/file", async (req, res) => {
    const doc = await owned(db, "documents", String(req.params.id), req.actor);
    requireRule(
      req.actor.role !== "driver",
      "FORBIDDEN",
      "Drivers cannot access source documents",
      403,
    );
    let bytes;
    try {
      bytes = await storage.read(doc.storage_key);
    } catch {
      throw new DomainError(
        503,
        "FILE_UNAVAILABLE",
        "Private file is unavailable. Restore the file volume or retry.",
      );
    }
    res.setHeader("Content-Type", doc.mime);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="document${doc.mime === "application/pdf" ? ".pdf" : ".image"}"`,
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(bytes);
  });
  app.get('/api/v1/orders/:id/worker-sheet', async(req,res)=>{
    const html=await db.transaction(async t=>{if(t.native)await t.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return workerOrderSheet(t,req.actor,String(req.params.id))});
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options','nosniff');res.type('html').send(html);
  });
  app.get("/api/v1/labels/:kind/:id", async (req, res) => {
    requireRule(
      req.actor.role !== "driver",
      "FORBIDDEN",
      "Drivers cannot export labels",
      403,
    );
    const table = { box: "boxes", pallet: "pallets", location: "locations" }[
      String(req.params.kind)
    ];
    requireRule(table, "NOT_FOUND", "Label type not found", 404);
    const row = await owned(db, table, String(req.params.id), req.actor);
    const company = await configuration(db, req.actor);
    const escape = (s: string) =>
      s.replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c]!,
      );
    res
      .type("html")
      .send(
        `<!doctype html><html><head><title>${escape(row.code)}</title></head><body><main style="font:24px system-ui;border:2px solid;padding:32px;max-width:480px"><p>${escape(company.display_name)} · ${demo ? "SYNTHETIC DEMO" : "INTERNAL"}</p><p>${escape(String(req.params.kind).toUpperCase())} ID</p><h1>${escape(row.code)}</h1><p>Internal identifier · scan decoding unavailable</p><p>Use your browser Print command.</p></main></body></html>`,
      );
  });
  app.post(
    "/api/v1/jobs",
    run(
      schemas.command.extend({ kind: z.literal("inventory-export") }),
      "export",
      () => "export",
      async (t, a, p) => {
        const id = uuid();
        await t.query(
          "INSERT INTO jobs(id,org_id,actor_id,kind,warehouse_id) VALUES($1,$2,$3,$4,$5)",
          [id, a.org_id, a.id, p.kind,a.warehouse_id],
        );
        return { id, status: "queued" };
      },
    ),
  );
  app.get("/api/v1/jobs/:id/result", async (req, res) => {
    authorize(req.actor, "export");
    const job = await owned(db, "jobs", String(req.params.id), req.actor);
    requireRule(job.kind === "inventory-export", "NOT_FOUND", "Export not found", 404);
    requireRule(
      job.status === "completed",
      "JOB_NOT_READY",
      "Export is not complete",
      409,
    );
    res.json(job.result);
  });
  app.use("/api", (_req, _res, next) =>
    next(new DomainError(404, "NOT_FOUND", "API route not found")),
  );
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const zerr = err instanceof z.ZodError;
    const status = zerr
      ? 422
      : err instanceof DomainError
        ? err.status
        : err.code === "23505"
          ? 409
          : err.code === "LIMIT_FILE_SIZE"
            ? 413
            : 500;
    const message = zerr
      ? err.issues
          .map((i: any) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")
      : status === 500
        ? "Server could not complete the operation. Your pending work remains."
        : err.message;
    console.error(
      JSON.stringify({
        requestId: req.requestId,
        status,
        code: err.code || err.name,
      }),
    );
    res.status(status).json({
      error: {
        code: zerr ? "VALIDATION" : err.code || "SERVER_ERROR",
        message,
        details: err.details,
      },
      requestId: req.requestId,
    });
  });
  return app;
}
