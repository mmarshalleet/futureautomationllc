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

function decodeHtml(s) {
  return String(s)
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function stripCdata(s) {
  return String(s).replace(/^<!\[CDATA\[/i, "").replace(/\]\]>$/i, "");
}

function stripHtml(s) {
  return String(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function extractFirstImg(html) {
  const m = String(html).match(/<img[^>]+src="([^"]+)"/i);
  return m ? m[1] : "";
}

function extractPrice(text) {
  // eBay RSS usually includes something like: "US $249.99" or "$249.99"
  const t = String(text);
  const m =
    t.match(/\bUS\s*\$\s*[\d,]+(?:\.\d{2})?\b/i) ||
    t.match(/\$\s*[\d,]+(?:\.\d{2})?\b/);
  return m ? m[0].replace(/\s+/g, " ").trim() : "";
}

function extractCondition(text) {
  const t = String(text);
  const candidates = [
    "New",
    "New other",
    "New open box",
    "Open box",
    "Used",
    "For parts or not working",
    "Manufacturer refurbished",
    "Seller refurbished",
    "Refurbished"
  ];
  const found = candidates.find((c) => new RegExp(`\\b${c.replace(/ /g, "\\s+")}\\b`, "i").test(t));
  return found || "";
}

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") return json({}, 204, { "cache-control": "no-store" });
  if (request.method !== "GET") return json({ items: [], error: "Method Not Allowed" }, 405, { "cache-control": "no-store" });

  const url = new URL(request.url);
  const sellerfilter = (url.searchParams.get("sellerfilter") || "theautomationengineer").trim();

  const feedUrl =
    `https://www.eBay.com/sch/i.html` +
    `?_ssn=${encodeURIComponent(sellerfilter)}` +
    `&rt=nc` +
    `&LH_Sold=0` +
    `&rss=1`;

  let xml = "";
  try {
    const r = await fetch(feedUrl, {
      headers: { "user-agent": "Mozilla/5.0" }
    });

    xml = await r.text();
    if (!r.ok || !xml) {
      return json(
        { items: [], error: `Feed fetch failed (${r.status})` },
        502,
        { "cache-control": "no-store" }
      );
    }
  } catch (e) {
    return json({ items: [], error: String(e) }, 502, { "cache-control": "no-store" });
  }

  // Parse items without DOMParser (more reliable in Workers)
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  const items = itemBlocks.slice(0, 50).map((block) => {
    const titleRaw = pickTag(block, "title");
    const linkRaw = pickTag(block, "link");
    const descRaw = pickTag(block, "description");

    const title = decodeHtml(stripCdata(titleRaw));
    const link = decodeHtml(stripCdata(linkRaw));

    const descHtml = decodeHtml(stripCdata(descRaw));
    const image = extractFirstImg(descHtml);

    // try to extract price/condition from the description text
    const descText = stripHtml(descHtml);
    const price = extractPrice(descText);
    const condition = extractCondition(descText);

    return { title, link, image, price, condition };
  });

  return json({ items });
}