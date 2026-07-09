"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toErrorPayload = toErrorPayload;
exports.parseJsonBody = parseJsonBody;
const service_1 = require("./service");
function toErrorPayload(error) {
    if (error instanceof service_1.HttpError) {
        return {
            status: error.status,
            body: {
                error: error.code,
                message: error.message,
                ...(error.details ? { details: error.details } : {}),
            },
        };
    }
    console.error("Unhandled API error", error);
    return {
        status: 500,
        body: {
            error: "internal_error",
            message: "Unexpected server error.",
        },
    };
}
async function parseJsonBody(request) {
    try {
        const text = await request.text();
        if (!text)
            return {};
        return JSON.parse(text);
    }
    catch {
        return {};
    }
}
