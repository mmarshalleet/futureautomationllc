let cachedToken = null;
let cachedTokenExpMs = 0;

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
      "cache-control": status === 200 ? "public, max-age=180" : "no-store",
      ...extraHeaders
    }
  });
}

function b64(str) {
  // Cloudflare Workers support btoa for ASCII; credentials are safe ASCII.
  return btoa(str);
}

async function getAppToken(env) {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpMs - 60_000) return cachedToken; // 60s safety buffer

  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
    throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET env vars.");
  }

  const creds = b64(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    // Browse API search doc lists api_scope as acceptable for this call
    scope: "https://api.ebay.com/oauth/api_scope"
  });

  const r = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "authorization": `Basic ${creds}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`eBay token error (${r.status}): ${data.error_description || data.error || JSON.stringify(data)}`);
  }

  cachedToken = data.access_token;
  cachedTokenExpMs = now + (Number(data.expires_in || 0) * 1000);
  return cachedToken;
}

function normalizeItem(it) {
  const title = it?.title || "";
  const link = it?.itemWebUrl || "";
  const image =
    it?.image?.imageUrl ||
    it?.thumbnailImages?.[0]?.imageUrl ||
    "";

  const priceVal = it?.price?.value;
  const priceCur = it?.price?.currency;
  const price = (priceVal != null && priceCur)
    ? `${priceVal} ${priceCur}`
    : (priceVal != null ? String(priceVal) : "");

  const condition = it?.condition || it?.conditionId || "";

  return { title, link, image, price, condition };
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return json({}, 204);
  if (request.method !== "GET") return json({ items: [], error: "Method Not Allowed" }, 405);

  const url = new URL(request.url);

  const seller = (url.searchParams.get("seller") || "theautomationengineer").trim();
  const q = (url.searchParams.get("q") || "").trim(); // optional keyword search from your site

  // eBay Browse search endpoint
  // Docs: GET https://api.ebay.com/buy/browse/v1/item_summary/search  [oai_citation:4‡eBay Developers](https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search)
  const endpoint = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");

  // IMPORTANT: Browse search generally expects q when you're doing a "search".
  // If you don't provide q, we send "*" so you can still "show all seller items".
  endpoint.searchParams.set("q", q.length ? q : "*");

  // Seller filter syntax: filter=sellers:{seller1|seller2}  [oai_citation:5‡eBay Developers](https://developer.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html)
  endpoint.searchParams.set("filter", `sellers:{${seller}}`);

  // Pagination
  endpoint.searchParams.set("limit", "50");
  endpoint.searchParams.set("offset", "0");

  try {
    const token = await getAppToken(env);

    const r = await fetch(endpoint.toString(), {
      headers: {
        "authorization": `Bearer ${token}`,
        // Marketplace header is commonly required/expected for Buy APIs
        "x-ebay-c-marketplace-id": "EBAY_US",
        "accept": "application/json"
      }
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(`eBay Browse error (${r.status}): ${data?.errors?.[0]?.message || JSON.stringify(data)}`);
    }

    const items = Array.isArray(data.itemSummaries)
      ? data.itemSummaries.map(normalizeItem)
      : [];

    return json({ items });
  } catch (e) {
    return json({ items: [], error: String(e) }, 502);
  }
}