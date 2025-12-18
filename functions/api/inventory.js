function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
      "cache-control": "public, max-age=180",
      ...extraHeaders
    }
  });
}

function pickTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function stripCdata(s) {
  return String(s)
    .replace(/^<!\\[CDATA\\[/i, "")
    .replace(/\\]\\]>$/i, "");
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
  return String(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function extractImage(html) {
  // eBay RSS description usually contains an <img ... src="...">
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

async function fetchFirstWorkingFeed(urls) {
  let lastErr = null;

  for (const u of urls) {
    try {
      const r = await fetch(u, {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; FutureAutomationBot/1.0)",
          "accept": "application/rss+xml, application/xml, text/xml, */*"
        }
      });

      const text = await r.text();
      if (!r.ok) throw new Error(`Feed fetch failed (${r.status})`);

      // If eBay returns HTML/captcha/etc, there will be no <item> blocks.
      if (!/<item>[\s\S]*?<\/item>/i.test(text)) {
        throw new Error("Feed returned no <item> entries (not RSS or blocked)");
      }

      return { xml: text, source: u };
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("All feed attempts failed");
}

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") return json({}, 204);
  if (request.method !== "GET") return json({ items: [], error: "Method Not Allowed" }, 405);

  const url = new URL(request.url);
  const seller = (url.searchParams.get("seller") || "theautomationengineer").trim();

  // IMPORTANT: eBay uses `_rss=1` (underscore) for RSS output.
  const feedUrls = [
    `https://www.ebay.com/sch/i.html?_ssn=${encodeURIComponent(seller)}&LH_Sold=0&rt=nc&_rss=1`,
    `https://www.ebay.com/rss/sch/i.html?_ssn=${encodeURIComponent(seller)}&LH_Sold=0&rt=nc`,
    `https://www.ebay.com/sch/i.html?_nkw=&_ssn=${encodeURIComponent(seller)}&LH_Sold=0&rt=nc&_rss=1`
  ];

  let xml, feedSource;
  try {
    const got = await fetchFirstWorkingFeed(feedUrls);
    xml = got.xml;
    feedSource = got.source;
  } catch (e) {
    return json(
      { items: [], error: String(e) },
      502,
      { "cache-control": "no-store" }
    );
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

  return json({ items, source: feedSource });
}