export async function onRequest({ request }) {
  const url = new URL(request.url);

  // eBay seller RSS feed for active listings
  const seller = (url.searchParams.get("seller") || "theautomationengineer").trim();

  const feedUrl =
    `https://www.ebay.com/sch/i.html` +
    `?_ssn=${encodeURIComponent(seller)}` +
    `&rt=nc` +
    `&LH_Sold=0` +
    `&rss=1`;

  const r = await fetch(feedUrl, {
    headers: { "user-agent": "Mozilla/5.0" } // helps some feeds behave
  });

  const xml = await r.text();

  // Workers runtime usually supports DOMParser
  let items = [];
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const nodes = Array.from(doc.querySelectorAll("item"));

    items = nodes.slice(0, 50).map((n) => {
      const title = n.querySelector("title")?.textContent || "";
      const link = n.querySelector("link")?.textContent || "";
      const desc = n.querySelector("description")?.textContent || "";

      // crude-but-effective image extraction from description HTML
      const imgMatch = desc.match(/<img[^>]+src="([^"]+)"/i);
      const image = imgMatch ? imgMatch[1] : "";

      return { title, link, image };
    });
  } catch (e) {
    return new Response(JSON.stringify({ items: [], error: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  return new Response(JSON.stringify({ items }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300"
    }
  });
}
