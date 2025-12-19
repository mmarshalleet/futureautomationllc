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

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return json({}, 204);
  if (request.method !== "GET") return json({ items: [], error: "Method Not Allowed" }, 405);

  const url = new URL(request.url);
  const seller = (url.searchParams.get("seller") || "theautomationengineer").trim();

  // Use PRODUCTION Client ID as the AppID for Finding API calls
  const appId = env.EBAY_CLIENT_ID;
  if (!appId) return json({ items: [], error: "Missing EBAY_CLIENT_ID env var." }, 502);

  // Finding API endpoint
  const endpoint = new URL("https://svcs.ebay.com/services/search/FindingService/v1");

  // Required request params
  endpoint.searchParams.set("OPERATION-NAME", "findItemsAdvanced");
  endpoint.searchParams.set("SERVICE-VERSION", "1.13.0");
  endpoint.searchParams.set("SECURITY-APPNAME", appId);
  endpoint.searchParams.set("RESPONSE-DATA-FORMAT", "JSON");
  endpoint.searchParams.set("REST-PAYLOAD", "true");

  // Pagination
  endpoint.searchParams.set("paginationInput.entriesPerPage", "50");
  endpoint.searchParams.set("paginationInput.pageNumber", "1");

  // Seller filter (this is the magic)
  endpoint.searchParams.set("itemFilter(0).name", "Seller");
  endpoint.searchParams.set("itemFilter(0).value", seller);

  // eBay recommends LocatedIn=WorldWide to ensure you see all items regardless of location
  endpoint.searchParams.set("itemFilter(1).name", "LocatedIn");
  endpoint.searchParams.set("itemFilter(1).value", "WorldWide");

  // Prefer richer image URLs when available
  endpoint.searchParams.set("outputSelector(0)", "PictureURLLarge");
  endpoint.searchParams.set("outputSelector(1)", "PictureURLSuperSize");

  try {
    const r = await fetch(endpoint.toString(), {
      headers: {
        "accept": "application/json",
        "user-agent": "Mozilla/5.0 (compatible; FutureAutomationBot/1.0)"
      }
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Finding API HTTP ${r.status}`);

    const resp = data?.findItemsAdvancedResponse?.[0];
    const ack = resp?.ack?.[0];
    if (ack !== "Success") {
      const errMsg =
        resp?.errorMessage?.[0]?.error?.[0]?.message?.[0] ||
        JSON.stringify(resp?.errorMessage || data);
      throw new Error(`Finding API error: ${errMsg}`);
    }

    const arr = resp?.searchResult?.[0]?.item || [];
    const items = Array.isArray(arr) ? arr.map(toItem) : [];

    return json({ items });
  } catch (e) {
    return json({ items: [], error: String(e) }, 502);
  }
}