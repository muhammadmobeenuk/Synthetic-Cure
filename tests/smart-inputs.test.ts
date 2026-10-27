import test from "node:test";
import assert from "node:assert/strict";
import { checkEnvironmentalCompatibility, parseGS1Barcode } from "../apps/web/src/SmartInputs";

test("checkEnvironmentalCompatibility flags cold-chain products in ambient locations", () => {
  const chilledProduct = {
    id: "p1",
    sku: "PRD-VACC-01",
    name: "Temperature Sensitive Vaccine",
    profile: "Chilled",
    require_temperature: true,
    temperature_min: "2",
    temperature_max: "8",
  };

  const ambientLocation = {
    id: "l1",
    code: "A-01",
    name: "General shelf storage",
    kind: "shelf",
    restrictions: "dry goods only",
  };

  const result = checkEnvironmentalCompatibility([chilledProduct], ambientLocation);
  assert.equal(result.isCompatible, false);
  assert.match(result.warning || "", /Cold Chain Alert/i);
  assert.match(result.warning || "", /General shelf storage/i);
  assert.match(result.warning || "", /2°C to 8°C/);
});

test("checkEnvironmentalCompatibility allows cold-chain products in cold storage locations", () => {
  const frozenProduct = {
    id: "p2",
    sku: "PRD-FRZ-01",
    name: "Deep Frozen Plasma",
    profile: "Frozen",
    require_temperature: true,
    temperature_min: "-25",
    temperature_max: "-18",
  };

  const freezerLocation = {
    id: "l_cold",
    code: "FRZ-01",
    name: "Walk-in Freezer Vault",
    kind: "floor",
    restrictions: "Sub-zero climate controlled",
  };

  const result = checkEnvironmentalCompatibility([frozenProduct], freezerLocation);
  assert.equal(result.isCompatible, true);
});

test("checkEnvironmentalCompatibility approves ambient products in standard locations", () => {
  const generalProduct = {
    id: "p3",
    sku: "PRD-BOX-01",
    name: "Carton Packaging Materials",
    profile: "General goods",
    require_temperature: false,
    temperature_min: null,
    temperature_max: null,
  };

  const ambientLocation = {
    id: "l2",
    code: "RCV-01",
    name: "Receiving floor",
    kind: "floor",
    restrictions: null,
  };

  const result = checkEnvironmentalCompatibility([generalProduct], ambientLocation);
  assert.equal(result.isCompatible, true);
});

test("parseGS1Barcode parses AI elements (01, 10, 17, 21) accurately", () => {
  const barcode = "(01)05012345678900(17)261231(10)LOT-2026A(21)SN-998877";
  const parsed = parseGS1Barcode(barcode);
  assert.ok(parsed);
  assert.equal(parsed.gtin, "05012345678900");
  assert.equal(parsed.batchLot, "LOT-2026A");
  assert.equal(parsed.expiryDate, "2026-12-31");
  assert.equal(parsed.serialNo, "SN-998877");
});
