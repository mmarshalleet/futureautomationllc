// functions/api/_config.js
// Central config shared by endpoints.

export const PRICING = {
  incidentFee: "495.00",
  emergencyFee: "795.00",
  hourly: "175.00",
  afterHours: "225.00",
  currency: "USD",
};

export function getSiteOrigin(request) {
  return new URL(request.url).origin;
}

// PayPal Payments Standard "Buy Now" URL builder (legacy / optional)
export function buildPayPalOneTimeUrl({
  business,
  itemName,
  amount,
  custom,
  returnUrl,
  cancelUrl,
  notifyUrl,
}) {
  const params = new URLSearchParams({
    cmd: "_xclick",
    business,
    item_name: itemName,
    amount,
    currency_code: PRICING.currency,
    no_shipping: "1",
    custom: custom || "",
    return: returnUrl || "",
    cancel_return: cancelUrl || "",
    notify_url: notifyUrl || "",
  });

  return `https://www.paypal.com/cgi-bin/webscr?${params.toString()}`;
}

// PayPal Payments Standard subscription URL builder (legacy / optional)
export function buildPayPalSubscribeUrl({
  business,
  itemName,
  a3,  // amount per cycle
  p3,  // cycle length
  t3,  // cycle unit: D/W/M/Y
  custom,
  returnUrl,
  cancelUrl,
  notifyUrl,
}) {
  const params = new URLSearchParams({
    cmd: "_xclick-subscriptions",
    business,
    item_name: itemName,
    a3: String(a3),
    p3: String(p3),
    t3: String(t3),
    src: "1", // recurring
    sra: "1", // reattempt on failure
    no_shipping: "1",
    custom: custom || "",
    return: returnUrl || "",
    cancel_return: cancelUrl || "",
    notify_url: notifyUrl || "",
    currency_code: PRICING.currency,
  });

  return `https://www.paypal.com/cgi-bin/webscr?${params.toString()}`;
}
