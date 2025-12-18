function jsonResponse(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
      ...extraHeaders
    }
  });
}

async function getAppToken(env) {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
    throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET");
  }

  const creds = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope"
  });

  const r = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Token error (${r.status}): ${JSON.stringify(json)}`);
  }

  return json.access_token;
}

export async function onRequest({ request, env }) {
  // Preflight
  if (request.method === "OPTIONS") {
    return jsonResponse({}, 204);
  }

  if (request.method !== "GET") {
    return jsonResponse({ items: [], error: "Method Not Allowed" }, 405);
  }

  try {
    const reqUrl = new URL(request.url);

    // REQUIRED search term (Browse API requires this)
    const q = (reqUrl.searchParams.get("q") || "").trim();
    if (!q) {
      return jsonResponse(
        { items: [], error: "Missing query parameter ?q=" },
        400,
        { "cache-control": "no-store" }
      );
    }

    const seller =
      (reqUrl.searchParams.get("seller") ||
        env.EBAY_SELLER ||
        "theautomationengineer").trim();

    const marketplace = (env.EBAY_MARKETPLACE || "EBAY_US").trim();
    const limit = Math.min(parseInt(reqUrl.searchParams.get("limit") || "24", 10), 50);

    const token = await getAppToken(env);

    const ebayUrl = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
    ebayUrl.searchParams.set("q", q);
    ebayUrl.searchParams.set("limit", String(limit));
    ebayUrl.searchParams.set("filter", `seller:{${seller}}`);

    const r = await fetch(ebayUrl.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": marketplace
      }
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return jsonResponse(
        { items: [], error: `eBay API error (${r.status})`, detail: data },
        502,
        { "cache-control": "no-store" }
      );
    }

    const items = (data.itemSummaries || []).map((it) => ({
      id: it.itemId,
      title: it.title || "",
      ebayUrl: it.itemWebUrl || "",
      condition: it.condition || "",
      image: it.image?.imageUrl || "",
      price: it.price?.value || "",
      currency: it.price?.currency || "USD"
    }));

    return jsonResponse(
      { items },
      200,
      { "cache-control": "public, max-age=120" }
    );
  } catch (err) {
    return jsonResponse(
      { items: [], error: String(err) },
      500,
      { "cache-control": "no-store" }
    );
  }
}