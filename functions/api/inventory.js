let tokenCache = { accessToken: null, expiresAt: 0 };

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=120"
    }
  });
}

async function getAppToken(env) {
  const now = Date.now();
  if (tokenCache.accessToken && now < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken;
  }

  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
    throw new Error("Missing EBAY_CLIENT_ID / EBAY_CLIENT_SECRET (Pages env vars).");
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
  if (!r.ok) throw new Error(`Token error ${r.status}: ${JSON.stringify(data)}`);

  tokenCache.accessToken = data.access_token;
  tokenCache.expiresAt = now + (data.expires_in * 1000);
  return tokenCache.accessToken;
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return json({}, 204);
  if (request.method !== "GET") return json({ items: [], error: "Method Not Allowed" }, 405);

  const url = new URL(request.url);
  const seller = (url.searchParams.get("seller") || "theautomationengineer").trim();

  // Browse API requires q/gtin/epid/category_ids etc. We'll use a broad keyword.
  // You can override with ?q=plc or ?q=allen%20bradley if you want.
  const q = (url.searchParams.get("q") || "automation").trim();

  try {
    const token = await getAppToken(env);

    const filter = `sellers:{${seller}}`;
    const apiUrl =
      `https://api.ebay.com/buy/browse/v1/item_summary/search` +
      `?q=${encodeURIComponent(q)}` +
      `&filter=${encodeURIComponent(filter)}` +
      `&sort=newlyListed` +
      `&limit=50`;

    const r = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
      }
    });

    const data = await r.json();
    if (!r.ok) return json({ items: [], error: `Browse API ${r.status}`, details: data }, 502);

    const items = (data.itemSummaries || []).map(it => ({
      title: it.title || "",
      link: it.itemWebUrl || "",
      image: it.image?.imageUrl || "",
      price: it.price ? `${it.price.currency} ${it.price.value}` : "",
      condition: it.condition || ""
    }));

    return json({ items, seller, q });
  } catch (e) {
    return json({ items: [], error: String(e) }, 502);
  }
}
