// RPC gateway headers from env: none for local anvil, all three for the ASCON practice chain, and a
// loud refusal for half a configuration (the gateway would answer it with a 403 far from the typo).
import test from "node:test";
import assert from "node:assert/strict";
import {
  describeRpcHeaders,
  getRpcHeadersFromEnv,
} from "@eris/sdk/rpcHeaders.js";

test("should send no headers when nothing is configured (local anvil)", () => {
  assert.deepEqual(getRpcHeadersFromEnv({}), {});
});

test("should send X-ASCON-Key and both CF-Access headers when all are set", () => {
  const headers = getRpcHeadersFromEnv({
    ASCON_KEY: "team-key",
    CF_ACCESS_CLIENT_ID: "cf-id",
    CF_ACCESS_CLIENT_SECRET: "cf-secret",
  });
  assert.deepEqual(headers, {
    "CF-Access-Client-Id": "cf-id",
    "CF-Access-Client-Secret": "cf-secret",
    "X-ASCON-Key": "team-key",
  });
});

test("should accept the organizers' CF_ID / CF_SECRET spelling", () => {
  const headers = getRpcHeadersFromEnv({ CF_ID: "a", CF_SECRET: "b" });
  assert.equal(headers["CF-Access-Client-Id"], "a");
  assert.equal(headers["CF-Access-Client-Secret"], "b");
});

test("should prefer CF_ACCESS_* over CF_ID / CF_SECRET when both are set", () => {
  const headers = getRpcHeadersFromEnv({
    CF_ACCESS_CLIENT_ID: "repo",
    CF_ACCESS_CLIENT_SECRET: "repo-s",
    CF_ID: "snippet",
    CF_SECRET: "snippet-s",
  });
  assert.equal(headers["CF-Access-Client-Id"], "repo");
});

test("should throw when only one of the CF-Access pair is set", () => {
  assert.throws(() => getRpcHeadersFromEnv({ CF_ID: "a" }), /both headers/);
  assert.throws(
    () => getRpcHeadersFromEnv({ CF_ACCESS_CLIENT_SECRET: "b" }),
    /both headers/,
  );
});

test("should treat blank values as unset", () => {
  assert.deepEqual(
    getRpcHeadersFromEnv({ ASCON_KEY: "  ", CF_ID: "", CF_SECRET: "" }),
    {},
  );
});

test("should let ERIS_RPC_HEADERS add or override headers", () => {
  const headers = getRpcHeadersFromEnv({
    ASCON_KEY: "k",
    ERIS_RPC_HEADERS: '{"X-ASCON-Key":"override","X-Extra":"1"}',
  });
  assert.deepEqual(headers, { "X-ASCON-Key": "override", "X-Extra": "1" });
});

test("should throw when ERIS_RPC_HEADERS is not a JSON object of strings", () => {
  assert.throws(() => getRpcHeadersFromEnv({ ERIS_RPC_HEADERS: "{oops" }));
  assert.throws(() => getRpcHeadersFromEnv({ ERIS_RPC_HEADERS: "[]" }));
  assert.throws(() => getRpcHeadersFromEnv({ ERIS_RPC_HEADERS: '{"a":1}' }));
});

test("should describe header names without their values", () => {
  const text = describeRpcHeaders({ "X-ASCON-Key": "secret-value" });
  assert.equal(text, "X-ASCON-Key");
  assert.equal(describeRpcHeaders({}), "none");
});
