// functions/api/inventory.js
// Cloudflare Pages Function: /api/inventory
// Uses eBay Browse API (official) + app-token (client credentials)
// Env vars required in Cloudflare Pages:
//   EBAY_CLIENT_ID
//   EBAY_CLIENT_SECRET

let tokenCache = {
  accessToken: null,
  expiresAt: 0
};

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization",
      "cache-control": "public, max-age=120",
      ...extraHeaders
    }
  });
}

async function getAppToken(env) {
  const now = Date.now();
  if (tokenCache.accessToken && now < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken;
  }

  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
    throw new Error("Missing EBAY_CLIENT_ID / EBAY_CLIENT_SECRET in Cloudflare Pages env vars.");
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
    body
  });

  const data = await r.json();
  if (!r.ok) {
    throw new Error(`eBay token error ${r.status}: ${JSON.stringify(data)}`);
  }

  tokenCache.accessToken = data.access_token;
  tokenCache.expiresAt = now + (data.expires_in * 1000);
  return tokenCache.accessToken;
}

function toItem(it) {
  return {
    id: it.itemId || "",
    title: it.title || "",
    link: it.itemWebUrl || "",
    image: it.image?.imageUrl || "",
    price: it.price ? `${it.price.currency} ${it.price.value}` : "",
    condition: it.condition || ""
  };
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return json({}, 204);
  if (request.method !== "GET") return json({ items: [], error: "Method Not Allowed" }, 405);

  const url = new URL(request.url);

  // seller defaults to your store
  const seller = (url.searchParams.get("seller") || "theautomationengineer").trim();

  // Optional:
  //   ?q=vfd (single query override)
  // If q is NOT provided, we run a brand sweep and merge results.
  const qParam = (url.searchParams.get("q") || "").trim();

  // Optional:
  //   ?limit=30 (caps final response)
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 80)));

  // Optional:
  //   ?marketplace=EBAY_US (default)
  const marketplace = (url.searchParams.get("marketplace") || "EBAY_US").trim();

  const queries = qParam
    ? [qParam]
    : ["lenze", "allen bradley", "siemens", "automation"];

  try {
    const token = await getAppToken(env);
    const filter = `sellers:{${seller}}`;

    const results = await Promise.all(
      queries.map(async (q) => {
        const apiUrl =
          `https://api.ebay.com/buy/browse/v1/item_summary/search` +
          `?q=${encodeURIComponent(q)}` +
          `&filter=${encodeURIComponent(filter)}` +
          `&sort=newlyListed` +
          `&limit=50`;

        const r = await fetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-EBAY-C-MARKETPLACE-ID": marketplace
          }
        });

        // If one query fails, don’t tank the whole inventory.
        if (!r.ok) return { q, ok: false, items: [], status: r.status };

        const data = await r.json();
        return { q, ok: true, items: data.itemSummaries || [] };
      })
    );

    // Dedupe by itemId
    const byId = new Map();
    for (const res of results) {
      for (const it of res.items) {
        if (it?.itemId && !byId.has(it.itemId)) byId.set(it.itemId, it);
      }
    }

    const items = Array.from(byId.values())
      .slice(0, limit)
      .map(toItem);

    // Light debug metadata so you can see what’s happening if it’s empty
    const meta = {
      seller,
      marketplace,
      queries,
      fetched: results.map(r => ({ q: r.q, ok: r.ok, status: r.status || 200, count: r.items.length })),
      count: items.length
    };

    return json({ items, meta });
  } catch (e) {
    return json({ items: [], error: String(e) }, 502);
  }
}
