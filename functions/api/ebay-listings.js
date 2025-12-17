function jsonResponse(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Safe even for same-origin; helps if you ever call this from another origin.
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
      ...extraHeaders
    }
  });
}

async function getAppToken(env) {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
    throw new Error("Missing EBAY_CLIENT_ID/EBAY_CLIENT_SECRET");
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
  if (!r.ok) throw new Error(`Token error (${r.status}): ${JSON.stringify(json)}`);

  return json.access_token;
}

export async function onRequest({ request, env }) {
  // Preflight
  if (request.method === "OPTIONS") return jsonResponse({}, 204);

  if (request.method !== "GET") {
    return jsonResponse({ items: [], error: "Method Not Allowed" }, 405);
  }

  try {
    const seller = env.EBAY_SELLER || "theautomationengineer";
    const marketplace = env.EBAY_MARKETPLACE || "EBAY_US";

    const token = await getAppToken(env);

const seller = env.EBAY_SELLER;

const url =
  "https://api.ebay.com/buy/browse/v1/item_summary/search" +
  `?filter=seller:{${seller}}` +
  "&limit=50";

    const r = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": marketplace
      }
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return jsonResponse(
        { items: [], error: `eBay browse error (${r.status})`, detail: data },
        502,
        { "cache-control": "no-store" }
      );
    }

    const items = (data.itemSummaries || []).map((it) => ({
      id: it.itemId,
      title: it.title,
      ebayUrl: it.itemWebUrl,
      condition: it.condition,
      image: it.image?.imageUrl || "",
      price: it.price?.value || "",
      currency: it.price?.currency || "USD"
    }));

    return jsonResponse({ items }, 200, { "cache-control": "public, max-age=120" });
  } catch (e) {
    return jsonResponse({ items: [], error: String(e) }, 500, { "cache-control": "no-store" });
  }
}
