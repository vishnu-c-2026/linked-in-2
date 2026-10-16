import { test } from "node:test";
import assert from "node:assert/strict";
import { withBusyRetry } from "../src/util.js";

test("withBusyRetry retries 429/503 with the backoff and returns the first success", async () => {
  const delays = [];
  let calls = 0;
  const result = await withBusyRetry(
    async () => {
      calls += 1;
      if (calls < 3) {
        const e = new Error("busy");
        e.status = 503;
        throw e;
      }
      return "ok";
    },
    { sleep: async (ms) => delays.push(ms) },
  );

  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [2000, 4000]);
});

test("withBusyRetry passes non-transient errors straight through and annotates exhaustion", async () => {
  const delays = [];
  const sleep = async (ms) => delays.push(ms);

  const e400 = new Error("bad request");
  e400.status = 400;
  await assert.rejects(() => withBusyRetry(async () => { throw e400; }, { sleep }), /bad request/);
  assert.deepEqual(delays, [], "400 never waits");

  const e429 = new Error("rate limited");
  e429.status = 429;
  await assert.rejects(
    () => withBusyRetry(async () => { throw e429; }, { attempts: 2, backoff: [500], sleep }),
    /rate limited \(after 2 attempts\)/,
  );
  assert.deepEqual(delays, [500], "one backoff between two attempts");
});
