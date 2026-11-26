"use strict";
// Saving with a version check: the client sends the version it edited; the
// save only lands if nobody saved in between. Otherwise 409 "stale" with the
// current document, so the screen can reload it (no silent overwrites).
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveVersioned = saveVersioned;
const errors_1 = require("./errors");
async function saveVersioned(model, filter, version, update, out, what) {
    const live = { ...filter, deletedAt: null };
    const next = await model.findOneAndUpdate({ ...live, version }, { ...update, $inc: { version: 1 } }, { new: true }).lean();
    if (next)
        return next;
    const current = await model.findOne(live).lean();
    if (!current)
        throw (0, errors_1.notFound)(what);
    throw (0, errors_1.stale)(out(current));
}
//# sourceMappingURL=versioned.js.map