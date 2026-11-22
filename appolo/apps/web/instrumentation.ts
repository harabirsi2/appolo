/**
 * Runs once per server process, before the first request.
 *
 * `register` installs graceful shutdown for the Node runtime only — the edge
 * runtime has no persistent process to drain and importing `process` there
 * would break the build.
 *
 * `onRequestError` is Next's hook for errors thrown while rendering or inside
 * route handlers, including the ones that never reach our own try/catch. It is
 * the only place that sees *every* failure, which is exactly what an error
 * reporter needs; without it the only signal is a 500 in the access log.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installLifecycle } = await import("./lib/lifecycle");
    installLifecycle();
  }
}

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind?: string; routePath?: string; routeType?: string },
): Promise<void> {
  const { captureException } = await import("./lib/observability");
  await captureException(error, {
    path: request.path,
    method: request.method,
    router: context.routerKind ?? null,
    route: context.routePath ?? null,
    routeType: context.routeType ?? null,
  });
}
