"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.oid = oid;
const mongoose_1 = require("mongoose");
const errors_1 = require("./errors");
/** A route's id as an ObjectId, or 404 (a malformed id is simply not found). */
function oid(value, what) {
    if (!mongoose_1.Types.ObjectId.isValid(value) || String(new mongoose_1.Types.ObjectId(value)) !== value)
        throw (0, errors_1.notFound)(what);
    return new mongoose_1.Types.ObjectId(value);
}
//# sourceMappingURL=ids.js.map