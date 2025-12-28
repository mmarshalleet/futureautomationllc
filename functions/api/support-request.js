export async function onRequestPost(context) {
  const { request, env } = context;

  // Basic CORS (same-origin usage; keep permissive for safety)
  const origin = request.headers.get("Origin") || "*";
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type"
  };

  // Pushover config is stored in Cloudflare Pages environment variables:
  // PUSHOVER_USER_KEY, PUSHOVER_APP_TOKEN
  // Do NOT hardcode secrets in the repo.
  async function sendPushover(title, message, priority = 0) {
    if (!env.PUSHOVER_USER_KEY || !env.PUSHOVER_APP_TOKEN) {
      return { ok: false, skipped: true, reason: "pushover_not_configured" };
    }

    const body = new URLSearchParams({
      token: env.PUSHOVER_APP_TOKEN,
      user: env.PUSHOVER_USER_KEY,
      title,
      message,
      priority: String(priority)
    });

    // Emergency-priority: repeats until acknowledged
    if (priority === 2) {
      body.append("retry", "60");     // seconds between retries
      body.append("expire", "3600");  // 1 hour
    }

    const r = await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { ok: false, status: r.status, error: j?.errors || j || "pushover_error" };
    }
    return { ok: true };
  }

  try {
    const data = await request.json();

    // Honeypot: bots fill hidden fields
    if (data.website && String(data.website).trim().length > 0) {
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    const clean = (v) => (v == null ? "" : String(v)).trim();
    const requestType = clean(data.requestType);
    const urgency = clean(data.urgency);
    const name = clean(data.name);
    const company = clean(data.company);
    const email = clean(data.email);
    const phone = clean(data.phone);
    const location = clean(data.location);
    const preferredContact = clean(data.preferredContact);
    const system = clean(data.system);
    const symptoms = clean(data.symptoms);
    const downtimeImpact = clean(data.downtimeImpact);
    const timeframe = clean(data.timeframe);
    const notes = clean(data.notes);
    const plantDown = !!data.plantDown;

    if (!requestType || !name || !email || !symptoms) {
      return new Response(JSON.stringify({ ok: false, error: "Missing required fields." }), { status: 400, headers });
    }

    const isCritical = plantDown || /critical|plant down/i.test(urgency);

    const title = isCritical ? "🚨 PLANT DOWN" : "New Support Request";
    const message = [
      `Type: ${requestType}`,
      `Urgency: ${isCritical ? "Critical (Plant Down)" : (urgency || "Normal")}`,
      "",
      `Company: ${company || "N/A"}`,
      `Contact: ${name}`,
      `Phone: ${phone || "N/A"}`,
      `Email: ${email}`,
      `Location: ${location || "N/A"}`,
      `Preferred: ${preferredContact || "N/A"}`,
      "",
      `System: ${system || "N/A"}`,
      `Impact: ${downtimeImpact || "N/A"}`,
      `Timeframe: ${timeframe || "N/A"}`,
      "",
      "Issue:",
      symptoms,
      notes ? `\nNotes:\n${notes}` : ""
    ].join("\n").trim();

    const po = await sendPushover(title, message, isCritical ? 2 : 0);

    // Respond OK to avoid leaking configuration details
    return new Response(JSON.stringify({ ok: true, pushover: po }), { headers });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err?.message || "Server error" }), { status: 500, headers });
  }
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "*";
  return new Response(null, {
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}
