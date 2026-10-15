/** Native Wrangler runtime host for a service binding; tests use direct RPC, not HTTP. */
export default {
  fetch: () => new Response(null, { status: 404 }),
};
