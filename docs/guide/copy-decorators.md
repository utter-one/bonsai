# Copy Decorators

**Copy Decorators** are template strings that wrap or modify selected sample copy content at runtime. They belong to a project and are referenced by [Sample Copies](./sample-copies) via `decoratorId`.

## How They Work

1. Create a decorator with a `name` and `template` string
2. Set `decoratorId` on a sample copy to reference the decorator
3. At runtime, when sample copy content is selected, the decorator's template wraps the content

The decorator template receives the selected content via <code v-pre>{{copy}}</code>. The decorated output is then available as <code v-pre>{{copy}}</code> in the stage prompt, while <code v-pre>{{copyContent}}</code> remains the raw, undecorated content.

## Template

The `template` field is a Handlebars template that receives the selected sample copy content. Use <code v-pre>{{copy}}</code> within the template to reference the content:

```handlebars
The following response has been pre-approved:

---
{{copy}}
---

Please deliver this to the user verbatim.
```

Or for formatting:

```handlebars
**Answer:** {{copy}}
```

## Structure

| Field | Description |
|---|---|
| `id` | Unique identifier |
| `projectId` | Parent project |
| `name` | Display name (unique per project) |
| `template` | Handlebars template applied to sample copy content |
| `version` | Optimistic locking version |

## Common Operations

- Create: `POST /api/projects/:projectId/copy-decorators`
- List: `GET /api/projects/:projectId/copy-decorators`
- Get: `GET /api/projects/:projectId/copy-decorators/:id`
- Update: `PUT /api/projects/:projectId/copy-decorators/:id`
- Delete: `DELETE /api/projects/:projectId/copy-decorators/:id`
- Audit Logs: `GET /api/projects/:projectId/copy-decorators/:id/audit-logs`

All endpoints require `copy_decorator:read` or `copy_decorator:write` permission.

## Migration

Copy decorators are included in migration bundles. They are imported before sample copies (dependency order: projects -> copyDecorators -> sampleCopies). If a sample copy references a decorator not yet in the bundle, the migration service back-fills the parent decorator record.

## References

- [Copy Decorators API](../api/copy-decorators) — Full REST API reference
- [Sample Copies](./sample-copies) — Pre-written variant answers with classifier-driven selection
- [Templating](./templating) — Handlebars template reference
