# Focused import polling regression tests

After `npm ci`, run on Node.js 18 or newer:

```sh
node --test test/import-polling.test.cjs
```

The tests transpile the actual `GithubHelper` with the existing TypeScript dependency
and replace its runtime imports with isolated test doubles. They do not load local
settings, contact GitHub/GitLab, or execute a migration. They exercise successful,
pending, failed, transient and permanent-error responses, bounded retries, and
verify that the accepted import is never POSTed again within this method.

These are behavioral regression tests, not a project-wide typecheck or live API
compatibility test. Existing caller-level replacement-issue behavior is unchanged.
