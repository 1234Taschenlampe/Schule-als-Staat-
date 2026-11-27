(function () {
  "use strict";
  const pending = new Map();

  window.SAS_SALE_RETRY = async function (rpc, actor, operation, args) {
    const payload = new TextEncoder().encode(JSON.stringify(args));
    const digest = await crypto.subtle.digest("SHA-256", payload);
    const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    const key = "sas:sale:" + actor + ":" + operation + ":" + fingerprint;
    const existing = pending.get(key);
    if (existing) return existing;

    let requestId = sessionStorage.getItem(key);
    if (!requestId) {
      requestId = crypto.randomUUID();
      sessionStorage.setItem(key, requestId);
    }
    const request = Promise.resolve().then(async () => {
      const result = await rpc(operation, { ...args, p_request_id: requestId });
      sessionStorage.removeItem(key);
      return result;
    }).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
})();
