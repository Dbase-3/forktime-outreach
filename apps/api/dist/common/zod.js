"use strict";
// Validates a request body against a zod schema; a failure is a 422 listing
// each problem by path, so a form can point at the field.
Object.defineProperty(exports, "__esModule", { value: true });
exports.parse = parse;
const errors_1 = require("./errors");
function parse(schema, value) {
    const result = schema.safeParse(value);
    if (!result.success) {
        throw (0, errors_1.unprocessable)("Some of that isn't valid.", result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    return result.data;
}
//# sourceMappingURL=zod.js.map