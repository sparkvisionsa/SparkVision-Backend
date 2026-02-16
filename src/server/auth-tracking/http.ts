import { HttpError } from "./service";

export function toErrorPayload(error: unknown) {
  if (error instanceof HttpError) {
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

export async function parseJsonBody(request: Request) {
  try {
    const text = await request.text();
    if (!text) return {};
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}
