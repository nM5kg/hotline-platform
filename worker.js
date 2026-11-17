import { neon } from "@neondatabase/serverless";

const json = (data, status = 200, origin = "*") =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization"
    }
  });

async function readBody(request) {
  try { return await request.json(); }
  catch { return null; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type,authorization",
          "access-control-max-age": "86400"
        }
      });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      let database = "not-configured";
      if (env.DATABASE_URL) {
        try {
          const sql = neon(env.DATABASE_URL);
          await sql`SELECT 1 AS connected`;
          database = "connected";
        } catch (error) {
          return json({
            service: "hotline-platform-api",
            status: "degraded",
            database: "error",
            error: "Database connection failed"
          }, 503, origin);
        }
      }
      return json({
        service: "hotline-platform-api",
        status: database === "connected" ? "ok" : "not-configured",
        database,
        telephony: "not-connected"
      }, database === "connected" ? 200 : 503, origin);
    }

    if (!env.API_TOKEN) {
      return json({ error: "API is not configured" }, 503, origin);
    }
    if (request.headers.get("authorization") !== `Bearer ${env.API_TOKEN}`) {
      return json({ error: "Unauthorized" }, 401, origin);
    }
    if (!env.DATABASE_URL) {
      return json({ error: "Database is not configured" }, 503, origin);
    }

    const sql = neon(env.DATABASE_URL);

    try {
      if (url.pathname === "/api/v1/tenants" && request.method === "GET") {
        const rows = await sql`SELECT id, name, status, created_at, updated_at FROM tenants ORDER BY created_at DESC LIMIT 200`;
        return json({ data: rows }, 200, origin);
      }

      if (url.pathname === "/api/v1/tenants" && request.method === "POST") {
        const body = await readBody(request);
        if (!body || typeof body.name !== "string" || !body.name.trim()) {
          return json({ error: "A non-empty name is required" }, 400, origin);
        }
        const rows = await sql`INSERT INTO tenants (name) VALUES (${body.name.trim()}) RETURNING id, name, status, created_at, updated_at`;
        return json({ data: rows[0] }, 201, origin);
      }

      if (url.pathname === "/api/v1/hotlines" && request.method === "GET") {
        const tenantId = url.searchParams.get("tenant_id");
        const rows = tenantId
          ? await sql`SELECT id, tenant_id, name, extension, status, timezone, settings, created_at, updated_at FROM hotlines WHERE tenant_id = ${tenantId}::uuid ORDER BY created_at DESC LIMIT 200`
          : await sql`SELECT id, tenant_id, name, extension, status, timezone, settings, created_at, updated_at FROM hotlines ORDER BY created_at DESC LIMIT 200`;
        return json({ data: rows }, 200, origin);
      }

      if (url.pathname === "/api/v1/hotlines" && request.method === "POST") {
        const body = await readBody(request);
        if (!body || typeof body.tenant_id !== "string" || typeof body.name !== "string" || !body.name.trim() || typeof body.extension !== "string" || !body.extension.trim()) {
          return json({ error: "tenant_id, name and extension are required" }, 400, origin);
        }
        const rows = await sql`INSERT INTO hotlines (tenant_id, name, extension, timezone, settings) VALUES (${body.tenant_id}::uuid, ${body.name.trim()}, ${body.extension.trim()}, ${typeof body.timezone === "string" ? body.timezone : "America/New_York"}, ${JSON.stringify(body.settings && typeof body.settings === "object" ? body.settings : {})}::jsonb) RETURNING id, tenant_id, name, extension, status, timezone, settings, created_at, updated_at`;
        return json({ data: rows[0] }, 201, origin);
      }

      if (url.pathname === "/api/v1/menu-nodes" && request.method === "GET") {
        const hotlineId = url.searchParams.get("hotline_id");
        if (!hotlineId) return json({ error: "hotline_id is required" }, 400, origin);
        const rows = await sql`SELECT id, hotline_id, parent_id, node_type, title, digit, position, config, created_at FROM menu_nodes WHERE hotline_id = ${hotlineId}::uuid ORDER BY position, created_at`;
        return json({ data: rows }, 200, origin);
      }

      if (url.pathname === "/api/v1/menu-nodes" && request.method === "POST") {
        const body = await readBody(request);
        if (!body || typeof body.hotline_id !== "string" || typeof body.node_type !== "string" || typeof body.title !== "string" || !body.title.trim()) {
          return json({ error: "hotline_id, node_type and title are required" }, 400, origin);
        }
        const rows = await sql`INSERT INTO menu_nodes (hotline_id, parent_id, node_type, title, digit, position, config) VALUES (${body.hotline_id}::uuid, ${body.parent_id || null}::uuid, ${body.node_type}, ${body.title.trim()}, ${body.digit ?? null}, ${Number.isInteger(body.position) ? body.position : 0}, ${JSON.stringify(body.config && typeof body.config === "object" ? body.config : {})}::jsonb) RETURNING id, hotline_id, parent_id, node_type, title, digit, position, config, created_at`;
        return json({ data: rows[0] }, 201, origin);
      }

      return json({ error: "Not found" }, 404, origin);
    } catch (error) {
      return json({ error: "Request failed", detail: env.ENVIRONMENT === "development" ? String(error) : undefined }, 500, origin);
    }
  }
};
