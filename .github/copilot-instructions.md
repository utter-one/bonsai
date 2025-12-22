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
- Use IoC container for classes with implicit registration by @singleton or @injectable decorator
- Always verify changes by running `npm run build`

## Security and Authorization
- **Defense in depth**: Security checks must be enforced at BOTH controller and service layers
- **Controller layer** (first line of defense):
  - Always use `@RequirePermissions([PERMISSIONS.XXX])` decorator on controller endpoints
  - Place decorator before `@OpenAPI()` decorator
  - Use appropriate permissions: READ for GET, WRITE for POST/PUT, DELETE for DELETE
  - Import `PERMISSIONS` from `/src/config/permissions`
- **Service layer** (critical security boundary):
  - All write operations (create, update, delete) MUST call `this.requirePermission(context, PERMISSIONS.XXX)` at the start
  - `context` parameter MUST be required (not optional) for all write operations: `context: RequestContext` not `context?: RequestContext`
  - Read operations can have optional context but should check if provided
  - This ensures security even when services are called internally (from other services, background jobs, etc.)
- **Example pattern**:
  ```typescript
  // Controller
  @RequirePermissions([PERMISSIONS.ADMIN_WRITE])
  @OpenAPI({ ... })
  @Post('/')
  async createAdmin(@Body() body: CreateAdminRequest, @Req() req: Request) {
    return await this.adminService.createAdmin(body, req.context);
  }
  
  // Service
  async createAdmin(input: CreateAdminRequest, context: RequestContext): Promise<AdminResponse> {
    this.requirePermission(context, PERMISSIONS.ADMIN_WRITE);
    // ... rest of implementation
  }
  ```

## API Contracts and Validation
- Use Zod schemas as the source of truth for API contracts
- All API contracts are defined in /src/api using Zod schemas
- When creating schemas in /src/api:
  - Add comprehensive JSDoc comments to schemas
  - **Add `.describe()` to every schema field to provide descriptions visible in Swagger UI**
  - Include information about query string parameters that are missing in the schema
  - Export schemas as constants (e.g., `export const createAdminSchema = z.object({...})`)
  - Export corresponding TypeScript types (e.g., `export type CreateAdminRequest = z.infer<typeof createAdminSchema>`)
  - Extend Zod with OpenAPI using `extendZodWithOpenApi(z)` at the top of each API file
- In controllers, use `@Validated(schema)` decorator on parameters that need validation:
  - For body: `@Validated(createAdminSchema) @Body() body: CreateAdminRequest`
  - For query: `@Validated(listParamsSchema, 'query') @QueryParams() query: ListParams`
  - For params: `@Validated(routeParamsSchema, 'params') @Params() params: RouteParams`
- Never call `.parse()` manually in controllers - validation happens automatically via middleware
- Import both the schema and type from API contract files in controllers

## OpenAPI/Swagger Documentation
- OpenAPI documentation is generated from Zod schemas and controller decorators using swagger.ts
- **Use `@OpenAPI()` decorator on controller methods to define endpoint documentation**
  - Place decorator immediately before route decorators (`@Post`, `@Get`, etc.)
  - Include tags, summary, description, request, and responses
  - The system automatically extracts this metadata and generates OpenAPI spec
- **ALWAYS add tags to group endpoints by controller** (e.g., `tags: ['Admins']`, `tags: ['Users']`) - this organizes endpoints in Swagger UI
- Swagger UI is available at /api-docs endpoint
- Example:
  ```typescript
  @OpenAPI({
    tags: ['Admins'],
    summary: 'Create a new admin user',
    description: 'Creates a new admin user with the specified credentials and roles',
    request: {
      body: {
        content: {
          'application/json': {
            schema: createAdminSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Admin user created successfully',
        content: {
          'application/json': {
            schema: adminResponseSchema,
          },
        },
      },
      400: { description: 'Invalid request body' },
      409: { description: 'Admin user already exists' },
    },
  })
  @Post('/')
  @HttpCode(201)
  async createAdmin(@Body() body: CreateAdminRequest) { ... }
  ```
