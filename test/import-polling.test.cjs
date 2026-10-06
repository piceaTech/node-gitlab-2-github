const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the real helper with isolated imports: no user settings, credentials,
// service clients or network requests are loaded by this regression suite.
const sourcePath = path.join(__dirname, '../src/githubHelper.ts');
const source = fs.readFileSync(process.env.IMPORT_HELPER_SOURCE || sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const sleeps = [];
const exportsObject = {};
vm.runInNewContext(compiled, {
  exports: exportsObject,
  require(id) {
    if (id === '../settings') return { default: { github: { owner: 'example', repo: 'migration' } } };
    if (id === './utils') return { sleep: async ms => { sleeps.push(ms); } };
    throw new Error(`Unexpected runtime import: ${id}`);
  },
  console: { log() {}, error() {} },
});
const { GithubHelper } = exportsObject;
const imported = { data: { status: 'imported', issue_url: 'https://api.github.com/repos/example/migration/issues/42' } };
const pending = { data: { status: 'pending' } };
const error = status => Object.assign(new Error('request failed'), { status });

function fixture(polls, postError) {
  const calls = [];
  const helper = Object.create(GithubHelper.prototype);
  helper.delayInMs = 2;
  helper.githubApi = { request: async (route, payload) => {
    calls.push({ route, payload });
    if (route.startsWith('POST ')) {
      if (postError) throw postError;
      return { data: { id: 123 } };
    }
    assert.equal(route, 'GET /repos/example/migration/import/issues/123');
    assert.ok(polls.length, 'unexpected extra poll');
    const next = polls.shift();
    if (next instanceof Error) throw next;
    return next;
  } };
  const issue = { title: 'Example', body: 'Original body', closed: false };
  return { calls, issue, run: () => helper.requestImportIssue(issue, []) };
}
function assertOnePost(calls) {
  assert.equal(calls.filter(call => call.route.startsWith('POST ')).length, 1);
}

test('normal pending/imported flow preserves payload and returned issue number', async () => {
  const f = fixture([pending, imported]);
  assert.equal(await f.run(), '42');
  assert.equal(f.calls[0].payload.issue, f.issue);
  assert.equal(f.calls[0].payload.comments.length, 0);
  assertOnePost(f.calls);
});

test('transient 500 and 503 status failures retry only GET on the accepted import', async () => {
  sleeps.length = 0;
  const f = fixture([error(500), error(503), imported]);
  assert.equal(await f.run(), '42');
  assertOnePost(f.calls);
  assert.equal(f.calls.length, 4);
  assert.deepEqual(sleeps, [2, 2, 2, 4, 2]);
});

test('retry budget resets after a successful pending response', async () => {
  const f = fixture([error(502), error(502), error(502), pending, error(503), imported]);
  assert.equal(await f.run(), '42');
  assertOnePost(f.calls);
});

test('healthy pending polls do not consume the error retry budget', async () => {
  const f = fixture([...Array(12).fill(pending), imported]);
  assert.equal(await f.run(), '42');
  assertOnePost(f.calls);
});

test('four consecutive status errors exhaust three retries and preserve the error', async () => {
  const last = error(503);
  const f = fixture([error(500), error(502), error(503), last]);
  await assert.rejects(f.run(), e => e === last);
  assert.equal(f.calls.length, 5);
  assertOnePost(f.calls);
});

test('permanent HTTP and unknown network errors retain upstream fail-fast behavior', async () => {
  for (const status of [401, 403, 404, 422, 429, undefined]) {
    const failure = error(status);
    const f = fixture([failure]);
    await assert.rejects(f.run(), e => e === failure);
    assert.equal(f.calls.length, 2);
    assertOnePost(f.calls);
  }
});

test('response.status is recognized for transient errors', async () => {
  const failure = Object.assign(new Error('bad gateway'), { response: { status: 502 } });
  const f = fixture([failure, imported]);
  assert.equal(await f.run(), '42');
  assertOnePost(f.calls);
});

test('failed import returns null without resubmitting', async () => {
  const f = fixture([{ data: { status: 'failed', errors: ['invalid issue'] } }]);
  assert.equal(await f.run(), null);
  assertOnePost(f.calls);
});

test('ambiguous POST failure is never automatically resubmitted', async () => {
  const failure = error(502);
  const f = fixture([], failure);
  await assert.rejects(f.run(), e => e === failure);
  assert.equal(f.calls.length, 1);
});

test('oversized body is rejected before any request', async () => {
  const f = fixture([]);
  f.issue.body = 'x'.repeat(65537);
  await assert.rejects(f.run(), e => String(e).includes('longer than 65536'));
  assert.equal(f.calls.length, 0);
});
