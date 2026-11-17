export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({
        service: "hotline-platform-api",
        status: "scaffold",
        database: "not-connected",
        telephony: "not-connected"
      });
    }
    return Response.json({ service: "hotline-platform-api", message: "Hotline Platform API scaffold" }, { status: 200 });
  }
};
