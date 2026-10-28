import type { DB } from '../database/index.js';
import { authorize, owned, type Actor } from './services.js';
import { requireRule } from './index.js';
import Decimal from 'decimal.js';

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export async function getCustomerDeliveryNote(
  t: DB,
  a: Actor,
  shipmentId: string,
  options?: { requireCommercial?: boolean },
) {
  authorize(a, 'review');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);

  // Invariant: Separately implement customer-facing delivery note/invoice and recipient pallet labels
  // only after the user confirms commercial/tax requirements and current pricing.
  if (options?.requireCommercial) {
    requireRule(
      false,
      'COMMERCIAL_REQUIREMENTS_UNCONFIRMED',
      'Customer-facing delivery note, tax invoice, and recipient pallet labels require confirmed commercial/tax terms and current pricing; unverified historical prices and handwritten marks must not be used.',
      422,
    );
  }

  const shipment = await owned(t, 'shipments', shipmentId, a);
  const order = await owned(t, 'orders', shipment.order_id, a);
  const customer = await owned(t, 'customers', order.customer_id, a);
  const destination = await owned(t, 'destinations', shipment.destination_id, a);

  const lines = (
    await t.query(
      `SELECT sl.*, p.sku, p.name product_name, p.name_zh, b.code box_code
       FROM shipment_lines sl
       JOIN products p ON p.id = sl.product_id AND p.org_id = sl.org_id
       JOIN boxes b ON b.id = sl.box_id AND b.warehouse_id = sl.warehouse_id
       WHERE sl.shipment_id = $1 AND sl.org_id = $2 AND sl.warehouse_id = $3
       ORDER BY p.sku, sl.id`,
      [shipmentId, a.org_id, a.warehouse_id],
    )
  ).rows;

  const generated = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());

  const items = lines
    .map(
      (l) =>
        `<tr>
          <td>${esc(l.sku)}<br><strong>${esc(l.product_name)}</strong>${l.name_zh ? '<br>' + esc(l.name_zh) : ''}</td>
          <td>${esc(l.box_code)}</td>
          <td>${esc(new Decimal(l.quantity).toFixed())} ${esc(l.unit)}</td>
          <td>${esc(new Decimal(l.delivered).toFixed())} ${esc(l.unit)}</td>
        </tr>`,
    )
    .join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Delivery Note · ${esc(order.code)}</title>
<style>
body{font:14px Arial,sans-serif;color:#14283b;margin:24px}
h1{margin-bottom:4px}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;border:1px solid #536575;padding:12px;margin:15px 0}
.notice{border-left:4px solid #007788;padding:8px;background:#eef8fa;font-weight:bold}
table{border-collapse:collapse;width:100%;margin-top:12px}
th,td{border:1px solid #536575;padding:7px;text-align:left}
th{background:#edf2f4}
.watermark{color:#8899a6;font-size:12px;margin-top:20px;text-align:center}
</style></head>
<body>
<header>
<h1>Customer Delivery Note</h1>
<p>Shipment ID: ${esc(shipment.id)} · Order: ${esc(order.code)} · Status: ${esc(shipment.status)}</p>
<p>Generated: ${esc(generated)}</p>
</header>
<div class="notice">PHYSICAL QUANTITIES ONLY · COMMERCIAL PRICING UNCONFIRMED</div>
<div class="meta">
<div><strong>Recipient Customer</strong><br>${esc(customer.code)} · ${esc(customer.name)} ${esc(customer.name_zh || '')}</div>
<div><strong>Delivery Destination</strong><br>${esc(destination.name)}<br>${esc(destination.address || 'Address unconfirmed')}</div>
</div>
<table>
<thead><tr><th>Product / SKU</th><th>Box</th><th>Manifest Quantity</th><th>Delivered Quantity</th></tr></thead>
<tbody>${items || '<tr><td colspan="4">No shipment lines.</td></tr>'}</tbody>
</table>
<div class="watermark">COMMERCIAL / TAX INVOICE REQUIRES CONFIRMED COMMERCIAL TERMS. HISTORICAL PRICES NOT APPLIED.</div>
<p style="margin-top:30px">Recipient Signature: _______________________ &nbsp;&nbsp; Date: _________________</p>
</body></html>`;
}

export async function getCustomerInvoice(t: DB, a: Actor, shipmentId: string) {
  authorize(a, 'review');
  requireRule(
    false,
    'COMMERCIAL_REQUIREMENTS_UNCONFIRMED',
    'Customer-facing delivery note, tax invoice, and recipient pallet labels require confirmed commercial/tax terms and current pricing; unverified historical prices and handwritten marks must not be used.',
    422,
  );
}

export async function getRecipientPalletLabels(
  t: DB,
  a: Actor,
  shipmentId: string,
  options?: { requireCommercial?: boolean },
) {
  authorize(a, 'review');
  if (options?.requireCommercial) {
    requireRule(
      false,
      'COMMERCIAL_REQUIREMENTS_UNCONFIRMED',
      'Customer-facing delivery note, tax invoice, and recipient pallet labels require confirmed commercial/tax terms and current pricing; unverified historical prices and handwritten marks must not be used.',
      422,
    );
  }
  return {
    status: 'physical_only',
    notice: 'Commercial recipient labels require confirmed commercial pricing and tax terms',
  };
}
