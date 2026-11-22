export default {
  async fetch(request, env) {
    const originalScheme = getOriginalScheme(request);
    const url = new URL(request.url);

    // One address for search engines: http and www both land on https://howtogit.dev.
    if (originalScheme === "http" || url.hostname.startsWith("www.")) {
      url.protocol = "https:";
      url.hostname = url.hostname.replace(/^www\./, "");
      return Response.redirect(url.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  },
};

function getOriginalScheme(request) {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0].trim().toLowerCase();
  }

  const cfVisitor = request.headers.get("cf-visitor");
  if (cfVisitor) {
    try {
      const visitor = JSON.parse(cfVisitor);
      if (typeof visitor.scheme === "string") {
        return visitor.scheme.toLowerCase();
      }
    } catch (_) {
      // Ignore malformed headers and fall back to the request URL.
    }
  }

  return new URL(request.url).protocol.replace(":", "").toLowerCase();
}
