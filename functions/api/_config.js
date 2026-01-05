export const CONFIG = {
  standardFee: "495.00",
  emergencyFee: "795.00",
  currency: "USD",
  brandName: "Future Automation LLC",
  // Pages will deploy to prod domain; keep these page paths stable.
  returnPath: "/paid.html",
  cancelPath: "/request-support.html"
};

// Compatibility export for existing PayPal functions
export const PRICING = {
  incidentFee: CONFIG.standardFee,
  currency: CONFIG.currency
};
