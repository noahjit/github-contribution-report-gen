// Never serialize an Octokit error wholesale: it can contain authorization
// headers, request bodies and the entire webhook payload.
export function githubDiagnostic(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") return {};
  const e = error as {status?: number; response?: {data?: {message?: unknown}; headers?: Record<string, unknown>}};
  const headers = e.response?.headers ?? {};
  return {
    status: e.status,
    githubMessage: typeof e.response?.data?.message === "string" ? e.response.data.message.slice(0, 500) : undefined,
    githubRequestId: headers["x-github-request-id"],
    acceptedPermissions: headers["x-accepted-github-permissions"],
    rateLimitRemaining: headers["x-ratelimit-remaining"],
    rateLimitReset: headers["x-ratelimit-reset"],
    retryAfter: headers["retry-after"],
  };
}
