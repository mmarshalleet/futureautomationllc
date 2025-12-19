export async function onRequest({ request, env }) {
  try {
    const url = new URL(request.url);
    const seller = (url.searchParams.get("seller") || env.EBAY_SELLER || "theautomationengineer").trim();

    const appId = env.EBAY_CLIENT_ID;
    if (!appId) {
      return new Response(JSON.stringify({ ok: false, error: "Missing EBAY_CLIENT_ID" }, null, 2), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    const endpoint = new URL("https://svcs.ebay.com/services/search/FindingService/v1");
    endpoint.searchParams.set("OPERATION-NAME", "findItemsAdvanced");
    endpoint.searchParams.set("SERVICE-VERSION", "1.13.0");
    endpoint.searchParams.set("SECURITY-APPNAME", appId);
    endpoint.searchParams.set("RESPONSE-DATA-FORMAT", "JSON");
    endpoint.searchParams.set("REST-PAYLOAD", "true");

    endpoint.searchParams.set("paginationInput.entriesPerPage", "5");
    endpoint.searchParams.set("paginationInput.pageNumber", "1");

    endpoint.searchParams.set("itemFilter(0).name", "Seller");
    endpoint.searchParams.set("itemFilter(0).value", seller);

    const r = await fetch(endpoint.toString(), {
      headers: {
        "accept": "application/json",
        "user-agent": "Mozilla/5.0 (compatible; FutureAutomationBot/1.0)"
      }
    });

    const text = await r.text();

    // return raw info no matter what
    return new Response(JSON.stringify({
      ok: true,
      seller,
      endpoint: endpoint.toString(),
      upstreamStatus: r.status,
      upstreamContentType: r.headers.get("content-type"),
      upstreamBodyPreview: text.slice(0, 1200)
    }, null, 2), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      error: String(e),
      stack: String(e?.stack || "")
    }, null, 2), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
}