# CLI Test Plan

## Scope

61 resources, 200+ actions. This plan covers **categories** of operations rather than every single command. Each category has representative commands that, if they pass, indicate the whole category works.

## Prerequisites

- Server running on `http://localhost:3000`
- Auth token from `bonsai auth login`
- Test project: `proj_019de91f-ec0c-74ad-86b2-67a4ab338dc0` (Matchbox Collector)

---

## 1. Basic Invocation

| # | Test | Command | Expected |
|---|------|---------|----------|
| 1.1 | Version flag | `bonsai --version` | Prints version |
| 1.2 | Help | `bonsai --help` | Lists all resources |
| 1.3 | Resource help | `bonsai agents --help` | Shows project-scoped + actions |
| 1.4 | Action help | `bonsai agents list --help` | Shows all options |
| 1.5 | Unknown command | `bonsai foobar` | Error, non-zero exit |

## 2. Authentication & Config

| # | Test | Command | Expected |
|---|------|---------|----------|
| 2.1 | Login | `bonsai auth login -u patryk@utter.one -p ...` | Saves token to `~/.bonsairc` |
| 2.2 | Token from file | `bonsai projects list --base-url http://localhost:3000` | Uses saved token |
| 2.3 | Token override | `bonsai projects list --base-url ... --token <token>` | Uses CLI token |
| 2.4 | Invalid token | `bonsai projects list --base-url ... --token invalid` | `UNAUTHORIZED` error, exit 3 |
| 2.5 | No token | (remove `~/.bonsairc`, run list) | `UNAUTHORIZED` error, exit 3 |
| 2.6 | Base URL override | `bonsai projects list --base-url http://localhost:3000` | Works |
| 2.7 | ENV base URL | `BONSAI_API_BASE_URL=http://localhost:3000 bonsai projects list` | Works |
| 2.8 | Invalid base URL | `bonsai projects list --base-url http://localhost:9999` | `NETWORK_ERROR`, exit 8 |
| 2.9 | Timeout override | `bonsai projects list --base-url ... --timeout 5000` | Works |

## 3. Global List Commands (no project)

| # | Test | Command | Expected |
|---|------|---------|----------|
| 3.1 | operators list | `bonsai operators list --base-url ...` | Returns operators |
| 3.2 | providers list | `bonsai providers list --base-url ...` | Returns providers |
| 3.3 | environments list | `bonsai environments list --base-url ...` | Returns environments |
| 3.4 | provider_catalog list | `bonsai provider_catalog list --base-url ...` | Returns catalog |
| 3.5 | channel_catalog list | `bonsai channel_catalog list --base-url ...` | Returns channels |
| 3.6 | secrets list | `bonsai secrets list --base-url ...` | Returns secrets |
| 3.7 | issues list | `bonsai issues list --base-url ...` | Returns issues |
| 3.8 | benchmarks_suites list | `bonsai benchmarks_suites list --base-url ...` | Returns suites (may be empty) |
| 3.9 | audit_logs audit | `bonsai audit_logs audit --base-url ...` | Returns audit logs |

## 4. Project-Scoped List Commands

| # | Test | Command | Expected |
|---|------|---------|----------|
| 4.1 | agents list | `bonsai agents list --base-url ... --project <id>` | Returns agents |
| 4.2 | stages list | `bonsai stages list --base-url ... --project <id>` | Returns stages |
| 4.3 | users list | `bonsai users list --base-url ... --project <id>` | Returns users |
| 4.4 | conversations list | `bonsai conversations list --base-url ... --project <id>` | Returns conversations |
| 4.5 | tools list | `bonsai tools list --base-url ... --project <id>` | Returns tools |
| 4.6 | classifiers list | `bonsai classifiers list --base-url ... --project <id>` | Returns classifiers |
| 4.7 | knowledge_categories list | `bonsai knowledge_categories list --base-url ... --project <id>` | Returns categories |
| 4.8 | guardrails list | `bonsai guardrails list --base-url ... --project <id>` | Returns guardrails |
| 4.9 | Missing project | `bonsai agents list --base-url ...` | `MISSING_PROJECT`, exit 2 |

## 5. Profile & Self

| # | Test | Command | Expected |
|---|------|---------|----------|
| 5.1 | profile get | `bonsai profile get --base-url ...` | Returns operator profile |
| 5.2 | profile update | `bonsai profile update --base-url ... --data '{"name":"Patryk"}'` | Updates profile |

## 6. CRUD with Path Params

| # | Test | Command | Expected |
|---|------|---------|----------|
| 6.1 | Get by ID | `bonsai agents get --base-url ... --project <id> <agentId>` | Returns agent |
| 6.2 | Update by ID | `bonsai agents update --base-url ... --project <id> <agentId> --data '{"name":"test"}'` | Updates agent |
| 6.3 | Delete by ID | `bonsai api_keys delete --base-url ... --project <id> <keyId> --data '{"version":1}'` | Deletes key |
| 6.4 | Audit by ID | `bonsai agents audit --base-url ... --project <id> <agentId>` | Returns audit logs |
| 6.5 | Clone by ID | `bonsai agents clone --base-url ... --project <id> <agentId> --data '{"name":"clone"}'` | Creates clone |
| 6.6 | Missing path param | `bonsai agents get --base-url ... --project <id>` | `MISSING_ARG`, exit 2 |

## 7. Create Operations (with body)

| # | Test | Command | Expected |
|---|------|---------|----------|
| 7.1 | Create via --data | `bonsai api_keys create --base-url ... --project <id> --data '{"name":"test","expiresIn":3600,"metadata":{}}'` | Returns created key |
| 7.2 | Create via --data-file | `bonsai api_keys create --base-url ... --project <id> --data-file ./test.json` | Returns created key |
| 7.3 | Create via stdin | `echo '{"name":"test","expiresIn":3600,"metadata":{}}' | bonsai api_keys create --base-url ... --project <id> --data -` | Returns created key |
| 7.4 | Invalid JSON | `bonsai api_keys create --base-url ... --project <id> --data '{bad}'` | Error |
| 7.5 | Validation error | `bonsai api_keys create --base-url ... --project <id> --data '{"name":"test","expiresIn":3600}'` | `VALIDATION_ERROR` (missing metadata) |

## 8. Query Parameters

| # | Test | Command | Expected |
|---|------|---------|----------|
| 8.1 | offset/limit | `bonsai agents list --base-url ... --project <id> --offset 0 --limit 1` | Returns 1 agent |
| 8.2 | textSearch | `bonsai agents list --base-url ... --project <id> --textSearch "test"` | Filters results |
| 8.3 | orderBy | `bonsai agents list --base-url ... --project <id> --orderBy "name"` | Ordered results |

## 9. Output Formats

| # | Test | Command | Expected |
|---|------|---------|----------|
| 9.1 | JSON output | `bonsai projects list --base-url ... --json` | Valid JSON envelope |
| 9.2 | Verbose output | `bonsai projects list --base-url ... --verbose` | Stderr has timing info |
| 9.3 | JSON schema | `bonsai agents list --base-url ... --json-schema` | Outputs JSON schema |
| 9.4 | Non-JSON output | `bonsai projects list --base-url ...` | Human-readable table |

## 10. Pagination

| # | Test | Command | Expected |
|---|------|---------|----------|
| 10.1 | Paginate flag | `bonsai projects list --base-url ... --paginate` | Fetches all pages |
| 10.2 | Manual offset | `bonsai agents list --base-url ... --project <id> --offset 0 --limit 1` | Returns 1 item |

## 11. Analytics Commands

| # | Test | Command | Expected |
|---|------|---------|----------|
| 11.1 | analytics_usage list | `bonsai analytics_usage list --base-url ... --project <id>` | Returns usage stats |
| 11.2 | analytics_latency list | `bonsai analytics_latency list --base-url ... --project <id>` | Returns latency stats |
| 11.3 | analytics_conversations timeline | `bonsai analytics_conversations timeline --base-url ... --project <id> <param>` | Returns timeline |
| 11.4 | analytics_saved_queries CRUD | `bonsai analytics_saved_queries list/create/update/delete --base-url ... --project <id>` | Full CRUD |

## 12. Special Operations

| # | Test | Command | Expected |
|---|------|---------|----------|
| 12.1 | Project archive | `bonsai projects archive --base-url ... <projectId>` | Archives project |
| 12.2 | Project unarchive | `bonsai projects unarchive --base-url ... <projectId>` | Unarchives project |
| 12.3 | Project export | `bonsai projects export --base-url ... <projectId>` | Returns export bundle |
| 12.4 | Migration preview | `bonsai migration preview --base-url ...` | Returns migration info |
| 12.5 | Setup status | `bonsai setup status --base-url ...` | Returns setup status |

## 13. Error Handling

| # | Test | Command | Expected |
|---|------|---------|----------|
| 13.1 | 401 | `bonsai projects list --base-url ... --token invalid` | `UNAUTHORIZED`, exit 3 |
| 13.2 | 403 | (use token without permission) | `FORBIDDEN`, exit 4 |
| 13.3 | 404 | `bonsai agents get --base-url ... --project <id> nonexistent_id` | `NOT_FOUND`, exit 5 |
| 13.4 | 409 | `bonsai projects archive --base-url ... <already-archived-id>` | `CONFLICT`, exit 6 |
| 13.5 | 400 | `bonsai api_keys create --base-url ... --project <id> --data '{bad}'` | `VALIDATION_ERROR`, exit 1 |
| 13.6 | Network error | `bonsai projects list --base-url http://localhost:9999` | `NETWORK_ERROR`, exit 8 |
| 13.7 | Missing arg | `bonsai agents get --base-url ... --project <id>` | `MISSING_ARG`, exit 2 |
| 13.8 | Missing project | `bonsai agents list --base-url ...` | `MISSING_PROJECT`, exit 2 |
| 13.9 | Config error | (no config, no --base-url) | `CONFIG_ERROR`, exit 2 |

## 14. Exit Codes

| Exit Code | Meaning | Verified By |
|-----------|---------|-------------|
| 0 | Success | Test 3.1 |
| 1 | Validation error | Test 13.5 |
| 2 | Missing arg / config error | Test 13.7, 13.8, 13.9 |
| 3 | Unauthorized | Test 13.1 |
| 4 | Forbidden | Test 13.2 |
| 5 | Not found | Test 13.3 |
| 6 | Conflict | Test 13.4 |
| 8 | Network error | Test 13.6 |

## 15. Edge Cases

| # | Test | Command | Expected |
|---|------|---------|----------|
| 15.1 | Empty result | `bonsai benchmarks_suites list --base-url ...` | Empty items, total 0 |
| 15.2 | Large response | `bonsai projects list --base-url ...` | Handles large JSON |
| 15.3 | Special chars in data | `bonsai api_keys create --base-url ... --project <id> --data '{"name":"test with spaces & symbols"}'` | Works |
| 15.4 | Multiple path params | (e.g. `benchmarks_executions results_get <suiteId> <runId>`) | Both params resolved |
| 15.5 | Concurrent requests | (run two commands simultaneously) | No interference |

---

## Quick Smoke Test Script

```bash
#!/bin/bash
set -e
BASE="http://localhost:3000"
PROJ="proj_019de91f-ec0c-74ad-86b2-67a4ab338dc0"
CLI="node bin/bonsai"

echo "=== Global list ==="
$CLI projects list --base-url $BASE --json | head -1
$CLI operators list --base-url $BASE --json | head -1
$CLI providers list --base-url $BASE --json | head -1

echo "=== Project list ==="
$CLI agents list --base-url $BASE --project $PROJ --json | head -1
$CLI stages list --base-url $BASE --project $PROJ --json | head -1
$CLI users list --base-url $BASE --project $PROJ --json | head -1

echo "=== Profile ==="
$CLI profile get --base-url $BASE --json | head -1

echo "=== CRUD ==="
KEY_ID=$($CLI api_keys create --base-url $BASE --project $PROJ --data '{"name":"smoke-test","expiresIn":3600,"metadata":{}}' --json | grep '"id"' | head -1 | cut -d'"' -f4)
$CLI api_keys get --base-url $BASE --project $PROJ $KEY_ID --json | head -1
$CLI api_keys delete --base-url $BASE --project $PROJ $KEY_ID --data '{"version":1}' --json

echo "=== Errors ==="
$CLI projects list --base-url $BASE --token invalid 2>&1 && true
$CLI agents list --base-url $BASE 2>&1 && true
$CLI projects list --base-url http://localhost:9999 2>&1 && true

echo "=== All smoke tests passed ==="
```
