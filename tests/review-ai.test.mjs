import test from "node:test";
import assert from "node:assert/strict";
import { createBreakdownHandler } from "../supabase/functions/review-task-breakdown/handler.ts";
const tasks = ["learn", "practice", "recap"].map((phase) => ({
  title: phase,
  content: "复习给定范围",
  phase,
  minutes: 25,
}));
function fixture(overrides = {}) {
  let calls = 0;
  const handler = createBreakdownHandler({
    apiKey: "test-key",
    authenticate: async (token) =>
      token === "valid"
        ? { id: "owner", email: "qianzihanduo@gmail.com" }
        : null,
    loadPlanner: async () => ({
      revision: 2,
      document: {
        exams: [
          {
            id: "exam",
            subject: "数学",
            title: "期末",
            scope: "第一章",
            mastery: "weak",
          },
        ],
      },
    }),
    fetcher: async (_url, init) => {
      calls++;
      const body = JSON.parse(init.body);
      assert.equal(body.thinking.type, "disabled");
      assert.equal(body.response_format.type, "json_object");
      assert.ok(!body.messages[1].content.includes("课程表"));
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify({ tasks, warnings: [] }) },
          },
        ],
      });
    },
    ...overrides,
  });
  return { handler, calls: () => calls };
}
function request(
  body = { examId: "exam", expectedRevision: 2 },
  token = "valid",
) {
  return new Request("https://example.test", {
    method: "POST",
    headers: token
      ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      : {},
    body: JSON.stringify(body),
  });
}
test("missing, invalid and unauthorized identities cannot call the model", async () => {
  const f = fixture();
  assert.equal((await f.handler(request(undefined, ""))).status, 401);
  assert.equal((await f.handler(request(undefined, "invalid"))).status, 401);
  assert.equal(f.calls(), 0);
  const other = fixture({
    authenticate: async () => ({ id: "other", email: "other@example.test" }),
  });
  assert.equal((await other.handler(request())).status, 403);
  assert.equal(other.calls(), 0);
});
test("stale revision and absent exam are rejected before model invocation", async () => {
  const f = fixture();
  assert.equal(
    (await f.handler(request({ examId: "exam", expectedRevision: 1 }))).status,
    409,
  );
  assert.equal(
    (await f.handler(request({ examId: "other", expectedRevision: 2 }))).status,
    404,
  );
  assert.equal(f.calls(), 0);
});
test("valid response returns editable structured tasks without writing a plan", async () => {
  const f = fixture(),
    response = await f.handler(request());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.tasks.length, 3);
  assert.equal(result.tasks[0].order, 1);
  assert.equal(f.calls(), 1);
});
test("missing credentials, insufficient balance, timeout, empty and truncated JSON have recoverable errors", async () => {
  const cases = [
    [{ apiKey: undefined }, "ai_not_configured"],
    [{ fetcher: async () => new Response("", { status: 402 }) }, "ai_balance"],
    [
      {
        fetcher: async () => {
          throw new DOMException("timeout", "TimeoutError");
        },
      },
      "ai_timeout",
    ],
    [
      {
        fetcher: async () =>
          Response.json({
            choices: [{ finish_reason: "stop", message: { content: "  " } }],
          }),
      },
      "invalid_ai_response",
    ],
    [
      {
        fetcher: async () =>
          Response.json({
            choices: [
              {
                finish_reason: "length",
                message: { content: JSON.stringify({ tasks, warnings: [] }) },
              },
            ],
          }),
      },
      "invalid_ai_response",
    ],
    [
      {
        fetcher: async () =>
          Response.json({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    tasks: [{ ...tasks[0], minutes: 12 }],
                    warnings: [],
                  }),
                },
              },
            ],
          }),
      },
      "invalid_ai_response",
    ],
  ];
  for (const [overrides, expected] of cases) {
    const f = fixture(overrides);
    assert.equal((await (await f.handler(request())).json()).error, expected);
  }
});
test("CORS preflight does not require a session or call the model", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.handler(
        new Request("https://example.test", { method: "OPTIONS" }),
      )
    ).status,
    204,
  );
  assert.equal(f.calls(), 0);
});
