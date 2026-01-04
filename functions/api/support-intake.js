export async function onRequestPost({ request, env }) {
  const data = await request.formData();

  const pricingTier = data.get("pricingTier") || "standard";
  const isPlantDown = data.get("plantDown") === "on";

  const amount =
    pricingTier === "emergency" || isPlantDown
      ? "795.00"
      : "495.00";

  const itemName =
    pricingTier === "emergency" || isPlantDown
      ? "Emergency Plant-Down Support (Initial Incident)"
      : "Remote Automation Support (Initial Incident)";

  // PAYPAL CHECKOUT
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);

  const tokenRes = await fetch("https://api-m.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const tokenJson = await tokenRes.json();

  const orderRes = await fetch("https://api-m.paypal.com/v2/checkout/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        amount: {
          currency_code: "USD",
          value: amount
        },
        description: itemName
      }],
      application_context: {
        brand_name: "Future Automation LLC",
        user_action: "PAY_NOW",
        return_url: "https://futureautomationllc.com/support-success.html",
        cancel_url: "https://futureautomationllc.com/request-support.html"
      }
    })
  });

  const order = await orderRes.json();
  const approve = order.links.find(l => l.rel === "approve").href;

  return Response.redirect(approve, 302);
}