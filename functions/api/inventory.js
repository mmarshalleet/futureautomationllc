function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=300",
      ...extraHeaders
    }
  });
}

function pickTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function stripCdata(s) {
  return String(s).replace(/^<!\\[CDATA\\[/i, "").replace(/\\]\\]>$/i, "");
}

function decodeHtml(s) {
  return String(s)
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function stripHtml(s) {
  return String(s).replace(/<[^>]*>/g, " ").replace(/\\s+/g, " ").trim();
}

function extractImage(html) {
  const m = String(html).match(/<img[^>]+src="([^"]+)"/i);
  return m ? m[1] : "";
}

function extractPrice(text) {
  const m =
    text.match(/US\\s*\\$[\\d,]+(?:\\.\\d{2})?/i) ||
    text.match(/\\$[\\d,]+(?:\\.\\d{2})?/);
  return m ? m[0] : "";
}

function extractCondition(text) {
  const list = [
    "New",
    "New other",
    "New open box",
    "Open box",
    "Used",
    "Manufacturer refurbished",
    "Seller refurbished",
    "For parts or not working"
  ];
  return list.find(c => new RegExp(`\\b${c}\\b`, "i").test(text)) || "";
}

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") return json({}, 204);
  if (request.method !== "GET") return json({ items: [], error: "Method Not Allowed" }, 405);

  const url = new URL(request.url);
  const seller = (url.searchParams.get("seller") || "theautomationengineer").trim();

  const feedUrl =
    `https://www.ebay.com/sch/i.html` +
    `?_ssn=${encodeURIComponent(seller)}` +
    `&LH_Sold=0&rt=nc&rss=1`;

  let xml;
  try {
    const r = await fetch(feedUrl, { headers: { "user-agent": "Mozilla/5.0" } });
    xml = await r.text();
    if (!r.ok) throw new Error("Feed fetch failed");
  } catch (e) {
    return json({ items: [], error: String(e) }, 502);
  }

  const blocks = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];

  const items = blocks.slice(0, 50).map(block => {
    const title = decodeHtml(stripCdata(pickTag(block, "title")));
    const link = decodeHtml(stripCdata(pickTag(block, "link")));
    const descHtml = decodeHtml(stripCdata(pickTag(block, "description")));
    const text = stripHtml(descHtml);

    return {
      title,
      link,
      image: extractImage(descHtml),
      price: extractPrice(text),
      condition: extractCondition(text)
    };
  });

  return json({ items });
}
