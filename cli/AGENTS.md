**Bonsai CLI Usage**

Run: `npx tsx cli/src/index.ts <resource> <action> [options]`

**Auth** (tokens saved to `~/.bonsairc`):
```
npx tsx cli/src/index.ts auth login -u <user> -p <pass>
npx tsx cli/src/index.ts auth status
npx tsx cli/src/index.ts auth logout
```

**CRUD patterns** (project-scoped resources require `--project <id>`):
```
npx tsx cli/src/index.ts documents list --project <id> --json
npx tsx cli/src/index.ts documents get <id> --project <id>
npx tsx cli/src/index.ts documents create --project <id> --data '{"title":"...","content":"..."}'
npx tsx cli/src/index.ts documents update <id> --project <id> --data '{"title":"...","version":2}'
npx tsx cli/src/index.ts documents delete <id> --project <id> --data '{"version":2}'
```

**Key options:**
- `--json` — JSON output
- `--project <id>` — project scope
- `--data <json>` — request body
- `--version <n>` — optimistic locking (required for update/delete)
- `--paginate` — fetch all pages
- `-v` — verbose (method, status, duration)
- `--base-url <url>` — override API URL (default: `http://localhost:3000`)

**Discovery:**
```
npx tsx cli/src/index.ts resources          # list all resources
npx tsx cli/src/index.ts documents --help   # available actions per resource
```

**Important:** Update and delete require `--data '{"version":N}'` for optimistic locking. Get the version from `list` or `get` responses.