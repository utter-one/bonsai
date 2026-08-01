import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENAPI_PATH = resolve(__dirname, '../../bundled/openapi.json');

let openApiSpec: any = null;

function loadOpenApiSpec(): any {
  if (openApiSpec) return openApiSpec;
  try {
    const raw = readFileSync(OPENAPI_PATH, 'utf-8');
    openApiSpec = JSON.parse(raw);
    return openApiSpec;
  } catch {
    return null;
  }
}

export interface SchemaRequest {
  method: string;
  pathTemplate: string;
  scope: 'global' | 'project';
  action: string;
  pathParamNames: string[];
  queryParamNames: string[];
  bodySchemaRef?: string | null;
}

export async function getOperationSchema(req: SchemaRequest): Promise<Record<string, unknown>> {
  const spec = loadOpenApiSpec();
  if (!spec) {
    return { error: 'OpenAPI spec not found' };
  }

  const paths = spec.paths || {};
  const pathItem = paths[req.pathTemplate];
  if (!pathItem) {
    return { error: `Path not found: ${req.pathTemplate}` };
  }

  const operation = pathItem[req.method.toLowerCase()];
  if (!operation) {
    return { error: `Operation not found: ${req.method} ${req.pathTemplate}` };
  }

  const schema: Record<string, unknown> = {
    operation: `${req.method.toUpperCase()} ${req.pathTemplate}`,
    summary: operation.summary || '',
    description: operation.description || '',
  };

  const parameters = operation.parameters || [];

  const pathParams: Record<string, unknown>[] = [];
  const queryParams: Record<string, unknown>[] = [];

  for (const param of parameters) {
    const paramSchema: Record<string, unknown> = {
      name: param.name,
      in: param.in,
      required: param.required || false,
      description: param.description || '',
    };

    if (param.schema) {
      paramSchema.type = param.schema.type;
      if (param.schema.format) paramSchema.format = param.schema.format;
    }

    if (param.in === 'path') {
      pathParams.push(paramSchema);
    } else if (param.in === 'query') {
      queryParams.push(paramSchema);
    }
  }

  if (pathParams.length > 0) {
    schema.pathParameters = pathParams;
  }

  if (queryParams.length > 0) {
    schema.queryParameters = queryParams;
  }

  const requestBody = operation.requestBody;
  if (requestBody) {
    const content = requestBody.content || {};
    const jsonContent = content['application/json'] as Record<string, unknown> | undefined;
    if (jsonContent?.schema) {
      schema.requestBody = {
        description: requestBody.description || '',
        required: requestBody.required || false,
        schema: jsonContent.schema,
      };
    }
  }

  const responses = operation.responses || {};
  const successResponses: Record<string, unknown>[] = [];

  for (const [status, response] of Object.entries(responses)) {
    const resp = response as Record<string, unknown>;
    const respContent = (resp.content || {}) as Record<string, unknown>;
    const jsonContent = respContent['application/json'] as Record<string, unknown> | undefined;
    const jsonSchema = jsonContent?.schema;

    successResponses.push({
      status: Number(status),
      description: resp.description || '',
      schema: jsonSchema || null,
    });
  }

  if (successResponses.length > 0) {
    schema.responses = successResponses;
  }

  return schema;
}
