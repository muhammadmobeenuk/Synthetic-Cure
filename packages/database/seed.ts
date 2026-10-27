import type { DB } from "./index.js";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
export async function seed(db: DB) {
  const prod = process.env.NODE_ENV === "production";
  const org = prod ? (process.env.COMPANY_ID || "jadesun") : "demo";
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(org))throw new Error("COMPANY_ID must be a stable code using letters, digits, hyphens or underscores");
  if (
    prod &&
    (!process.env.ADMIN_EMAIL ||
      !process.env.ADMIN_PASSWORD ||
      process.env.ADMIN_PASSWORD.length < 12)
  )
    throw new Error(
      "Set ADMIN_EMAIL and ADMIN_PASSWORD (12+ chars) to provision production",
    );
  if (
    (await db.query("SELECT id FROM organizations WHERE id=$1", [org])).rows
      .length
  )
    return;
  await db.transaction(async (t) => {
    await t.query("INSERT INTO organizations VALUES($1,$2,$3)", [
      org,
      prod ? (process.env.COMPANY_NAME || "Company · setup required") : "Synthetic Cure · Synthetic demo",
      !prod,
    ]);
    const hasOwners = (await t.query("SELECT 1 FROM information_schema.tables WHERE table_name='stock_owners' AND table_schema='public'")).rows.length > 0;
    if (hasOwners) {
      await t.query("INSERT INTO stock_owners(id, org_id, code, name) VALUES($1, $2, 'DEFAULT', $3) ON CONFLICT DO NOTHING", [
        org + ":default_owner",
        org,
        "Primary Owner · " + (prod ? (process.env.COMPANY_NAME || "Company") : "Synthetic Cure"),
      ]);
    }
    await t.query(
      "INSERT INTO users(id,org_id,email,name,password_hash,role) VALUES($1,$2,$3,$4,$5,$6)",
      [
        prod ? randomUUID() : "demo-admin",
        org,
        process.env.ADMIN_EMAIL || "demo@example.invalid",
        prod ? "Administrator" : "Demo Supervisor",
        process.env.ADMIN_PASSWORD
          ? await bcrypt.hash(process.env.ADMIN_PASSWORD, 12)
          : null,
        "administrator",
      ],
    );
    await t.query("INSERT INTO company_configuration(org_id,display_name,timezone,language,date_format,preparation_weekdays) VALUES($1,$2,$3,$4,$5,$6)", [org, prod ? (process.env.COMPANY_NAME || "Company · setup required") : "Synthetic Cure · Synthetic demo", prod ? null : "Europe/London",prod ? null : "en",prod ? null : "day-first",prod ? [] : [3]]);
    if (prod) return;
    await t.query(
      "INSERT INTO users(id,org_id,email,name,role) VALUES('demo-driver','demo','driver@example.invalid','Demo Driver','driver'),('demo-reviewer','demo','reviewer@example.invalid','Demo Reviewer','reviewer'),('demo-operator','demo','operator@example.invalid','Demo Operator','operator')",
    );
    for (const c of [
      ["c1", "0001", "Example East Market", "示例东市场"],
      ["c2", "0002", "Example Lotus Foods", "示例莲花食品"],
      ["c3", "0003", "Example Print Shop", "示例印刷店"],
    ]) {
      await t.query("INSERT INTO customers VALUES($1,$2,$3,$4,$5)", [
        c[0],
        org,
        ...c.slice(1),
      ]);
      await t.query("INSERT INTO destinations VALUES($1,$2,$3,$4,$5,false)", [
        "d" + c[0].slice(1),
        org,
        c[0],
        c[2] + " · receiving desk",
        null,
      ]);
    }
    for (const p of [
      [
        "p1",
        "PRD-001",
        "Calendar · sample edition",
        "挂历",
        "Printed goods",
        "piece",
      ],
      [
        "p2",
        "PRD-002",
        "Fresh produce · sample",
        "蔬菜",
        "Fresh produce",
        "kg",
      ],
      [
        "p3",
        "PRD-003",
        "General goods · sample",
        "杂货",
        "General goods",
        "piece",
      ],
    ])
      await t.query(
        "INSERT INTO products(id,org_id,sku,name,name_zh,profile,unit) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [p[0], org, ...p.slice(1)],
      );
    for (const l of [
      ["l1", "RCV-01", "Receiving bay", "floor"],
      ["l2", "A-01", "Printed goods area", "shelf"],
      ["l3", "STG-01", "Preparation staging", "staging"],
      ["l4", "HOLD-01", "Review & returns hold", "floor"],
    ])
      await t.query(
        "INSERT INTO locations(id,org_id,code,name,kind) VALUES($1,$2,$3,$4,$5)",
        [l[0], org, ...l.slice(1)],
      );
    await t.query(
      "INSERT INTO pallets(id,org_id,code,location_id) VALUES('pal1','demo','PLT-0001','l3'),('pal2','demo','PLT-0002','l1')",
    );
    for (let i = 1; i <= 8; i++) {
      const p = i <= 4 ? "p1" : i <= 6 ? "p2" : "p3";
      const quantity = i === 4 ? null : i <= 3 ? "25" : i <= 6 ? "10" : "12";
      await t.query(
        "INSERT INTO boxes(id,org_id,code,customer_id,location_id,pallet_id,source_label,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          "b" + i,
          org,
          "BOX-" + String(i).padStart(5, "0"),
          i <= 4 ? "c3" : i <= 6 ? "c1" : "c2",
          i === 7 || i === 8 ? null : i <= 4 ? "l2" : "l1",
          i === 7 || i === 8 ? "pal1" : null,
          "Synthetic reference " + i,
          quantity ? "confirmed" : "unconfirmed",
        ],
      );
      await t.query(
        "INSERT INTO contents(id,org_id,box_id,product_id,quantity,unit,verified) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          "ct" + i,
          org,
          "b" + i,
          p,
          quantity,
          p === "p2" ? "kg" : "piece",
          quantity !== null,
        ],
      );
    }
    for (const o of [
      ["o1", "ORD-001", "c3", "d3", "p1", "50", "piece"],
      ["o2", "ORD-002", "c1", "d1", "p2", "10", "kg"],
      ["o3", "ORD-003", "c2", "d2", "p3", "12", "piece"],
    ]) {
      await t.query(
        "INSERT INTO orders(id,org_id,code,customer_id,destination_id) VALUES($1,$2,$3,$4,$5)",
        [o[0], org, o[1], o[2], o[3]],
      );
      await t.query("INSERT INTO order_lines VALUES($1,$2,$3,$4,$5,$6)", [
        "ol" + o[0].slice(1),
        org,
        o[0],
        o[4],
        o[5],
        o[6],
      ]);
    }
    await t.query(
      "INSERT INTO preparations(id,org_id,business_date) VALUES('prep1','demo','2026-10-28')",
    );
    await t.query(
      "INSERT INTO preparation_orders(preparation_id,order_id) VALUES('prep1','o1'),('prep1','o2')",
    );
    await t.query(
      "INSERT INTO issues(id,org_id,box_id,kind,note) VALUES('issue1','demo','b4','unclear label','Sample label quantity has not been interpreted. Confirm physically before allocation.')",
    );
    for (const mark of ["1/3", "○ / △ / □", "orange highlight", "✓ / ✕"])
      await t.query("INSERT INTO tracking_marks VALUES($1,$2,$3,NULL,$4,1)", [
        randomUUID(),
        org,
        mark,
        "Historical reference · meaning unconfirmed",
      ]);
    await t.query(
      "INSERT INTO inventory_events VALUES('seed-event','demo','demo-admin','b1','demo.received','{\"note\":\"Synthetic opening stock; no real stock represented\"}',now())",
    );
  });
}
