## Important Notes
- Try to make changes in batches, not one-by-one (especially easy ones)
- When changing contracts, use files in /src/api
- Don't create example usages of newly created components
- When creating database entities, don't forget to add models
- Make all logger calls one-liners (even if very long) and do not use event field
- Do not use complex inline types. Instead create dedicated types.
- Never use require() to import type. Always use import at the beginning of files.
- Prefer types over interfaces
- Add new types of exceptions (extends Error) to /src/errors.ts
- Always create and update JSDoc comments for functions, methods and classes if necessary

## API Contracts and Validation
- Use Zod schemas as the source of truth for API contracts
- All API contracts are defined in /src/api using Zod schemas
- When creating schemas in /src/api:
  - Add comprehensive JSDoc comments to schemas
  - Include information about query string parameters that are missing in the schema
  - Export schemas as constants (e.g., `export const createAdminSchema = z.object({...})`)
  - Export corresponding TypeScript types (e.g., `export type CreateAdminRequest = z.infer<typeof createAdminSchema>`)
- In controllers, use `@Validated(schema)` decorator on parameters that need validation:
  - For body: `@Validated(createAdminSchema) @Body() body: CreateAdminRequest`
  - For query: `@Validated(listParamsSchema, 'query') @QueryParams() query: ListParams`
  - For params: `@Validated(routeParamsSchema, 'params') @Params() params: RouteParams`
- Never call `.parse()` manually in controllers - validation happens automatically via middleware
- Import both the schema and type from API contract files in controllers
