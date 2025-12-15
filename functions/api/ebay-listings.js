async function getAppToken(env) {
  // eBay OAuth2 Client Credentials grant (app token)
  // Requires EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in env vars.
  const creds = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope"
  });

  const r = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const json = await r.json();
  if (!r.ok) throw new Error(`Token error: ${JSON.stringify(json)}`);
  return json.access_token;
}

export async function onRequestGet({ env }) {
  try {
    const seller = env.EBAY_SELLER || "theautomationengineer";
    const marketplace = env.EBAY_MARKETPLACE || "EBAY_US";

    if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
      return new Response(JSON.stringify({ items: [], error: "Missing EBAY_CLIENT_ID/EBAY_CLIENT_SECRET" }), {
        headers: { "content-type": "application/json" },
        status: 500
      });
    }

    const token = await getAppToken(env);

    // Browse API: search item summaries by seller
    const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
    url.searchParams.set("limit", "50");
    url.searchParams.set("filter", `sellers:{${seller}}`);

    const r = await fetch(url.toString(), {
      headers: {
        "Authorization": `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": marketplace
      }
    });

    const data = await r.json();
    if (!r.ok) {
      return new Response(JSON.stringify({ items: [], error: "eBay browse error", detail: data }), {
        headers: { "content-type": "application/json" },
        status: 502
      });
    }

    const items = (data.itemSummaries || []).map(it => ({
      id: it.itemId,
      title: it.title,
      ebayUrl: it.itemWebUrl,
      condition: it.condition,
      image: it.image?.imageUrl || "",
      price: it.price?.value || "",
      currency: it.price?.currency || "USD"
    }));

    return new Response(JSON.stringify({ items }), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=120"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ items: [], error: String(e) }), {
      headers: { "content-type": "application/json" },
      status: 500
    });
  }
}
