// functions/api/_config.js
export const PRICING = {
    incidentFee: "495.00",
    hourly: "175.00",
    afterHours: "225.00",
    currency: "USD",
};

export function getSiteOrigin(request) {
    return new URL(request.url).origin;
}

// Build PayPal “Buy Now” (Payments Standard) URL with metadata
export function buildPayPalOneTimeUrl({ business, itemName, amount, custom, returnUrl, cancelUrl, notifyUrl }) {
    const params = new URLSearchParams({
        cmd: "_xclick",
        business,
        item_name: itemName,
        amount,
        currency_code: "USD",
        no_shipping: "1",
        // These matter:
        custom,                // your ticket id
        return: returnUrl,     // thank-you page
        cancel_return: cancelUrl,
        notify_url: notifyUrl, // IPN endpoint
    });
    return `https://www.paypal.com/cgi-bin/webscr?${params.toString()}`;
}

// Build PayPal “Subscribe” URL (Payments Standard Subscriptions)
export function buildPayPalSubUrl({ business, itemName, a3, p3, t3, custom, returnUrl, cancelUrl, notifyUrl }) {
    const params = new URLSearchParams({
        cmd: "_xclick-subscriptions",
        business,
        item_name: itemName,
        a3,         // amount per cycle
        p3,         // cycle length
        t3,         // cycle unit: D/W/M/Y
        src: "1",   // recurring
        sra: "1",   // reattempt on failure
        no_shipping: "1",
        custom,
        return: returnUrl,
        cancel_return: cancelUrl,
        notify_url: notifyUrl,
        currency_code: "USD",
    });
    return `https://www.paypal.com/cgi-bin/webscr?${params.toString()}`;
}
