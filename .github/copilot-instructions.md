## Important Notes
- Try to make changes in batches, not one-by-one (especially easy ones)
- When changing contracts, use files in /src/http/contracts
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
- Place private methods AFTER the public ones

## Controller Architecture
We are migrating away from routing-controllers to plain Express with explicit route registration. Follow these patterns:

### New Pattern (Plain Express)
Used by: AdminController, ProjectController, AuditController, ClassifierController, ContextTransformerController, ConversationController

**Controller structure:**
```typescript
import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

@singleton()
export class ExampleController {
  constructor(@inject(ExampleService) private readonly service: ExampleService) {}

  // Static method for OpenAPI documentation
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/examples',
        tags: ['Examples'],
        summary: 'Create example',
        description: '...',
        request: { body: { content: { 'application/json': { schema: createSchema } } } },
        responses: { 201: { description: '...', content: { 'application/json': { schema: responseSchema } } } },
      },
      // ... more routes
    ];
  }

  // Explicit route registration
  registerRoutes(router: Router): void {
    router.post('/api/examples', asyncHandler(this.createExample.bind(this)));
    router.get('/api/examples/:id', asyncHandler(this.getExample.bind(this)));
  }

  // Private handler methods
  private async createExample(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.EXAMPLE_WRITE]);
    const body = createSchema.parse(req.body);
    const result = await this.service.create(body, req.context);
    res.status(201).json(result);
  }

  private async getExample(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.EXAMPLE_READ]);
    const params = routeParamsSchema.parse(req.params);
    const result = await this.service.getById(params.id);
    res.status(200).json(result);
  }
}
```

**Key points for new pattern:**
- Use `@singleton()` decorator (not `@injectable()`)
- No routing-controllers decorators (`@JsonController`, `@Get`, `@Post`, etc.)
- Manual validation using `schema.parse()` in each handler
- Manual authorization using `checkPermissions(req, [PERMISSIONS.XXX])` at start of each handler
- Wrap all handlers with `asyncHandler()` to catch errors
- Private handler methods with Express signatures: `(req: Request, res: Response) => Promise<void>`
- Explicit status codes: `res.status(201).json(...)`, `res.status(204).send()`
- Static `getOpenAPIPaths()` returns OpenAPI RouteConfig array
- `registerRoutes(router: Router)` method for registering routes
- Register controller in server.ts: `container.resolve(ExampleController).registerRoutes(app)`
- Register OpenAPI paths in swagger.ts: `ExampleController.getOpenAPIPaths()`

### Old Pattern (routing-controllers)
Used by: AuthController, UserController, PersonaController, KnowledgeController, IssueController, StageController, ToolController, GlobalActionController, EnvironmentController, ProviderController, SetupController

*(Will be migrated gradually - do not use for new controllers)*

## Security and Authorization
- **Defense in depth**: Security checks must be enforced at BOTH controller and service layers
- **Controller layer** (first line of defense):
  - **New pattern (plain Express)**: Call `checkPermissions(req, [PERMISSIONS.XXX])` at the start of each handler method
  - **Old pattern (routing-controllers)**: Use `@RequirePermissions([PERMISSIONS.XXX])` decorator before `@OpenAPI()` decorator
  - Use appropriate permissions: READ for GET, WRITE for POST/PUT, DELETE for DELETE
  - Import `PERMISSIONS` from `/src/permissions`
- **Service layer** (critical security boundary):
  - All write operations (create, update, delete) MUST call `this.requirePermission(context, PERMISSIONS.XXX)` at the start
  - `context` parameter MUST be required (not optional) for all write operations: `context: RequestContext` not `context?: RequestContext`
  - Read operations can have optional context but should check if provided
  - This ensures security even when services are called internally (from other services, background jobs, etc.)
- **Example patterns**:
  ```typescript
  // New pattern (plain Express)
  private async createAdmin(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ADMIN_WRITE]);
    const body = createAdminSchema.parse(req.body);
    const result = await this.adminService.createAdmin(body, req.context);
    res.status(201).json(result);
  }
  
  // Old pattern (routing-controllers)
  @RequirePermissions([PERMISSIONS.ADMIN_WRITE])
  @OpenAPI({ ... })
  @Post('/')
  async createAdmin(@Body() body: CreateAdminRequest, @Req() req: Request) {
    return await this.adminService.createAdmin(body, req.context);
  }
  
  // Service (same for both patterns)
  async createAdmin(input: CreateAdminRequest, context: RequestContext): Promise<AdminResponse> {
    this.requirePermission(context, PERMISSIONS.ADMIN_WRITE);
    // ... rest of implementation
  }
  ```

## API Contracts and Validation
- Use Zod schemas as the source of truth for API contracts
- All API contracts are defined in /src/http/contracts using Zod schemas
- When creating schemas in /src/http/contracts:
  - Add comprehensive JSDoc comments to schemas
  - **Add `.describe()` to every schema field to provide descriptions visible in Swagger UI**
  - Include information about query string parameters that are missing in the schema
  - Export schemas as constants (e.g., `export const createAdminSchema = z.object({...})`)
  - Export corresponding TypeScript types (e.g., `export type CreateAdminRequest = z.infer<typeof createAdminSchema>`)
  - Export route params schemas (e.g., `export const adminRouteParamsSchema = z.object({ id: z.string() })`)
  - Extend Zod with OpenAPI using `extendZodWithOpenApi(z)` at the top of each contract file
- **New pattern (plain Express)**: Call `schema.parse()` manually in each handler method:
  - For body: `const body = createSchema.parse(req.body)`
  - For query: `const query = listParamsSchema.parse(req.query)`
  - For params: `const params = routeParamsSchema.parse(req.params)`
- **Old pattern (routing-controllers)**: Use `@Validated(schema)` decorator on parameters:
  - For body: `@Validated(createAdminSchema) @Body() body: CreateAdminRequest`
  - For query: `@Validated(listParamsSchema, 'query') @Req() req: Request` then access `req.query as unknown as ListParams`
  - For params: `@Validated(routeParamsSchema, 'params') @Params() params: RouteParams`
- Import both the schema and type from contract files in controllersfinitions using /src/swagger.ts
- **ALWAYS add tags to group endpoints by controller** (e.g., `tags: ['Admins']`, `tags: ['Users']`) - this organizes endpoints in Swagger UI
- Swagger UI is available at /api-docs endpoint

### New Pattern (plain Express)
- Define a static `getOpenAPIPaths()` method in the controller that returns `RouteConfig[]`
- Include tags, summary, description, request (body/query/params), and responses for each route
- Register the routes in swagger.ts by calling the static method:
  ```typescript
  const examplePaths = ExampleController.getOpenAPIPaths();
  for (const path of examplePaths) {
    registry.registerPath(path);
  }
  ```
- Example:
  ```typescript
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/admins',
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
      },
    ];
  }
  ```

### Old Pattern (routing-controllers)
- Use `@OpenAPI()` decorator on controller methods
- Place decorator immediately before route decorators (`@Post`, `@Get`, etc.)
- The system automatically extracts this metadata from decoratorsst('/')
  @HttpCode(201)
  async createAdmin(@Body() body: CreateAdminRequest) { ... }
  ```
