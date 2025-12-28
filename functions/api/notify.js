export async function onRequestPost({ request, env }) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let payload = {};

    if (contentType.includes("application/json")) {
      payload = await request.json();
    } else {
      const fd = await request.formData();
      for (const [k, v] of fd.entries()) payload[k] = v;
    }

    const type = (payload.type || payload.priority || "support").toString().toLowerCase();
    const isPlantDown =
      type.includes("plant") || type.includes("down") ||
      payload.plantDown === "true" || payload.plantDown === true;

    const name = (payload.name || "").toString().trim();
    const company = (payload.company || "").toString().trim();
    const email = (payload.email || "").toString().trim();
    const location = (payload.location || "").toString().trim();
    const asset = (payload.asset || payload.machine || "").toString().trim();
    const issue = (payload.issue || payload.message || "").toString().trim();

    const title = isPlantDown ? "PLANT DOWN — Support Request" : "Support Request";
    const msgLines = [
      title,
      name ? `Name: ${name}` : null,
      company ? `Company: ${company}` : null,
      email ? `Email: ${email}` : null,
      location ? `Location: ${location}` : null,
      asset ? `Asset: ${asset}` : null,
      issue ? `Issue: ${issue}` : null,
      `Source: ${new URL(request.url).origin}`
    ].filter(Boolean);

    const message = msgLines.join("\n");

    const r = await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: env.PUSHOVER_APP_TOKEN,
        user: env.PUSHOVER_USER_KEY,
        message,
        priority: isPlantDown ? "1" : "0"
      })
    });

    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      return new Response(JSON.stringify({ ok: false, error: json, status: r.status }), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
}
