"use strict";
// Contact field values are stored typed so the database can filter and sort
// them properly: numbers as numbers, yes/no as booleans, dates as
// "YYYY-MM-DD" (sorts correctly as text), the rest as text. The API speaks
// strings to the front end, as the core types do.
Object.defineProperty(exports, "__esModule", { value: true });
exports.storeValue = storeValue;
exports.storeFields = storeFields;
exports.plainFields = plainFields;
const conditions_1 = require("@outreach/core/conditions");
const YES = ["yes", "y", "true", "1"];
const NO = ["no", "n", "false", "0"];
function storeValue(raw, type, order = "dmy") {
    const v = raw.trim();
    if (!v)
        return undefined;
    if (type === "number") {
        const n = Number(v.replace(/[,$\s]/g, ""));
        return Number.isFinite(n) ? n : v;
    }
    if (type === "yesno") {
        const l = v.toLowerCase();
        return YES.includes(l) ? true : NO.includes(l) ? false : v;
    }
    if (type === "date")
        return (0, conditions_1.toIsoDate)(v, order) ?? v;
    return v;
}
function storeFields(fields, defs, order = "dmy") {
    const typeOf = new Map(defs.map((d) => [d.key, d.type]));
    const out = {};
    for (const [k, raw] of Object.entries(fields)) {
        const value = storeValue(String(raw ?? ""), typeOf.get(k) ?? "text", order);
        if (value !== undefined)
            out[k] = value;
    }
    return out;
}
function plainFields(stored) {
    const out = {};
    for (const [k, v] of Object.entries(stored ?? {})) {
        if (v === null || v === undefined)
            continue;
        out[k] = typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
    }
    return out;
}
//# sourceMappingURL=typed-fields.js.map