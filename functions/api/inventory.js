function respond(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
      "cache-control": status === 200 ? "public, max-age=60" : "no-store"
    }
  });
}

function toItem(it) {
  const title = it?.title?.[0] || "";
  const link = it?.viewItemURL?.[0] || "";
  const image =
    it?.galleryURL?.[0] ||
    it?.pictureURLLarge?.[0] ||
    it?.pictureURLSuperSize?.[0] ||
    "";

  const priceObj = it?.sellingStatus?.[0]?.currentPrice?.[0];
  const priceVal = priceObj?.__value__ ?? "";
  const currency = priceObj?.["@currencyId"] ?? "";
  const price = priceVal !== "" ? `${priceVal} ${currency}`.trim() : "";

  const condition =
    it?.condition?.[0]?.conditionDisplayName?.[0] ||
    "";

  return { title, link, image, price, condition };
}

export async function onRequest(context) {
  const { request, env } = context;

  try {
    if (request.method === "OPTIONS") return respond({}, 204);
    if (request.method !== "GET") return respond({ items: [], error: "Method Not Allowed" }, 405);

    const url = new URL(request.url);
    const debug = url.searchParams.get("debug") === "1";
    const seller = (url.searchParams.get("seller") || env.EBAY_SELLER || "theautomationengineer").trim();

    // NOTE: You currently have EBAY_CLIENT_ID in Cloudflare (good). Finding API uses it as the AppID.
    const appId = env.EBAY_CLIENT_ID;
    if (!appId) return respond({ items: [], error: "Missing env var: EBAY_CLIENT_ID" }, 500);

    const endpoint = new URL("https://svcs.ebay.com/services/search/FindingService/v1");
    endpoint.searchParams.set("OPERATION-NAME", "findItemsAdvanced");
    endpoint.searchParams.set("SERVICE-VERSION", "1.13.0");
    endpoint.searchParams.set("SECURITY-APPNAME", appId);
    endpoint.searchParams.set("RESPONSE-DATA-FORMAT", "JSON");
    endpoint.searchParams.set("REST-PAYLOAD", "true");

    endpoint.searchParams.set("paginationInput.entriesPerPage", "50");
    endpoint.searchParams.set("paginationInput.pageNumber", "1");

    endpoint.searchParams.set("itemFilter(0).name", "Seller");
    endpoint.searchParams.set("itemFilter(0).value", seller);

    endpoint.searchParams.set("itemFilter(1).name", "LocatedIn");
    endpoint.searchParams.set("itemFilter(1).value", "WorldWide");

    endpoint.searchParams.set("outputSelector(0)", "PictureURLLarge");
    endpoint.searchParams.set("outputSelector(1)", "PictureURLSuperSize");

    const r = await fetch(endpoint.toString(), {
      headers: {
        "accept": "application/json",
        "user-agent": "Mozilla/5.0 (compatible; FutureAutomationBot/1.0)"
      }
    });

    const raw = await r.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      // If eBay returns HTML or something unexpected, show it.
      return respond({
        items: [],
        error: "Upstream did not return JSON",
        upstreamStatus: r.status,
        upstreamContentType: r.headers.get("content-type"),
        upstreamBodyPreview: raw.slice(0, 500),
        endpoint: debug ? endpoint.toString() : undefined
      }, 502);
    }

    const resp = data?.findItemsAdvancedResponse?.[0];
    const ack = resp?.ack?.[0];

    if (ack !== "Success") {
      const errMsg =
        resp?.errorMessage?.[0]?.error?.[0]?.message?.[0] ||
        "Unknown Finding API error";
      return respond({
        items: [],
        error: `Finding API error: ${errMsg}`,
        upstreamStatus: r.status,
        endpoint: debug ? endpoint.toString() : undefined,
        raw: debug ? data : undefined
      }, 502);
    }

    const arr = resp?.searchResult?.[0]?.item || [];
    const items = Array.isArray(arr) ? arr.map(toItem) : [];

    return respond({
      items,
      count: items.length,
      seller: debug ? seller : undefined
    });
  } catch (e) {
    // This should prevent Cloudflare's generic 502 page.
    return respond({ items: [], error: String(e), stack: String(e?.stack || "") }, 500);
  }
}