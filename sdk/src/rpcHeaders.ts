// HTTP headers every JSON-RPC request carries, assembled from the environment.
//
// The operator's internal sim talks to anvil directly and sets none of these, so the result is an
// empty object and the transport is unchanged. A self-hosted agent on the ASCON practice chain needs
// three: the team's `X-ASCON-Key` (identity + rate-limit bucket) and the two shared Cloudflare Access
// service-token headers that get the request past Cloudflare in front of the gateway.
//
// Two spellings are accepted for the Cloudflare pair: the repo's own (`CF_ACCESS_CLIENT_ID/_SECRET`,
// which the guides already use) and the one in the organizers' snippet (`CF_ID` / `CF_SECRET`), so a
// `.env` copied from their announcement works as-is.
//
// Half a configuration is refused rather than sent. The gateway answers a missing header with a 403
// (an HTML page, for the Cloudflare pair) that the runtime only surfaces as "cannot reach the chain"
// after its preflight retries -- far from the typo that caused it.

export type RpcHeaderEnv = Record<string, string | undefined>;

function pick(env: RpcHeaderEnv, ...names: string[]): string | undefined {
  for (const name of names) {
    const v = env[name]?.trim();
    if (v) return v;
  }
  return undefined;
}

function parseExtraHeaders(raw: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `ERIS_RPC_HEADERS must be a JSON object of header name -> value (${(e as Error).message})`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("ERIS_RPC_HEADERS must be a JSON object of header name -> value");
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== "string")
      throw new Error(`ERIS_RPC_HEADERS["${k}"] must be a string`);
    out[k] = v;
  }
  return out;
}

/** Build the RPC request headers from env. Returns `{}` when nothing is configured (local anvil). */
export function getRpcHeadersFromEnv(
  env: RpcHeaderEnv = process.env,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const cfId = pick(env, "CF_ACCESS_CLIENT_ID", "CF_ID");
  const cfSecret = pick(env, "CF_ACCESS_CLIENT_SECRET", "CF_SECRET");
  if (Boolean(cfId) !== Boolean(cfSecret))
    throw new Error(
      "Cloudflare Access needs both headers: set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET " +
        "(or CF_ID and CF_SECRET), or neither",
    );
  if (cfId && cfSecret) {
    headers["CF-Access-Client-Id"] = cfId;
    headers["CF-Access-Client-Secret"] = cfSecret;
  }
  const asconKey = pick(env, "ASCON_KEY");
  if (asconKey) headers["X-ASCON-Key"] = asconKey;
  // Escape hatch for any other gateway: applied last, so it can override the above.
  if (env.ERIS_RPC_HEADERS?.trim())
    Object.assign(headers, parseExtraHeaders(env.ERIS_RPC_HEADERS));
  return headers;
}

/** Header names only -- safe to log (the values are credentials). */
export function describeRpcHeaders(headers: Record<string, string>): string {
  const names = Object.keys(headers);
  return names.length ? names.join(", ") : "none";
}
