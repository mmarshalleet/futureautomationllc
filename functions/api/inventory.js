let cachedToken = null;
let cachedTokenExpMs = 0;

function jres(obj, status = 200, cache = "public, max-age=60") {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
      "cache-control": cache
    }
  });
}

async function getAppToken(env) {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpMs - 60_000) return cachedToken;

  const id = env.EBAY_CLIENT_ID;
  const secret = env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET");

  const creds = btoa(`${id}:${secret}`);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope"
  });

  const r = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${creds}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Token error ${r.status}: ${data.error_description || JSON.stringify(data)}`);

  cachedToken = data.access_token;
  cachedTokenExpMs = now + Number(data.expires_in || 0) * 1000;
  return cachedToken;
}

function norm(it) {
  return {
    id: it.itemId || "",
    title: it.title || "",
    link: it.itemWebUrl || "",
    image: it.image?.imageUrl || it.thumbnailImages?.[0]?.imageUrl || "",
    price: it.price ? `${it.price.value} ${it.price.currency}` : "",
    condition: it.condition || ""
  };
}

async function fetchSearch({ token, marketplace, seller, q }) {
  const u = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  u.searchParams.set("q", q);
  u.searchParams.set("filter", `sellers:{${seller}}`);
  u.searchParams.set("limit", "50");
  u.searchParams.set("offset", "0");

  const r = await fetch(u.toString(), {
    headers: {
      authorization: `Bearer ${token}`,
      "x-ebay-c-marketplace-id": marketplace,
      accept: "application/json"
    }
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Browse error ${r.status} for q="${q}": ${JSON.stringify(data)}`);

  return Array.isArray(data.itemSummaries) ? data.itemSummaries : [];
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return jres({}, 204);
  if (request.method !== "GET") return jres({ items: [], error: "Method Not Allowed" }, 405, "no-store");

  const url = new URL(request.url);
  const debug = url.searchParams.get("debug") === "1";
  const seller = (url.searchParams.get("seller") || env.EBAY_SELLER || "theautomationengineer").trim();
  const marketplace = (env.EBAY_MARKETPLACE || "EBAY_US").trim();

  // Use a “seed list” that actually matches industrial titles
  const seeds = [
    "allen", "rockwell", "siemens", "lenze", "powerflex",
    "plc", "hmi", "vfd", "drive", "module", "relay", "safety", "servo"
  ];

  try {
    const token = await getAppToken(env);

    const settled = await Promise.allSettled(
      seeds.map(q => fetchSearch({ token, marketplace, seller, q }))
    );

    const merged = new Map(); // itemId -> normalized item
    const errors = [];

    for (const s of settled) {
      if (s.status === "fulfilled") {
        for (const it of s.value) merged.set(it.itemId, norm(it));
      } else {
        errors.push(String(s.reason));
      }
    }

    const items = Array.from(merged.values()).filter(it => it.id);

    return jres(
      debug ? { items, count: items.length, seller, marketplace, errors } : { items },
      200,
      "public, max-age=120"
    );
  } catch (e) {
    return jres({ items: [], error: String(e) }, 500, "no-store");
  }
}