import * as zlib from 'node:zlib';
import type { OperationsReportData } from '../contracts/reports.js';

export function escapeXml(str: string | number | null | undefined): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function createZipArchive(entries: Array<{ path: string; data: Buffer | string }>): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.path, 'utf8');
    const rawData = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const compressed = zlib.deflateRawSync(rawData);
    const crc = zlib.crc32(rawData);

    // Local file header (30 bytes + filename)
    const localHdr = Buffer.alloc(30 + nameBuf.length);
    localHdr.writeUInt32LE(0x04034b50, 0); // Local header signature
    localHdr.writeUInt16LE(20, 4);          // Version needed (2.0)
    localHdr.writeUInt16LE(0, 6);           // Flags
    localHdr.writeUInt16LE(8, 8);           // Compression method (8 = Deflate)
    localHdr.writeUInt16LE(0, 10);          // Last mod time
    localHdr.writeUInt16LE(0, 12);          // Last mod date
    localHdr.writeUInt32LE(crc, 14);        // CRC-32
    localHdr.writeUInt32LE(compressed.length, 18); // Compressed size
    localHdr.writeUInt32LE(rawData.length, 22);    // Uncompressed size
    localHdr.writeUInt16LE(nameBuf.length, 26);    // Filename length
    localHdr.writeUInt16LE(0, 28);          // Extra field length
    nameBuf.copy(localHdr, 30);

    // Central directory header (46 bytes + filename)
    const centralHdr = Buffer.alloc(46 + nameBuf.length);
    centralHdr.writeUInt32LE(0x02014b50, 0); // Central directory signature
    centralHdr.writeUInt16LE(20, 4);          // Version made by
    centralHdr.writeUInt16LE(20, 6);          // Version needed
    centralHdr.writeUInt16LE(0, 8);           // Flags
    centralHdr.writeUInt16LE(8, 10);          // Compression method (8 = Deflate)
    centralHdr.writeUInt16LE(0, 12);          // Last mod time
    centralHdr.writeUInt16LE(0, 14);          // Last mod date
    centralHdr.writeUInt32LE(crc, 16);        // CRC-32
    centralHdr.writeUInt32LE(compressed.length, 20); // Compressed size
    centralHdr.writeUInt32LE(rawData.length, 24);    // Uncompressed size
    centralHdr.writeUInt16LE(nameBuf.length, 28);    // Filename length
    centralHdr.writeUInt16LE(0, 30);          // Extra field length
    centralHdr.writeUInt16LE(0, 32);          // Comment length
    centralHdr.writeUInt16LE(0, 34);          // Disk number start
    centralHdr.writeUInt16LE(0, 36);          // Internal attributes
    centralHdr.writeUInt32LE(0, 38);          // External attributes
    centralHdr.writeUInt32LE(offset, 42);     // Relative offset of local header
    nameBuf.copy(centralHdr, 46);

    localHeaders.push(localHdr, compressed);
    centralHeaders.push(centralHdr);
    offset += localHdr.length + compressed.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const ch of centralHeaders) centralDirSize += ch.length;

  // End of Central Directory Record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);                   // Number of this disk
  eocd.writeUInt16LE(0, 6);                   // Disk where central directory starts
  eocd.writeUInt16LE(entries.length, 8);      // Central directory records on this disk
  eocd.writeUInt16LE(entries.length, 10);     // Total central directory records
  eocd.writeUInt32LE(centralDirSize, 12);     // Size of central directory
  eocd.writeUInt32LE(centralDirOffset, 16);   // Offset of start of central directory
  eocd.writeUInt16LE(0, 20);                  // Comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

// Coordinate conversions: 1 inch = 914400 EMUs, 1 point = 12700 EMUs
// Presentation dimensions: 16:9 standard = 13.333 x 7.5 inches = 12192000 x 6858000 EMUs

function createSlideXml(contentXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg>
      <p:bgPr>
        <a:solidFill><a:srgbClr val="0F172A"/></a:solidFill>
        <a:effectLst/>
      </p:bgPr>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      ${contentXml}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function cardShape(id: number, x: number, y: number, cx: number, cy: number, bgClr = '1E293B', borderClr = '334155'): string {
  return `
    <p:sp>
      <p:nvSpPr>
        <p:cNvPr id="${id}" name="Card_${id}"/>
        <p:cNvSpPr/>
        <p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm>
          <a:off x="${x}" y="${y}"/>
          <a:ext cx="${cx}" cy="${cy}"/>
        </a:xfrm>
        <a:prstGeom prst="roundRect">
          <a:avLst><a:gd name="adj" fmla="val 2500"/></a:avLst>
        </a:prstGeom>
        <a:solidFill><a:srgbClr val="${bgClr}"/></a:solidFill>
        <a:ln w="12700"><a:solidFill><a:srgbClr val="${borderClr}"/></a:solidFill></a:ln>
      </p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody>
    </p:sp>`;
}

function textBox(
  id: number,
  x: number,
  y: number,
  cx: number,
  cy: number,
  paragraphs: Array<{
    text: string;
    size?: number; // in 1/100 points, e.g. 2400 = 24pt
    bold?: boolean;
    color?: string; // hex RRGGBB
    align?: 'l' | 'ctr' | 'r';
  }>
): string {
  const pTags = paragraphs
    .map(p => {
      const alignAttr = p.align ? ` algn="${p.align}"` : '';
      const sz = p.size || 1800;
      const b = p.bold ? ' b="1"' : '';
      const clr = p.color || 'F8FAFC';
      return `<a:p${alignAttr}><a:r><a:rPr lang="en-US" sz="${sz}"${b} dirty="0"><a:solidFill><a:srgbClr val="${clr}"/></a:solidFill><a:latin typeface="Inter"/></a:rPr><a:t>${escapeXml(p.text)}</a:t></a:r></a:p>`;
    })
    .join('');

  return `
    <p:sp>
      <p:nvSpPr>
        <p:cNvPr id="${id}" name="TextBox_${id}"/>
        <p:cNvSpPr txBox="1"/>
        <p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm>
          <a:off x="${x}" y="${y}"/>
          <a:ext cx="${cx}" cy="${cy}"/>
        </a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:noFill/>
      </p:spPr>
      <p:txBody>
        <a:bodyPr wrap="square" rtlCol="0">
          <a:spAutoFit/>
        </a:bodyPr>
        <a:lstStyle/>
        ${pTags}
      </p:txBody>
    </p:sp>`;
}

function slideHeader(
  startId: number,
  title: string,
  subtitle: string,
  report: OperationsReportData
): { xml: string; nextId: number } {
  const badgeId = startId;
  const titleId = startId + 1;
  const metaId = startId + 2;

  const xml = `
    ${textBox(badgeId, 762000, 457200, 3000000, 360000, [
      { text: `SYNTHETIC CURE · ${report.warehouse.code} · ${report.company.name.toUpperCase()}`, size: 1100, bold: true, color: '818CF8' }
    ])}
    ${textBox(titleId, 762000, 762000, 8000000, 600000, [
      { text: title, size: 2800, bold: true, color: 'F8FAFC' },
      { text: subtitle, size: 1400, color: '94A3B8' }
    ])}
    ${textBox(metaId, 8500000, 457200, 2900000, 600000, [
      { text: `GENERATED: ${report.generatedAt.slice(0, 16).replace('T', ' ')} UTC`, size: 1100, color: '64748B', align: 'r' },
      { text: `FLOOR SUPERVISOR BRIEFING`, size: 1100, bold: true, color: '10B981', align: 'r' }
    ])}
  `;

  return { xml, nextId: startId + 3 };
}

// Slide 1: Cover & Operational Overview
function buildSlide1(report: OperationsReportData): string {
  let spId = 2;
  const parts: string[] = [];

  // Hero Card
  parts.push(cardShape(spId++, 762000, 1500000, 10668000, 4600000, '1E293B', '334155'));

  // Hero Content
  parts.push(
    textBox(spId++, 1200000, 1900000, 9800000, 1800000, [
      { text: 'Warehouse Floor Operations', size: 3600, bold: true, color: 'F8FAFC' },
      { text: '& Shift Supervisor Briefing Deck', size: 3600, bold: true, color: '6366F1' },
      { text: `Operational summary for ${report.warehouse.name} (${report.warehouse.code}) · Tenant: ${report.company.name}`, size: 1600, color: '94A3B8' }
    ])
  );

  // Key KPI mini cards across the bottom of Slide 1
  const kpis = [
    { label: 'ACTIVE HOLDS', value: report.quality.activeHoldsCount.toString(), color: report.quality.activeHoldsCount > 0 ? 'F43F5E' : '10B981' },
    { label: 'OPEN TASKS', value: report.tasks.openTasksCount.toString(), color: 'F59E0B' },
    { label: 'PICKS COMPLETED', value: report.picking.totalPicksVerified.toString(), color: '10B981' },
    { label: 'INBOUND POs', value: report.inbound.purchaseOrdersCount.toString(), color: '38BDF8' }
  ];

  const cardW = 2200000;
  const cardGap = 350000;
  const startX = 1200000;
  const cardY = 4000000;

  kpis.forEach((kpi, idx) => {
    const x = startX + idx * (cardW + cardGap);
    parts.push(cardShape(spId++, x, cardY, cardW, 1600000, '0F172A', '334155'));
    parts.push(
      textBox(spId++, x + 150000, cardY + 200000, cardW - 300000, 1200000, [
        { text: kpi.label, size: 1100, bold: true, color: '94A3B8' },
        { text: kpi.value, size: 3400, bold: true, color: kpi.color }
      ])
    );
  });

  return createSlideXml(parts.join(''));
}

// Slide 2: Inbound PO Receipts & Dock Intake
function buildSlide2(report: OperationsReportData): string {
  let spId = 2;
  const parts: string[] = [];

  const hdr = slideHeader(spId, 'Inbound PO Receipts & Dock Intake', 'Physical receipt verification, supplier expected volumes, and discrepancy breakdown', report);
  parts.push(hdr.xml);
  spId = hdr.nextId;

  // 3 Metric Cards Across Top
  const topMetrics = [
    { label: 'EXPECTED PURCHASE ORDERS', val: report.inbound.purchaseOrdersCount.toString(), sub: 'Authoritative supplier orders', clr: '818CF8' },
    { label: 'PHYSICAL BOXES RECEIVED', val: report.inbound.receivedBoxesCount.toString(), sub: 'Scanned & checked at dock', clr: '10B981' },
    { label: 'TOTAL EXPECTED UNITS', val: report.inbound.totalExpectedUnits, sub: 'Confirmed catalog base units', clr: 'F8FAFC' }
  ];

  const w3 = 3300000;
  const gap3 = 384000;
  topMetrics.forEach((m, i) => {
    const x = 762000 + i * (w3 + gap3);
    parts.push(cardShape(spId++, x, 1600000, w3, 1600000, '1E293B', '334155'));
    parts.push(
      textBox(spId++, x + 200000, 1800000, w3 - 400000, 1200000, [
        { text: m.label, size: 1100, bold: true, color: '94A3B8' },
        { text: m.val, size: 3200, bold: true, color: m.clr },
        { text: m.sub, size: 1200, color: '64748B' }
      ])
    );
  });

  // Discrepancy Breakdown Section (Lower Panel)
  parts.push(cardShape(spId++, 762000, 3500000, 10668000, 2700000, '1E293B', '334155'));
  parts.push(
    textBox(spId++, 1050000, 3700000, 10000000, 500000, [
      { text: 'Dock Discrepancy Breakdown & Exception Logs', size: 1800, bold: true, color: 'F8FAFC' },
      { text: `Total exceptions recorded: ${report.inbound.discrepanciesCount} · Zero goods released to available stock without supervisor disposition`, size: 1200, color: '94A3B8' }
    ])
  );

  const discTypes = [
    { label: 'DAMAGED AT DOCK', val: report.inbound.discrepancyBreakdown.damaged.toString(), clr: 'F43F5E' },
    { label: 'SHORT SHIPMENTS', val: report.inbound.discrepancyBreakdown.short.toString(), clr: 'F59E0B' },
    { label: 'OVER SHIPMENTS', val: report.inbound.discrepancyBreakdown.over.toString(), clr: '38BDF8' },
    { label: 'UNEXPECTED ARRIVALS', val: report.inbound.discrepancyBreakdown.unexpected.toString(), clr: 'A855F7' }
  ];

  const discW = 2300000;
  const discGap = 350000;
  discTypes.forEach((dt, i) => {
    const x = 1050000 + i * (discW + discGap);
    parts.push(cardShape(spId++, x, 4400000, discW, 1400000, '0F172A', '334155'));
    parts.push(
      textBox(spId++, x + 150000, 4550000, discW - 300000, 1100000, [
        { text: dt.label, size: 1000, bold: true, color: '94A3B8' },
        { text: dt.val, size: 2800, bold: true, color: dt.clr }
      ])
    );
  });

  return createSlideXml(parts.join(''));
}

// Slide 3: Daily Picking & Fulfillment Throughput
function buildSlide3(report: OperationsReportData): string {
  let spId = 2;
  const parts: string[] = [];

  const hdr = slideHeader(spId, 'Daily Picking & Fulfillment Throughput', 'Verified order line picks, tote assignments, shortages, and supervisor-authorized substitutions', report);
  parts.push(hdr.xml);
  spId = hdr.nextId;

  const metrics = [
    { label: 'PICKS VERIFIED', val: report.picking.totalPicksVerified.toString(), clr: '10B981', sub: 'Floor barcode confirmations' },
    { label: 'UNITS FULFILLED', val: report.picking.totalUnitsPicked, clr: 'F8FAFC', sub: 'Verified physical base units' },
    { label: 'SHORTAGE EXCEPTIONS', val: report.picking.shortagePicksCount.toString(), clr: 'F59E0B', sub: 'Recorded on pick list' },
    { label: 'SUPERVISOR SUBSTITUTIONS', val: report.picking.substitutionsCount.toString(), clr: '818CF8', sub: 'Explicitly authorized' }
  ];

  const w4 = 2400000;
  const gap4 = 356000;
  metrics.forEach((m, i) => {
    const x = 762000 + i * (w4 + gap4);
    parts.push(cardShape(spId++, x, 1600000, w4, 1800000, '1E293B', '334155'));
    parts.push(
      textBox(spId++, x + 180000, 1850000, w4 - 360000, 1300000, [
        { text: m.label, size: 1000, bold: true, color: '94A3B8' },
        { text: m.val, size: 3200, bold: true, color: m.clr },
        { text: m.sub, size: 1200, color: '64748B' }
      ])
    );
  });

  // Floor Quality & Rule Assurance Box
  parts.push(cardShape(spId++, 762000, 3700000, 10668000, 2500000, '1E293B', '334155'));
  parts.push(
    textBox(spId++, 1100000, 4000000, 10000000, 1900000, [
      { text: 'Picking Invariants & Quality Rules Verified', size: 1800, bold: true, color: 'F8FAFC' },
      { text: '• FEFO & Cold-Chain Allocation: Stock picked strictly follows First-Expired, First-Out priority with temperature validation.', size: 1300, color: 'E2E8F0' },
      { text: '• Zero Silent Substitutions: Product substitutions require supervisor credentials, justification note, and audit logging.', size: 1300, color: 'E2E8F0' },
      { text: '• Cascading Check Invalidation: Any tote repack or split cascades invalidation across shipment manifest before loading.', size: 1300, color: 'E2E8F0' },
      { text: '• Totes Dispatched: Total verified totes staged for customer shipment: ' + report.picking.totesDispatchedCount, size: 1300, bold: true, color: '10B981' }
    ])
  );

  return createSlideXml(parts.join(''));
}

// Slide 4: Stock-Owner Inventory Distribution & Integrity
function buildSlide4(report: OperationsReportData): string {
  let spId = 2;
  const parts: string[] = [];

  const hdr = slideHeader(spId, 'Inventory Distribution & Stock-Owner Balances', 'Multi-tenant stock segregation, loose and container inventory ledger verification', report);
  parts.push(hdr.xml);
  spId = hdr.nextId;

  // 4 Core Inventory Balances
  const balances = [
    { label: 'TOTAL ON-HAND', val: report.inventory.totalOnHandQuantity, clr: 'F8FAFC' },
    { label: 'AVAILABLE TO PROMISE', val: report.inventory.totalAvailableQuantity, clr: '10B981' },
    { label: 'ALLOCATED / RESERVED', val: report.inventory.totalReservedQuantity, clr: '818CF8' },
    { label: 'QUARANTINE / HELD', val: report.inventory.totalHeldQuantity, clr: 'F43F5E' }
  ];

  const w4 = 2400000;
  const gap4 = 356000;
  balances.forEach((b, i) => {
    const x = 762000 + i * (w4 + gap4);
    parts.push(cardShape(spId++, x, 1600000, w4, 1500000, '1E293B', '334155'));
    parts.push(
      textBox(spId++, x + 180000, 1800000, w4 - 360000, 1100000, [
        { text: b.label, size: 1000, bold: true, color: '94A3B8' },
        { text: b.val, size: 3000, bold: true, color: b.clr }
      ])
    );
  });

  // Stock Owners Breakdown Table Panel
  parts.push(cardShape(spId++, 762000, 3400000, 10668000, 2800000, '1E293B', '334155'));
  parts.push(
    textBox(spId++, 1100000, 3600000, 10000000, 450000, [
      { text: 'Stock-Owner Balances (3PL Segregation)', size: 1800, bold: true, color: 'F8FAFC' },
      { text: 'Strict client stock separation · Physical balances cannot cross stock owner identities', size: 1200, color: '94A3B8' }
    ])
  );

  const owners = report.inventory.stockOwners.slice(0, 4);
  if (owners.length === 0) {
    parts.push(
      textBox(spId++, 1100000, 4400000, 9000000, 800000, [
        { text: 'No external 3PL stock owners registered · All stock is company-owned inventory.', size: 1400, color: '64748B' }
      ])
    );
  } else {
    const rowH = 450000;
    owners.forEach((o, i) => {
      const y = 4200000 + i * rowH;
      parts.push(cardShape(spId++, 1100000, y, 9900000, 400000, '0F172A', '334155'));
      parts.push(
        textBox(spId++, 1300000, y + 60000, 3500000, 300000, [
          { text: o.ownerName, size: 1300, bold: true, color: 'F8FAFC' }
        ])
      );
      parts.push(
        textBox(spId++, 5000000, y + 60000, 2500000, 300000, [
          { text: `On-Hand: ${o.onHand}`, size: 1200, color: '94A3B8' }
        ])
      );
      parts.push(
        textBox(spId++, 7600000, y + 60000, 1800000, 300000, [
          { text: `Avail: ${o.available}`, size: 1200, color: '10B981' }
        ])
      );
      parts.push(
        textBox(spId++, 9500000, y + 60000, 1400000, 300000, [
          { text: `Held: ${o.held}`, size: 1200, color: o.held !== '0' ? 'F43F5E' : '64748B' }
        ])
      );
    });
  }

  return createSlideXml(parts.join(''));
}

// Slide 5: Quality Quarantine Holds & Safety Metrics
function buildSlide5(report: OperationsReportData): string {
  let spId = 2;
  const parts: string[] = [];

  const hdr = slideHeader(spId, 'Quality Quarantine Holds & Compliance', 'Active hold severity, quarantined lots/serials, and safety gate enforcement', report);
  parts.push(hdr.xml);
  spId = hdr.nextId;

  // 3 Severity Cards
  const sevCards = [
    { label: 'CRITICAL SEVERITY', val: report.quality.holdSeverityBreakdown.critical.toString(), clr: 'F43F5E', sub: 'Immediate stop-shipment' },
    { label: 'MAJOR SEVERITY', val: report.quality.holdSeverityBreakdown.major.toString(), clr: 'F59E0B', sub: 'Supervisor review required' },
    { label: 'MINOR SEVERITY', val: report.quality.holdSeverityBreakdown.minor.toString(), clr: '38BDF8', sub: 'Packaging / cosmetic holds' }
  ];

  const w3 = 3300000;
  const gap3 = 384000;
  sevCards.forEach((c, i) => {
    const x = 762000 + i * (w3 + gap3);
    parts.push(cardShape(spId++, x, 1600000, w3, 1700000, '1E293B', '334155'));
    parts.push(
      textBox(spId++, x + 200000, 1850000, w3 - 400000, 1200000, [
        { text: c.label, size: 1100, bold: true, color: '94A3B8' },
        { text: c.val, size: 3400, bold: true, color: c.clr },
        { text: c.sub, size: 1200, color: '64748B' }
      ])
    );
  });

  // Hold Invariant & Quarantined Items Card
  parts.push(cardShape(spId++, 762000, 3600000, 10668000, 2600000, '1E293B', '334155'));
  parts.push(
    textBox(spId++, 1100000, 3900000, 10000000, 2000000, [
      { text: 'Authoritative Safety Rules Enforced', size: 1800, bold: true, color: 'F8FAFC' },
      { text: '• Total Active Quarantine Holds: ' + report.quality.activeHoldsCount, size: 1400, bold: true, color: report.quality.activeHoldsCount > 0 ? 'F43F5E' : '10B981' },
      { text: `• Quarantined Batches / Lots: ${report.quality.quarantinedLotsCount} · Quarantined Serialized Items: ${report.quality.quarantinedSerialsCount}`, size: 1300, color: 'E2E8F0' },
      { text: '• Order Picking Lock: Warehouse engine blocks picking, allocation, and loading of any item under active quarantine.', size: 1300, color: 'E2E8F0' },
      { text: '• Immutable Audit: Release requires supervisor credentials, written disposition notes, and appends an unalterable audit event.', size: 1300, color: 'E2E8F0' }
    ])
  );

  return createSlideXml(parts.join(''));
}

// Slide 6: Shift Handover & Floor Task Backlog
function buildSlide6(report: OperationsReportData): string {
  let spId = 2;
  const parts: string[] = [];

  const hdr = slideHeader(spId, 'Shift Handover & Floor Action Items', 'Task queue distribution, open priorities, and shift handoff operational checklist', report);
  parts.push(hdr.xml);
  spId = hdr.nextId;

  // 4 Task Status Cards
  const tasks = [
    { label: 'OPEN BACKLOG', val: report.tasks.openTasksCount.toString(), clr: '38BDF8', sub: 'Awaiting floor claim' },
    { label: 'IN PROGRESS', val: report.tasks.claimedTasksCount.toString(), clr: '818CF8', sub: 'Claimed by operators' },
    { label: 'BLOCKED TASKS', val: report.tasks.blockedTasksCount.toString(), clr: report.tasks.blockedTasksCount > 0 ? 'F43F5E' : '10B981', sub: 'Obstacle or discrepancy' },
    { label: 'URGENT PRIORITY', val: report.tasks.urgentPriorityCount.toString(), clr: report.tasks.urgentPriorityCount > 0 ? 'F59E0B' : '10B981', sub: 'Immediate dispatch need' }
  ];

  const w4 = 2400000;
  const gap4 = 356000;
  tasks.forEach((t, i) => {
    const x = 762000 + i * (w4 + gap4);
    parts.push(cardShape(spId++, x, 1600000, w4, 1600000, '1E293B', '334155'));
    parts.push(
      textBox(spId++, x + 180000, 1800000, w4 - 360000, 1200000, [
        { text: t.label, size: 1000, bold: true, color: '94A3B8' },
        { text: t.val, size: 3000, bold: true, color: t.clr },
        { text: t.sub, size: 1200, color: '64748B' }
      ])
    );
  });

  // Shift Supervisor Handover Checklist
  parts.push(cardShape(spId++, 762000, 3500000, 10668000, 2700000, '1E293B', '334155'));
  parts.push(
    textBox(spId++, 1100000, 3750000, 10000000, 2200000, [
      { text: 'Shift Supervisor Handover Checklist', size: 1800, bold: true, color: 'F8FAFC' },
      { text: '1. Inbound Dock: Confirm all delivered pallets have physical boxes scanned and discrepancies logged.', size: 1300, color: 'E2E8F0' },
      { text: '2. Replenishment: Ensure forward picking locations meet minimum replenishment policy levels.', size: 1300, color: 'E2E8F0' },
      { text: '3. Staging & Loading: Verify pallet groups are checked and manifest revisions match loaded trucks.', size: 1300, color: 'E2E8F0' },
      { text: '4. Custody & Handover: Remind drivers that loading is not delivery; electronic ePOD signature required at destination.', size: 1300, color: 'E2E8F0' },
      { text: '5. Offline Outbox: Confirm operator devices have zero unresolved 409 sync conflicts before signing off.', size: 1300, color: 'E2E8F0' }
    ])
  );

  return createSlideXml(parts.join(''));
}

export function generateOperationsPptx(report: OperationsReportData): Buffer {
  const slide1Xml = buildSlide1(report);
  const slide2Xml = buildSlide2(report);
  const slide3Xml = buildSlide3(report);
  const slide4Xml = buildSlide4(report);
  const slide5Xml = buildSlide5(report);
  const slide6Xml = buildSlide6(report);

  const slideRelXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;

  const entries: Array<{ path: string; data: Buffer | string }> = [
    // [Content_Types].xml
    {
      path: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide3.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide4.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide5.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide6.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    },

    // _rels/.rels
    {
      path: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    },

    // ppt/_rels/presentation.xml.rels
    {
      path: 'ppt/_rels/presentation.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/>
  <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide4.xml"/>
  <Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide5.xml"/>
  <Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide6.xml"/>
</Relationships>`
    },

    // ppt/presentation.xml
    {
      path: 'ppt/presentation.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId3"/>
    <p:sldId id="257" r:id="rId4"/>
    <p:sldId id="258" r:id="rId5"/>
    <p:sldId id="259" r:id="rId6"/>
    <p:sldId id="260" r:id="rId7"/>
    <p:sldId id="261" r:id="rId8"/>
  </p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`
    },

    // ppt/theme/theme1.xml
    {
      path: 'ppt/theme/theme1.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="SyntheticCureDark">
  <a:themeElements>
    <a:clrScheme name="SyntheticDark">
      <a:dk1><a:srgbClr val="0F172A"/></a:dk1>
      <a:lt1><a:srgbClr val="F8FAFC"/></a:lt1>
      <a:dk2><a:srgbClr val="1E293B"/></a:dk2>
      <a:lt2><a:srgbClr val="E2E8F0"/></a:lt2>
      <a:accent1><a:srgbClr val="6366F1"/></a:accent1>
      <a:accent2><a:srgbClr val="10B981"/></a:accent2>
      <a:accent3><a:srgbClr val="F59E0B"/></a:accent3>
      <a:accent4><a:srgbClr val="F43F5E"/></a:accent4>
      <a:accent5><a:srgbClr val="38BDF8"/></a:accent5>
      <a:accent6><a:srgbClr val="A855F7"/></a:accent6>
      <a:hlink><a:srgbClr val="818CF8"/></a:hlink>
      <a:folHlink><a:srgbClr val="C084FC"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="SyntheticFonts">
      <a:majorFont><a:latin typeface="Inter"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Inter"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="38100"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`
    },

    // ppt/slideMasters/slideMaster1.xml
    {
      path: 'ppt/slideMasters/slideMaster1.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg>
      <p:bgPr>
        <a:solidFill><a:srgbClr val="0F172A"/></a:solidFill>
        <a:effectLst/>
      </p:bgPr>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
  <p:txStyles>
    <p:titleStyle><a:lvl1pPr><a:defRPr sz="4000"><a:solidFill><a:srgbClr val="F8FAFC"/></a:solidFill></a:defRPr></a:lvl1pPr></p:titleStyle>
    <p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill></a:defRPr></a:lvl1pPr></p:bodyStyle>
    <p:otherStyle><a:lvl1pPr><a:defRPr sz="1400"><a:solidFill><a:srgbClr val="94A3B8"/></a:solidFill></a:defRPr></a:lvl1pPr></p:otherStyle>
  </p:txStyles>
</p:sldMaster>`
    },

    // ppt/slideMasters/_rels/slideMaster1.xml.rels
    {
      path: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`
    },

    // ppt/slideLayouts/slideLayout1.xml
    {
      path: 'ppt/slideLayouts/slideLayout1.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank">
  <p:cSld>
    <p:bg>
      <p:bgPr>
        <a:solidFill><a:srgbClr val="0F172A"/></a:solidFill>
        <a:effectLst/>
      </p:bgPr>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`
    },

    // ppt/slideLayouts/_rels/slideLayout1.xml.rels
    {
      path: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`
    },

    // Slides 1-6
    { path: 'ppt/slides/slide1.xml', data: slide1Xml },
    { path: 'ppt/slides/_rels/slide1.xml.rels', data: slideRelXml },
    { path: 'ppt/slides/slide2.xml', data: slide2Xml },
    { path: 'ppt/slides/_rels/slide2.xml.rels', data: slideRelXml },
    { path: 'ppt/slides/slide3.xml', data: slide3Xml },
    { path: 'ppt/slides/_rels/slide3.xml.rels', data: slideRelXml },
    { path: 'ppt/slides/slide4.xml', data: slide4Xml },
    { path: 'ppt/slides/_rels/slide4.xml.rels', data: slideRelXml },
    { path: 'ppt/slides/slide5.xml', data: slide5Xml },
    { path: 'ppt/slides/_rels/slide5.xml.rels', data: slideRelXml },
    { path: 'ppt/slides/slide6.xml', data: slide6Xml },
    { path: 'ppt/slides/_rels/slide6.xml.rels', data: slideRelXml }
  ];

  return createZipArchive(entries);
}
