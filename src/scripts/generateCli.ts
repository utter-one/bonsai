import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getOpenAPISpec } from '../swagger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '../..');
const CLI_DIR = join(ROOT, 'cli');
const CLI_SRC = join(CLI_DIR, 'src');
const BUNDLED_DIR = join(CLI_DIR, 'bundled');
const GENERATED_DIR = join(CLI_SRC, 'generated');

// ─── Types ───────────────────────────────────────────────────────────────────

interface PathParam {
  name: string;
  required: boolean;
}

interface Operation {
  method: string;
  path: string;
  pathTemplate: string;
  pathParams: PathParam[];
  queryParamNames: string[];
  repeatableParams: string[];
  hasBody: boolean;
  bodySchemaRef: string | null;
  action: string;
  summary: string;
  description: string;
  isPaginated: boolean;
  isUpdateOrDelete: boolean;
}

interface ResourceDef {
  name: string;
  scope: 'global' | 'project';
  operations: Operation[];
}

// ─── Path Parsing ────────────────────────────────────────────────────────────

const SKIP_PATTERNS = ['/callback', '/webhook', '/signaling', '/verify', '/authorize', '/auth/'];

function shouldSkip(path: string): boolean {
  return SKIP_PATTERNS.some(p => path.includes(p));
}

function extractPathParams(path: string): PathParam[] {
  const params: PathParam[] = [];
  const regex = /\{(\w+)\}/g;
  let match;
  while ((match = regex.exec(path)) !== null) {
    params.push({ name: match[1], required: true });
  }
  return params;
}

function toResourceName(pathSegment: string): string {
  return pathSegment.replace(/{/, '').replace(/}/, '').replace(/-([a-z])/g, (_, c) => `_${c.toLowerCase()}`);
}

function isProjectScoped(path: string): boolean {
  return path.match(/\/projects\/\{projectId\}\//) !== null;
}

const ACTION_SEGMENTS = new Set(['clone', 'archive', 'unarchive', 'events', 'event', 'artifacts', 'artifact', 'artifact_download', 'audit-logs', 'results', 'cancel', 'execute', 'preview', 'reveal', 'models', 'login', 'refresh', 'status', 'initial-operator', 'profile', 'scope', 'pull', 'jobs']);

function extractResourceName(path: string): string {
  const segs = path.split('/').filter(Boolean);

  if (isProjectScoped(path)) {
    const projectIdx = segs.findIndex(s => s === '{projectId}');
    if (projectIdx >= 0 && projectIdx + 1 < segs.length) {
      const afterProject = segs.slice(projectIdx + 1);
      let parts: string[] = [];
      for (const s of afterProject) {
        if (s.startsWith('{')) break;
        if (ACTION_SEGMENTS.has(s)) break;
        parts.push(s);
      }
      if (parts.length === 0) parts.push(afterProject[0]);
      return parts.map(toResourceName).join('_');
    }
  }

  const apiIdx = segs.findIndex(s => s === 'api');
  if (apiIdx >= 0 && apiIdx + 1 < segs.length) {
    const afterApi = segs.slice(apiIdx + 1);
    let parts: string[] = [];
    for (const s of afterApi) {
      if (s.startsWith('{')) break;
      if (ACTION_SEGMENTS.has(s)) break;
      parts.push(s);
    }
    if (parts.length === 0) parts.push(afterApi[0]);
    return parts.map(toResourceName).join('_');
  }

  return '';
}

function hasDetermineActionSpecialCase(method: string, path: string): boolean {
  const segs = path.split('/').filter(Boolean);
  const last = segs[segs.length - 1];
  const secondLast = segs.length > 1 ? segs[segs.length - 2] : '';

  if (path.includes('/login')) return true;
  if (path.includes('/refresh')) return true;
  if (path.includes('/status')) return true;
  if (path.includes('/initial-operator')) return true;
  if (path.includes('/models')) return true;
  if (path === '/api/profile') return true;
  if (path.includes('/scheduler')) return true;
  if (path.includes('/deploy-webhook')) return true;
  if (path.includes('/smtp-imap/send')) return true;
  if (path.includes('/migration/export')) return true;
  if (path.includes('/projects/import')) return true;
  if (path.includes('/secrets') && path.includes('/value')) return true;
  if (last === 'export') return true;
  if (last === 'clone') return true;
  if (last === 'archive') return true;
  if (last === 'unarchive') return true;
  if (last === 'events') return true;
  if (last === 'event' && secondLast === 'events') return true;
  if (last === 'artifacts') return true;
  if (last === 'artifact' && secondLast === 'artifacts') return true;
  if (last === 'artifact_download') return true;
  if (last === 'audit-logs') return true;
  if (last === 'results') return true;
  if (last === 'cancel') return true;
  if (last === 'execute') return true;
  if (last === 'preview') return true;
  if (last === 'reveal') return true;

  return false;
}

function determineAction(method: string, path: string): string {
  const segs = path.split('/').filter(Boolean);
  const last = segs[segs.length - 1];
  const secondLast = segs.length > 1 ? segs[segs.length - 2] : '';

  if (path.includes('/login')) return 'login';
  if (path.includes('/refresh')) return 'refresh';
  if (path.includes('/status')) return 'status';
  if (path.includes('/initial-operator')) return 'initial_operator';
  if (path.includes('/models')) return 'models';
  if (path === '/api/profile' && method === 'get') return 'get';
  if (path === '/api/profile' && method === 'post') return 'update';
  if (path.includes('/scheduler')) return method === 'get' ? 'get' : 'update';
  if (path.includes('/deploy-webhook')) return 'deploy';
  if (path.includes('/smtp-imap/send')) return 'send';
  if (path.includes('/migration/export')) return 'export';
  if (path.includes('/projects/import')) return 'import';
  if (path.includes('/secrets') && path.includes('/value')) return method === 'get' ? 'get_value' : 'update_value';

  if (last === 'export') return 'export';
  if (last === 'clone') return 'clone';
  if (last === 'archive') return 'archive';
  if (last === 'unarchive') return 'unarchive';
  if (last === 'events') return 'events';
  if (last === 'event' && secondLast === 'events') return 'event';
  if (last === 'artifacts') return 'artifacts';
  if (last === 'artifact' && secondLast === 'artifacts') return 'artifact';
  if (last === 'artifact_download') return 'artifact_download';
  if (last === 'audit-logs') return 'audit';
  if (last === 'results') return method === 'get' ? 'results_get' : 'results';
  if (last === 'cancel') return 'cancel';
  if (last === 'execute') return 'execute';
  if (last === 'preview') return 'preview';
  if (last === 'reveal') return 'reveal';

  if (method === 'get' && last.includes('{')) return 'get';
  if (method === 'get') return 'list';
  if (method === 'post') return 'create';
  if (method === 'put') return 'update';
  if (method === 'delete') return 'delete';

  return last || 'execute';
}

function deriveActionFromPath(method: string, path: string, resourceName: string): string | null {
  const segs = path.split('/').filter(Boolean);
  const resourceHyphen = resourceName.replace(/_/g, '-');

  // Get non-param segments from path (excluding 'api', 'projects', and params)
  const pathSegments = segs.filter(s =>
    s !== 'api' && s !== 'projects' && !s.includes('{')
  );

  // If path segments exactly match the resource name, it's a base CRUD operation
  if (pathSegments.join('-') === resourceHyphen) {
    return null;
  }

  // Find where the resource name ends in the path
  let resourceEndIdx = -1;

  // Try 1: exact segment match (e.g. "api-keys" matches segment "api-keys")
  for (let i = 0; i < segs.length; i++) {
    if (segs[i] === resourceHyphen) {
      resourceEndIdx = i;
    }
  }

  // Try 2: consecutive segments (e.g. "analytics" + "saved-queries")
  if (resourceEndIdx < 0) {
    const resourceParts = resourceHyphen.split('-');
    for (let i = 0; i <= segs.length - resourceParts.length; i++) {
      let match = true;
      for (let j = 0; j < resourceParts.length; j++) {
        if (segs[i + j].includes('{') || segs[i + j] !== resourceParts[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        resourceEndIdx = i + resourceParts.length - 1;
        break;
      }
    }
  }

  // Try 3: individual parts — prefer the LAST match to avoid false positives
  // (e.g. "api" in "api_keys" shouldn't match the "api" prefix at index 0)
  if (resourceEndIdx < 0) {
    const singleParts = resourceName.split('_');
    for (let i = segs.length - 1; i >= 0; i--) {
      if (segs[i].includes('{')) continue;
      if (singleParts.includes(segs[i])) {
        resourceEndIdx = i;
        break;
      }
    }
  }

  // Get meaningful segments after the resource name
  const afterResource = resourceEndIdx >= 0 ? segs.slice(resourceEndIdx + 1) : [];
  const actionSegments: string[] = [];

  for (const s of afterResource) {
    if (s.startsWith('{')) continue;
    if (s === 'audit-logs') actionSegments.push('audit');
    else actionSegments.push(s.replace(/-/g, '_'));
  }

  if (actionSegments.length > 0) {
    // If the path ends with a param (e.g. /events/{eventId}), use singular form
    const lastSeg = afterResource[afterResource.length - 1];
    if (lastSeg && lastSeg.startsWith('{') && actionSegments.length > 0) {
      const lastAction = actionSegments[actionSegments.length - 1];
      if (lastAction.endsWith('s')) {
        actionSegments[actionSegments.length - 1] = lastAction.slice(0, -1);
      }
    }
    return actionSegments.join('_');
  }

  return null;
}

function parseOperations(spec: any): Map<string, ResourceDef> {
  const resources = new Map<string, ResourceDef>();

  const paths = spec.paths || {};

  for (const [rawPath, pathItem] of Object.entries(paths)) {
    if (shouldSkip(rawPath)) continue;

    const allPathParams = extractPathParams(rawPath);
    const scope: 'global' | 'project' = isProjectScoped(rawPath) ? 'project' : 'global';
    const resourceName = extractResourceName(rawPath);

    if (!resourceName) continue;

    const pathParams = allPathParams.filter(p => p.name !== 'projectId');

    for (const method of ['get', 'post', 'put', 'delete', 'patch'] as const) {
      const op = (pathItem as any)[method];
      if (!op) continue;

      const queryParamNames: string[] = [];
      const repeatableParams: string[] = [];
      if (op.parameters && Array.isArray(op.parameters)) {
        for (const param of op.parameters) {
          if (param.in === 'query' && param.name) {
            queryParamNames.push(param.name);
            if (param.schema && param.schema.type === 'array') {
              repeatableParams.push(param.name);
            }
          }
        }
      }

      const requestBody = op.requestBody;
      let hasBody = !!requestBody;
      let bodySchemaRef: string | null = null;

      if (requestBody && requestBody.content && requestBody.content['application/json']) {
        const schema = requestBody.content['application/json'].schema;
        if (schema && schema.$ref) {
          bodySchemaRef = schema.$ref.replace('#/components/schemas/', '');
        }
        hasBody = true;
      }

      let action = determineAction(method, rawPath);
      const summary = op.summary || `${action} ${resourceName}`;
      const description = op.description || summary;

      // Merge same-name resources regardless of scope
      let resource = resources.get(resourceName);

      if (!resource) {
        resource = { name: resourceName, scope, operations: [] };
        resources.set(resourceName, resource);
      } else if (scope === 'project') {
        // Project-scoped takes priority
        resource.scope = 'project';
      }

      resource.operations.push({
        method,
        path: rawPath,
        pathTemplate: rawPath,
        pathParams,
        queryParamNames,
        repeatableParams,
        hasBody,
        bodySchemaRef,
        action,
        summary,
        description,
        isPaginated: queryParamNames.includes('offset') && queryParamNames.includes('limit'),
        isUpdateOrDelete: method === 'put' || method === 'delete',
      });
    }
  }

  // Derive better action names from paths, then deduplicate
  const allResourceNames = new Set(resources.keys());
  for (const [, resource] of resources) {
    for (const op of resource.operations) {
      // Only use path-derived action when determineAction has no special case for this path
      if (!hasDetermineActionSpecialCase(op.method, op.path)) {
        const pathAction = deriveActionFromPath(op.method, op.path, resource.name);
        if (pathAction) {
          op.action = pathAction;
        }
      }
      // Disambiguate: if action name matches or is a suffix of another resource name, append _list
      if (op.method === 'get' && op.action !== resource.name) {
        const KNOWN_ACTIONS = new Set(['export', 'import', 'clone', 'archive', 'unarchive', 'audit', 'preview', 'reveal', 'cancel', 'execute', 'login', 'refresh', 'status', 'setup', 'initial_operator', 'deploy', 'send', 'models', 'results_get']);
        if (!KNOWN_ACTIONS.has(op.action)) {
          const isAmbiguous = allResourceNames.has(op.action) ||
            [...allResourceNames].some(name => name !== resource.name && name.endsWith(`_${op.action}`));
          if (isAmbiguous) {
            op.action = `${op.action}_list`;
          }
        }
      }
    }

    // Deduplicate: prefer project-scoped paths, drop global duplicates
    const byAction = new Map<string, Operation[]>();
    for (const op of resource.operations) {
      if (!byAction.has(op.action)) byAction.set(op.action, []);
      byAction.get(op.action)!.push(op);
    }

    const deduped: Operation[] = [];
    for (const [, ops] of byAction) {
      if (ops.length === 1) {
        deduped.push(ops[0]);
      } else {
        // Sort: project-scoped first, then by path length
        ops.sort((a, b) => {
          const aProject = isProjectScoped(a.path) ? 0 : 1;
          const bProject = isProjectScoped(b.path) ? 0 : 1;
          if (aProject !== bProject) return aProject - bProject;
          return a.path.length - b.path.length;
        });
        // Keep project-scoped, drop global duplicates with same action
        const kept = ops[0];
        deduped.push(kept);
        // For distinct operations (different methods or truly different paths), keep with suffix
        for (let i = 1; i < ops.length; i++) {
          const op = ops[i];
          // If same method and same base path, it's a true duplicate — skip
          if (op.method === kept.method && !isProjectScoped(op.path)) continue;
          const pathSegs = op.path.split('/').filter(Boolean);
          const last = pathSegs[pathSegs.length - 1];
          if (last && !last.includes('{')) {
            op.action = `${op.action}_${last.replace(/-/g, '_')}`;
          } else {
            // Last segment is a param — use the preceding segment (singularized)
            const secondLast = pathSegs[pathSegs.length - 2];
            if (secondLast && !secondLast.includes('{')) {
              const singular = secondLast.endsWith('s') ? secondLast.slice(0, -1) : secondLast;
              op.action = `${op.action}_${singular.replace(/-/g, '_')}`;
            } else {
              op.action = `${op.action}_${op.method}`;
            }
          }
          deduped.push(op);
        }
      }
    }

    resource.operations = deduped;
  }

  return resources;
}

// ─── Code Generation ─────────────────────────────────────────────────────────

function generateResourcesManifest(resources: Map<string, ResourceDef>): string {
  let code = '// Auto-generated by generateCli.ts — DO NOT EDIT\n\n';
  code += 'export interface PathParam { name: string; required: boolean; }\n';
  code += 'export interface Operation {\n';
  code += '  method: string;\n  path: string;\n  pathTemplate: string;\n';
  code += '  pathParams: PathParam[];\n  queryParamNames: string[];\n';
  code += '  repeatableParams: string[];\n';
  code += '  hasBody: boolean;\n  bodySchemaRef: string | null;\n';
  code += '  action: string;\n  summary: string;\n  description: string;\n  isPaginated: boolean;\n';
  code += '  isUpdateOrDelete: boolean;\n';
  code += '}\nexport interface ResourceDef {\n';
  code += '  name: string;\n  scope: "global" | "project";\n  operations: Operation[];\n}\n\n';

  code += 'export const RESOURCES: Record<string, ResourceDef> = {\n';
  for (const [, resource] of resources) {
    code += `  "${resource.name}": {\n`;
    code += `    name: "${resource.name}",\n`;
    code += `    scope: "${resource.scope}",\n`;
    code += `    operations: [\n`;
    for (const op of resource.operations) {
      code += `      {\n`;
      code += `        method: "${op.method}",\n`;
      code += `        path: "${op.path}",\n`;
      code += `        pathTemplate: "${op.pathTemplate}",\n`;
      code += `        pathParams: ${JSON.stringify(op.pathParams)},\n`;
      code += `        queryParamNames: ${JSON.stringify(op.queryParamNames)},\n`;
      code += `        repeatableParams: ${JSON.stringify(op.repeatableParams)},\n`;
      code += `        hasBody: ${op.hasBody},\n`;
      code += `        bodySchemaRef: ${op.bodySchemaRef ? `"${op.bodySchemaRef}"` : 'null'},\n`;
      code += `        action: "${op.action}",\n`;
      code += `        summary: ${JSON.stringify(op.summary)},\n`;
      code += `        description: ${JSON.stringify(op.description)},\n`;
      code += `        isPaginated: ${op.isPaginated},\n`;
      code += `        isUpdateOrDelete: ${op.isUpdateOrDelete},\n`;
      code += `      },\n`;
    }
    code += `    ],\n`;
    code += `  },\n`;
  }
  code += '};\n\n';

  code += 'export function getResourceNames(): string[] {\n';
  code += '  return Object.keys(RESOURCES);\n';
  code += '}\n';

  return code;
}

function generateCommandsFile(resources: Map<string, ResourceDef>): string {
  let code = '// Auto-generated by generateCli.ts — DO NOT EDIT\n\n';
  code += "import { Command } from 'commander';\n";
  code += "import { RESOURCES, getResourceNames, ResourceDef, PathParam } from './resources.js';\n";
  code += "import { runOperation } from '../lib/handler.js';\n";
  code += "import { getOperationSchema } from '../lib/schema.js';\n\n";

  code += 'const QUERY_PARAM_ALIASES: Record<string, string> = {\n';
  code += '  textSearch: \'search\',\n';
  code += '  orderBy: \'order\',\n';
  code += '  filters: \'filter\',\n';
  code += '};\n\n';

  code += 'export function registerCommands(program: Command): void {\n';
  code += '  const resourceNames = Object.keys(RESOURCES);\n\n';

  code += '  for (const name of resourceNames) {\n';
  code += '    const res = RESOURCES[name] as ResourceDef;\n\n';

  code += '    const cmd = new Command(res.name)\n';
  code += '      .description(`${res.name.charAt(0).toUpperCase() + res.name.slice(1)} ${res.scope === "project" ? "(project-scoped)" : "(global)"}`)\n';
  code += '      .option(\'--json\', \'Emit JSON envelope\', false)\n';
  code += '      .option(\'-v, --verbose\', \'Verbose output\', false)\n';

   code += '    for (const op of res.operations) {\n';
  code += '      const argStr = op.pathParams.map((p: PathParam) => `<${p.name}>`).join(\' \');\n';
    code += '      const actionCmd = cmd.command(op.action + (argStr ? \' \' + argStr : \'\'))\n';
    code += '        .description(op.summary)\n';
   code += '        .option(\'--json\', \'Emit JSON envelope\', false)\n';
   code += '        .option(\'-v, --verbose\', \'Verbose output\', false)\n';
   code += '        .option(\'--base-url <url>\', \'API base URL\')\n';
   code += '        .option(\'--token <string>\', \'Auth token\')\n';
   code += '        .option(\'--timeout <ms>\', \'Request timeout\', \'30000\')\n';

   code += '      if (res.scope === "project") {\n';
   code += '        actionCmd.option(\'--project <id>\', \'Project ID\');\n';
   code += '      }\n';

  code += '      if (op.hasBody) {\n';
  code += '        actionCmd\n';
  code += '          .option(\'--data <json>\', \'Request body as JSON string, or "-" for stdin\')\n';
  code += '          .option(\'--data-file <path>\', \'Request body from JSON file\');\n';
  code += '      }\n';

  code += '      for (const qp of op.queryParamNames) {\n';
  code += '        const alias = QUERY_PARAM_ALIASES[qp];\n';
  code += '        const flagName = alias || qp;\n';
  code += '        if (op.repeatableParams.includes(qp)) {\n';
  code += '          actionCmd.option(`--${flagName} <value>`, qp, [], (v, p: string[]) => [...p, v]);\n';
  code += '        } else {\n';
  code += '          actionCmd.option(`--${flagName} <value>`, qp);\n';
  code += '        }\n';
  code += '      }\n';

  code += '      if (op.isUpdateOrDelete) {\n';
  code += '        actionCmd.option(\'--version <number>\', \'Entity version for optimistic locking\');\n';
  code += '      }\n';

  code += '      actionCmd.option(\'--json-schema\', \'Output JSON schema for this operation\', false);\n';
  code += '      actionCmd.option(\'--paginate\', \'Fetch all pages\', false);\n\n';

   code += '      actionCmd\n';
   code += '        .action(async (...allArgs: any[]) => {\n';
   code += '          const opts = allArgs.length > 1 ? allArgs[allArgs.length - 2] : allArgs[0];\n';
   code += '          const positionalArgs = allArgs.length > 1 ? allArgs.slice(0, -2) : [];\n';
   code += '          const allOpts: any = { ...opts };\n';
   code += '          op.pathParams.forEach((p: PathParam, i: number) => { allOpts[p.name] = positionalArgs[i]; });\n';

   code += '          for (const qp of op.queryParamNames) {\n';
   code += '            const alias = QUERY_PARAM_ALIASES[qp];\n';
   code += '            if (alias && allOpts[alias] !== undefined) {\n';
   code += '              allOpts[qp] = allOpts[alias];\n';
   code += '            }\n';
   code += '          }\n';

   code += '          if (op.isUpdateOrDelete && allOpts.version !== undefined) {\n';
   code += '            if (allOpts.data !== undefined && allOpts.data !== null && allOpts.data !== \'\') {\n';
   code += '              let body: any;\n';
   code += '              if (typeof allOpts.data === \'string\') {\n';
   code += '                body = JSON.parse(allOpts.data);\n';
   code += '              } else {\n';
   code += '                body = allOpts.data;\n';
   code += '              }\n';
   code += '              body.version = Number(allOpts.version);\n';
   code += '              allOpts.data = JSON.stringify(body);\n';
   code += '            }\n';
   code += '          }\n';

  code += '          if (allOpts.jsonSchema) {\n';
  code += '            const schema = await getOperationSchema(\n';
  code += '              { method: op.method, pathTemplate: op.pathTemplate, scope: res.scope, action: op.action, pathParamNames: op.pathParams.map((p: PathParam) => p.name), queryParamNames: op.queryParamNames, bodySchemaRef: op.bodySchemaRef }\n';
  code += '            );\n';
  code += '            process.stdout.write(JSON.stringify(schema, null, 2) + "\\n");\n';
  code += '            process.exit(0);\n';
  code += '          }\n';
  code += '          const exitCode = await runOperation(\n';
  code += '            { method: op.method, pathTemplate: op.pathTemplate, scope: res.scope, action: op.action, pathParamNames: op.pathParams.map((p: PathParam) => p.name), queryParamNames: op.queryParamNames, repeatableParams: op.repeatableParams, isPaginated: op.isPaginated },\n';
  code += '            allOpts\n';
  code += '          );\n';
  code += '          process.exit(exitCode);\n';
  code += '        });\n';
  code += '    }\n\n';

  code += '    program.addCommand(cmd);\n';
  code += '  }\n';
  code += '}\n';

  return code;
}

function generateIndex(resources: Map<string, ResourceDef>): string {
  const resourceList = [...resources.values()]
    .map(r => `  ${r.name.padEnd(25)} ${r.scope === 'project' ? '(project)' : '(global)'}`)
    .join('\\n');

  let code = '// Auto-generated by generateCli.ts — DO NOT EDIT\n\n';
  code += "import { Command } from 'commander';\n";
  code += "import { registerCommands } from './generated/commands.js';\n";
  code += "import { getResourceNames } from './generated/resources.js';\n";
  code += "import { loadConfig } from './lib/config.js';\n";
  code += "import { registerAuthCommands } from './lib/auth.js';\n";
  code += "import { registerOpenApiCommands } from './lib/openapi.js';\n";
  code += "import { getOperationSchema } from './lib/schema.js';\n\n";

  code += 'const program = new Command();\n\n';
  code += 'program\n';
  code += '  .name(\'bonsai\')\n';
  code += '  .description(\'Bonsai agentic CLI\\n\\nResources:\\n\' + \'' + resourceList + '\')\n';
  code += '  .version(process.env.npm_package_version || \'0.1.0\')\n';
  code += '  .option(\'--json\', \'Emit JSON envelope\', false)\n';
  code += '  .option(\'-v, --verbose\', \'Verbose output\', false)\n';
  code += '  .option(\'-q, --quiet\', \'Suppress non-essential output\', false)\n';
  code += '  .option(\'--timeout <ms>\', \'Request timeout\', \'30000\')\n';
  code += '  .hook(\'preAction\', async () => {\n';
  code += '    // Config is resolved per-command in handler\n';
  code += '  })\n';

  code += '\nregisterCommands(program);\n';
  code += 'registerAuthCommands(program);\n';
  code += 'registerOpenApiCommands(program);\n\n';

  code += '// Discovery commands\n';
  code += 'program.command(\'resources\')\n';
  code += '  .description(\'List all available resources\')\n';
  code += '  .option(\'--json\', \'Emit JSON\', false)\n';
  code += '  .action((opts: any) => {\n';
  code += '    const names = getResourceNames();\n';
  code += '    if (opts.json) {\n';
  code += '      process.stdout.write(JSON.stringify({ status: "ok", data: names, error: null, meta: {} }) + "\\n");\n';
  code += '    } else {\n';
  code += '      for (const name of names) {\n';
  code += '        process.stdout.write(name + "\\n");\n';
  code += '      }\n';
  code += '    }\n';
  code += '  });\n\n';

  code += 'program.parse();\n';

  return code;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  console.log('Generating OpenAPI spec...');
  const spec = getOpenAPISpec();

  // Write bundled OpenAPI spec
  mkdirSync(BUNDLED_DIR, { recursive: true });
  writeFileSync(join(BUNDLED_DIR, 'openapi.json'), JSON.stringify(spec, null, 2));
  console.log(`  → ${BUNDLED_DIR}/openapi.json`);

  // Parse resources
  const resources = parseOperations(spec);
  console.log(`  Found ${resources.size} resources`);

  for (const [, res] of resources) {
    console.log(`  ${res.name} (${res.scope}): ${res.operations.map(o => o.action).join(', ')}`);
  }

  // Clear generated directory
  if (true) {
    try {
      rmSync(GENERATED_DIR, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
  mkdirSync(GENERATED_DIR, { recursive: true });

  // Generate resources manifest
  const manifestCode = generateResourcesManifest(resources);
  writeFileSync(join(GENERATED_DIR, 'resources.ts'), manifestCode);
  console.log(`  → ${GENERATED_DIR}/resources.ts`);

  // Generate commands registration
  const commandsCode = generateCommandsFile(resources);
  writeFileSync(join(GENERATED_DIR, 'commands.ts'), commandsCode);
  console.log(`  → ${GENERATED_DIR}/commands.ts`);

  // Generate index.ts
  const indexCode = generateIndex(resources);
  writeFileSync(join(CLI_SRC, 'index.ts'), indexCode);
  console.log(`  → ${CLI_SRC}/index.ts`);

  console.log('\nDone. Run `cd cli && npm install && npx tsx src/index.ts --help` to test.');
}

main();
