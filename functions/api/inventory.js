let tokenCache = null;
let tokenExp = 0;

async function getToken(env) {
  const now = Date.now();
  if (tokenCache && now < tokenExp - 60000) return tokenCache;

  const creds = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
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

  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));

  tokenCache = j.access_token;
  tokenExp = now + j.expires_in * 1000;
  return tokenCache;
}

export async function onRequest({ env }) {
  try {
    const token = await getToken(env);

    const endpoint = new URL(
      "https://api.ebay.com/buy/browse/v1/item_summary/search"
    );

    // Keyword seed — required
    endpoint.searchParams.set("q", "automation");
    endpoint.searchParams.set(
      "filter",
      `sellers:{${env.EBAY_SELLER || "theautomationengineer"}}`
    );
    endpoint.searchParams.set("limit", "50");

    const r = await fetch(endpoint.toString(), {
      headers: {
        authorization: `Bearer ${token}`,
        "x-ebay-c-marketplace-id": "EBAY_US"
      }
    });

    const j = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(j));

    const items = (j.itemSummaries || []).map(i => ({
      title: i.title,
      link: i.itemWebUrl,
      image: i.image?.imageUrl || "",
      price: i.price
        ? `${i.price.value} ${i.price.currency}`
        : "",
      condition: i.condition || ""
    }));

    return new Response(JSON.stringify({ items }), {
      headers: { "content-type": "application/json" }
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ items: [], error: String(e) }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}