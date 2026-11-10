export function assertOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") || new URL(request.url).host;
  if (origin && new URL(origin).host !== host)
    throw new Error("Cross-origin request rejected");
}
