import { z } from "zod";
import {
  currentSessionGeneration,
  registerSessionRequest,
  releaseSessionRequest,
} from "./session-generation.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function apiRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestInit = {},
): Promise<T> {
  const generation = currentSessionGeneration();
  const controller = registerSessionRequest();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  function assertCurrent() {
    if (generation !== currentSessionGeneration() || signal.aborted) {
      throw new DOMException(
        "Request belongs to an inactive session",
        "AbortError",
      );
    }
  }
  try {
    const response = await fetch(path, {
      ...options,
      signal,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    assertCurrent();
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      assertCurrent();
      if (response.status === 401)
        window.dispatchEvent(new Event("links:unauthorized"));
      const parsed = z
        .object({ error: z.object({ message: z.string() }) })
        .safeParse(body);
      throw new ApiError(
        response.status,
        parsed.success
          ? parsed.data.error.message
          : "Request failed. Please try again.",
      );
    }
    const body: unknown =
      response.status === 204 ? undefined : await response.json();
    assertCurrent();
    return schema.parse(body);
  } finally {
    releaseSessionRequest(controller);
  }
}
