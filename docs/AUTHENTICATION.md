# JWT Authentication & RBAC Implementation

## Overview

This document describes the comprehensive JWT-based authentication and Role-Based Access Control (RBAC) system implemented in Nexus Backend. The system provides secure user authentication via JWT tokens, granular permission-based access control, and complete audit trail capabilities.

## 🔐 Core Components

### 1. Request Context System (`src/types/request-context.ts`)

The `RequestContext` type flows through all service methods for auditing and authorization:

```typescript
type RequestContext = {
  adminId: string;       // Authenticated admin user ID
  roles: string[];       // Roles assigned to the admin
  ip: string;           // Client IP address
  userAgent: string;    // User agent string
  requestId: string;    // Unique request identifier
  timestamp: Date;      // Request timestamp
};
```

### 2. Permission Configuration (`src/config/permissions.ts`)

#### Predefined Roles

- **super_admin**: Full system access with all permissions
- **content_manager**: Manage content entities (personas, conversations, users)
- **support**: View and assist with user-related issues
- **developer**: Technical access for development and debugging
- **viewer**: Read-only access to most entities

#### Permission Format

Permissions follow the `entity:action` format:

```typescript
PERMISSIONS = {
  ADMIN_READ: 'admin:read',
  ADMIN_WRITE: 'admin:write',
  ADMIN_DELETE: 'admin:delete',
  USER_READ: 'user:read',
  USER_WRITE: 'user:write',
  // ... etc
}
```

#### Helper Functions

- `getPermissionsForRoles(roles: string[]): Permission[]` - Get all permissions for roles
- `hasPermission(roles: string[], permission: Permission): boolean` - Check single permission
- `hasAllPermissions(roles: string[], permissions: Permission[]): boolean` - Check multiple permissions

### 3. BaseService Class (`src/services/BaseService.ts`)

All service classes extend `BaseService` to inherit permission checking capabilities:

```typescript
abstract class BaseService {
  // Check if context has a specific permission
  protected hasPermission(context: RequestContext | undefined, permission: Permission): boolean

  // Require specific permissions (throws ForbiddenError if missing)
  protected requirePermission(context: RequestContext | undefined, ...permissions: Permission[]): void

  // Log operation with context information
  protected logOperation(context: RequestContext | undefined, operation: string, details?: Record<string, any>): void
}
```

### 4. Middleware Stack

#### AuthMiddleware (`src/middleware/auth.ts`)

Validates JWT tokens and attaches user information to the request:

- Extracts token from `Authorization: Bearer <token>` header
- Verifies token signature and expiration
- Attaches `req.user` with adminId and roles
- Throws `UnauthorizedError` if token is invalid

#### RequestContextMiddleware (`src/middleware/requestContext.ts`)

Creates the `RequestContext` from authenticated user:

- Runs after authentication middleware
- Creates `req.context` with user info, IP, user agent, etc.
- Only creates context if `req.user` exists

### 5. Permission Utilities (`src/utils/permissions.ts`)

#### checkPermissions(req: Request, permissions: Permission[])

Checks if the authenticated user has all required permissions:

```typescript
import { checkPermissions } from '../../utils/permissions';

async createAdmin(req: Request, res: Response): Promise<void> {
  checkPermissions(req, [PERMISSIONS.ADMIN_WRITE]);
  // ... rest of handler
}
```

Throws `UnauthorizedError` if not authenticated, or `ForbiddenError` if lacking permissions.

## 🔑 Authentication Service (`src/services/AuthService.ts`)

### Password Hashing

- Uses bcrypt with 10 salt rounds
- Passwords are hashed before storing in database
- `hashPassword(password: string): Promise<string>`
- `verifyPassword(password: string, hash: string): Promise<boolean>`

### JWT Token Management

#### Access Tokens
- Expiry: 15 minutes
- Type: `access`
- Used for API authentication

#### Refresh Tokens
- Expiry: 7 days
- Type: `refresh`
- Used to obtain new access tokens

### Methods

#### login(id: string, password: string)

Authenticates an admin user:

```typescript
POST /api/auth/login
{
  "id": "admin@example.com",
  "password": "securePassword123"
}

Response:
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "expiresIn": 900,
  "adminId": "admin@example.com",
  "displayName": "Admin User",
  "roles": ["super_admin"]
}
```

#### refresh(refreshToken: string)

Refreshes an access token:

```typescript
POST /api/auth/refresh
{
  "refreshToken": "eyJhbGc..."
}

Response:
{
  "accessToken": "eyJhbGc...",
  "expiresIn": 900
}
```

## 📝 API Documentation

### Authentication Endpoints

All endpoints documented in Swagger UI at `/api-docs`

#### POST /api/auth/login
- **Public**: Yes
- **Description**: Authenticate with email/ID and password
- **Returns**: Access token, refresh token, and user info

#### POST /api/auth/refresh
- **Public**: Yes
- **Description**: Get new access token using refresh token
- **Returns**: New access token

### Protected Endpoints

All other endpoints require authentication via Bearer token:

```bash
Authorization: Bearer <access_token>
```

### Permission Requirements

- **Admin Endpoints** (`/api/admins/*`)
  - List/Get: `admin:read`
  - Create/Update: `admin:write`
  - Delete: `admin:delete`
  - Audit Logs: `audit:read`

- **User Endpoints** (`/api/users/*`)
  - List/Get: `user:read`
  - Create/Update: `user:write`
  - Delete: `user:delete`
  - Audit Logs: `audit:read`

- **Persona Endpoints** (`/api/personas/*`)
  - List/Get: `persona:read`
  - Create/Update: `persona:write`
  - Delete: `persona:delete`
  - Audit Logs: `audit:read`

- **Knowledge Endpoints** (`/api/knowledge/*`)
  - List/Get (sections, categories, items): `knowledge:read`
  - Create/Update (sections, categories, items): `knowledge:write`
  - Delete (sections, categories, items): `knowledge:delete`

## 🔧 Configuration

### Environment Variables

Add to `.env` file:

```bash
# JWT Configuration (REQUIRED)
JWT_SECRET=your-secret-key-here-change-in-production-min-32-chars
```

⚠️ **Important**: Use a strong, unique secret in production (minimum 32 characters)

### Swagger UI

JWT Bearer authentication is configured in Swagger UI:

1. Click "Authorize" button in Swagger UI
2. Enter: `Bearer <your_access_token>`
3. Click "Authorize"
4. All subsequent requests will include the token

## 📊 Updated Components

### Services

- **AdminService**: Extends BaseService, uses RequestContext, hashes passwords
- **UserService**: Extends BaseService, uses RequestContext
- **PersonaService**: Extends BaseService, uses RequestContext
- **AuthService**: New service for authentication and JWT management

### Controllers

- **AdminController**: Uses checkPermissions in handlers
- **UserController**: Uses checkPermissions in handlers
- **PersonaController**: Uses checkPermissions in handlers
- **AuthController**: Public routes (no authentication required)

### Error Handling

Added new error types:

- `UnauthorizedError` (401): Authentication required or token invalid
- `ForbiddenError` (403): User lacks required permissions

## 🚀 Usage Examples

### Creating an Admin User (requires super_admin role)

```bash
# First, get an access token
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "id": "admin@example.com",
    "password": "password123"
  }'

# Use the access token to create a new admin
curl -X POST http://localhost:3000/api/admins \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{
    "id": "newadmin@example.com",
    "displayName": "New Admin",
    "roles": ["content_manager"],
    "password": "securePassword123"
  }'
```

### Refreshing Token

```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "<refresh_token>"
  }'
```

### Using Request Context in Services

```typescript
// In a service method
async createUser(input: CreateUserRequest, context?: RequestContext): Promise<UserResponse> {
  // Check permissions
  this.requirePermission(context, PERMISSIONS.USER_WRITE);
  
  // Log operation
  this.logOperation(context, 'createUser', { userId: input.id });
  
  // Create user...
  // Audit log will use context.adminId
}
```

## 🔒 Security Best Practices

1. **Environment Variables**: Never commit `.env` files with real secrets
2. **JWT Secret**: Use strong, random secrets (32+ characters)
3. **Token Storage**: Store refresh tokens securely (httpOnly cookies in production)
4. **Password Policy**: Enforce strong passwords in your application
5. **HTTPS**: Always use HTTPS in production
6. **Token Expiry**: Keep access tokens short-lived (15 minutes)
7. **Refresh Rotation**: Consider rotating refresh tokens on use

## 📚 Adding New Permissions

1. Add permission to `PERMISSIONS` in `src/permissions.ts`:
   ```typescript
   NEW_ENTITY_READ: 'newentity:read',
   NEW_ENTITY_WRITE: 'newentity:write',
   NEW_ENTITY_DELETE: 'newentity:delete',
   ```

2. Add to relevant roles in `ROLES` configuration

3. Use `checkPermissions` in controller handlers:
   ```typescript
   private async createEntity(req: Request, res: Response): Promise<void> {
     checkPermissions(req, [PERMISSIONS.NEW_ENTITY_WRITE]);
     // ... handler implementation
   }
   ```

4. Update Swagger documentation with permission info

## � Permission Matrix

| Endpoint | Required Permission | Roles with Access |
|----------|-------------------|-------------------|
| GET /api/admins | `admin:read` | super_admin |
| POST /api/admins | `admin:write` | super_admin |
| PUT /api/admins/:id | `admin:write` | super_admin |
| DELETE /api/admins/:id | `admin:delete` | super_admin |
| GET /api/users | `user:read` | super_admin, content_manager, support, viewer |
| POST /api/users | `user:write` | super_admin, content_manager, support |
| PUT /api/users/:id | `user:write` | super_admin, content_manager, support |
| DELETE /api/users/:id | `user:delete` | super_admin |
| GET /api/personas | `persona:read` | super_admin, content_manager, developer, viewer |
| POST /api/personas | `persona:write` | super_admin, content_manager || GET /api/knowledge/* (read) | `knowledge:read` | super_admin, content_manager, developer, viewer |
| POST/PUT /api/knowledge/* | `knowledge:write` | super_admin, content_manager |
| DELETE /api/knowledge/* | `knowledge:delete` | super_admin || Audit Logs | `audit:read` | All roles |

## 🚀 Quick Start Guide

### Step 1: Set Environment Variables

```bash
cp .env.example .env
# Edit .env and set JWT_SECRET to a strong random value (32+ characters)
```

Required in `.env`:
```bash
JWT_SECRET=your-secret-key-here-min-32-chars-change-in-production
```

### Step 2: Build and Run

```bash
npm install
npm run build
npm run dev
```

### Step 3: Create First Admin User

Since authentication is required for all admin endpoints, you'll need to create the first admin directly in the database:

```sql
-- First, generate a bcrypt hash for your password
-- Using Node.js REPL:
-- const bcrypt = require('bcrypt');
-- bcrypt.hash('yourPassword', 10, (err, hash) => console.log(hash));

INSERT INTO admins (id, display_name, roles, password, version, created_at, updated_at)
VALUES (
  'admin@example.com',
  'Super Admin',
  '["super_admin"]'::jsonb,
  '$2b$10$...',  -- Replace with your bcrypt hash
  1,
  NOW(),
  NOW()
);
```

Or use this helper script:
```bash
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('yourPassword', 10, (e,h) => console.log(h));"
```

### Step 4: Test Authentication

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "id": "admin@example.com",
    "password": "yourPassword"
  }'

# Response will contain accessToken and refreshToken
```

### Step 5: Use Access Token

```bash
# List admins with authentication
curl -X GET http://localhost:3000/api/admins \
  -H "Authorization: Bearer <access_token>"
```

### Step 6: Test in Swagger UI

1. Visit http://localhost:3000/api-docs
2. Click the "Authorize" button (top right)
3. Enter: `Bearer <your_access_token>`
4. Click "Authorize"
5. All requests will now include your token

## 📦 Dependencies

The following dependencies are included in `package.json`:
- `bcrypt@^6.0.0` - Password hashing
- `jsonwebtoken@9.0.3` - JWT token generation/validation  
- `@types/jsonwebtoken@9.0.10` - TypeScript types for JWT
- `@types/bcrypt` - TypeScript types for bcrypt (via bcrypt package)

## ✨ Features Summary

- ✅ JWT-based authentication with access and refresh tokens
- ✅ Role-Based Access Control (RBAC) with 5 predefined roles
- ✅ Granular permission system (`entity:action` format)
- ✅ Password hashing with bcrypt (10 salt rounds)
- ✅ Request context tracking for auditing
- ✅ BaseService with permission checking utilities
- ✅ Decorator-based route protection (via `checkPermissions` utility)
- ✅ Comprehensive error handling (401 Unauthorized, 403 Forbidden)
- ✅ Swagger UI with JWT authentication
- ✅ Full TypeScript support
- ✅ Audit logging integration with request context

## 🐛 Troubleshooting

### 401 Unauthorized
- Check if token is included in Authorization header
- Verify token hasn't expired (15 min for access tokens)
- Use refresh endpoint to get new access token
- Ensure JWT_SECRET environment variable is set

### 403 Forbidden
- User doesn't have required permissions
- Check user's roles in database
- Verify role has the required permissions in `permissions.ts`
- Check controller decorator: `@RequirePermissions([...])`

### Token Validation Errors
- Ensure JWT_SECRET environment variable is set
- Check token format: `Authorization: Bearer <token>`
- Verify token wasn't tampered with
- Check token expiration time

### Permission Interceptor Not Working
- Ensure `checkPermissions` is called at the start of each protected handler
- Verify user is authenticated (req.user exists)
- Check that public routes (like /auth/login) don't call checkPermissions

## 🎯 Next Steps & Enhancements

1. ✅ Set JWT_SECRET environment variable
2. ✅ Create first admin user in database
3. ✅ Test authentication endpoints
4. Review and customize roles/permissions for your needs
5. Add more granular permissions as needed
6. Consider implementing:
   - Password reset flow
   - Email verification
   - Rate limiting on auth endpoints
   - Session management
   - Token blacklisting for logout
   - Multi-factor authentication (MFA)
   - Password complexity requirements
   - Account lockout after failed attempts
