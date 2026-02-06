## Important Notes
- Try to make changes in batches, not one-by-one (especially easy ones)
- When changing HTTP contracts, use files in /src/http/contracts
- When changing WebSocket contracts in /src/websocket/contracts, update src/scripts/generateWebSocketSchemas.ts (integrate into one schema) and run `npm run schemas:generate` to update the JSON Schema
- Don't create example usages of newly created components
- When creating database entities, don't forget to add models
- Make all logger calls one-liners (even if very long) and do not use event field
- Do not use complex inline types. Instead create dedicated types.
- Never use require() to import type. Always use import at the beginning of files.
- Prefer types over interfaces
- Add new types of exceptions (extends Error) to /src/errors.ts
- Always create and update JSDoc comments for functions, methods and classes if necessary
- Use IoC container for classes with implicit registration by @singleton or @injectable decorator
- Always verify changes by running `npm run build` (this also regenerates WebSocket JSON Schema)
- Place private methods AFTER the public ones
- When modifying database entities (e.g. add, rename, remove fields), apply these changes to the corresponding contracts and services

## Controller Architecture

All controllers use plain Express with explicit route registration. Follow this pattern:

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

**Key points:**
- Use `@singleton()` decorator (not `@injectable()`)
- Manual validation using `schema.parse()` in each handler
- Manual authorization using `checkPermissions(req, [PERMISSIONS.XXX])` at start of each handler
- Wrap all handlers with `asyncHandler()` to catch errors
- Private handler methods with Express signatures: `(req: Request, res: Response) => Promise<void>`
- Explicit status codes: `res.status(201).json(...)`, `res.status(204).send()`
- Static `getOpenAPIPaths()` returns OpenAPI RouteConfig array
- `registerRoutes(router: Router)` method for registering routes
- Register controller in server.ts: `container.resolve(ExampleController).registerRoutes(app)`
- Register OpenAPI paths in swagger.ts: `ExampleController.getOpenAPIPaths()`

## Security and Authorization
- **Defense in depth**: Security checks must be enforced at BOTH controller and service layers
- **Controller layer** (first line of defense):
  - Call `checkPermissions(req, [PERMISSIONS.XXX])` at the start of each handler method
  - Use appropriate permissions: READ for GET, WRITE for POST/PUT, DELETE for DELETE
  - Import `PERMISSIONS` from `/src/permissions`
- **Service layer** (critical security boundary):
  - All write operations (create, update, delete) MUST call `this.requirePermission(context, PERMISSIONS.XXX)` at the start
  - `context` parameter MUST be required (not optional) for all write operations: `context: RequestContext` not `context?: RequestContext`
  - Read operations can have optional context but should check if provided
  - This ensures security even when services are called internally (from other services, background jobs, etc.)
- **Example pattern**:
  ```typescript
  // Controller
  private async createAdmin(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ADMIN_WRITE]);
    const body = createAdminSchema.parse(req.body);
    const result = await this.adminService.createAdmin(body, req.context);
    res.status(201).json(result);
  }
  
  // Service
  async createAdmin(input: CreateAdminRequest, context: RequestContext): Promise<AdminResponse> {
    this.requirePermission(context, PERMISSIONS.ADMIN_WRITE);
    // ... rest of implementation
  }
  ```

## API Contracts and Validation
- Use Zod schemas as the source of truth for API contracts
- Don't put logic in the Zod schemas, handle it at the service level
- All API contracts are defined in /src/http/contracts using Zod schemas
- When creating schemas in /src/http/contracts:
  - Add comprehensive JSDoc comments to schemas
  - **Add `.describe()` to every schema field to provide descriptions visible in Swagger UI**
  - Include information about query string parameters that are missing in the schema
  - Export schemas as constants (e.g., `export const createAdminSchema = z.object({...})`)
  - Export corresponding TypeScript types (e.g., `export type CreateAdminRequest = z.infer<typeof createAdminSchema>`)
  - Export route params schemas (e.g., `export const adminRouteParamsSchema = z.object({ id: z.string() })`)
  - Extend Zod with OpenAPI using `extendZodWithOpenApi(z)` at the top of each contract file
  - **For reusable sub-schemas, add `.openapi('ComponentName')` to make them reusable $ref components**
    - Example: `export const voiceConfigSchema = z.object({...}).openapi('VoiceConfig').optional()`
    - This prevents schema inlining and creates clean, reusable components in OpenAPI spec
    - Apply `.openapi()` BEFORE modifiers like `.optional()`, `.nullable()`, `.array()`, etc.
- Call `schema.parse()` manually in each handler method:
  - For body: `const body = createSchema.parse(req.body)`
  - For query: `const query = listParamsSchema.parse(req.query)`
  - For params: `const params = routeParamsSchema.parse(req.params)`
- Import both the schema and type from contract files in controllers
- Define OpenAPI documentation in `static getOpenAPIPaths()` method
- **ALWAYS add tags to group endpoints by controller** (e.g., `tags: ['Admins']`, `tags: ['Users']`) - this organizes endpoints in Swagger UI
- Swagger UI is available at /api-docs endpoint
- **Register and mark reusable sub-schemas for OpenAPI:**
  - Add `.openapi('ComponentName')` to sub-schema definitions to create reusable components
  - Register these schemas in swagger.ts BEFORE main schemas to ensure proper $ref resolution
  - Sub-schemas include: `VoiceConfig`, `AsrConfig`, `Effect`, `StageAction`, `StageActionParameter`, LLM settings, etc.
  - Place sub-schema registrations at the top of the registry in `getOpenAPISpec()` function
  - This prevents inlining and makes the OpenAPI spec cleaner and more maintainable
  - Example registration: `registry.register('VoiceConfig', voiceConfigSchema);`

## OpenAPI Documentation
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


## WebSocket Contracts

All WebSocket message contracts are defined in `/src/websocket/contracts/` using Zod schemas.

**Key principles:**
- Define all message types using Zod schemas with `.describe()` for field descriptions
- WebSocket contracts are automatically exported to JSON Schema at `/schemas/websocket-contracts.json`
- The schema is served via unauthenticated endpoint: `GET /websocket-contracts.json`
- When modifying WebSocket contracts, always run `npm run schemas:generate` to update the JSON Schema
- The build process (`npm run build`) automatically regenerates the schema
- Ensure descriptions are comprehensive as they appear in the generated JSON Schema

**Contract file structure:**
- `common.ts` - Base message schemas (input/output, session-based)
- `auth.ts` - Authentication messages
- `session.ts` - Session lifecycle messages (start/resume/end conversation)
- `userInput.ts` - User voice and text input messages
- `command.ts` - Client commands (go to stage, variables, actions)
- `aiResponse.ts` - AI voice output messages

