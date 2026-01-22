import { singleton } from 'tsyringe';
import Handlebars from 'handlebars';
import { logger } from '../../utils/logger';
import { ConversationContext } from './ConversationContextBuilder';

/**
 * Templating engine for LLM prompts and other parts of the system.
 * Compiles templates with provided context to generate final text.
 * Uses a custom Handlebars instance with enhanced helpers for safe data access and manipulation.
 * Features template caching for improved performance on repeated renders.
 */
@singleton()
export class TemplatingEngine {
  private readonly handlebars: typeof Handlebars;
  private readonly templateCache = new Map<string, HandlebarsTemplateDelegate>();
  private readonly maxCacheSize = 1000;

  constructor() {
    this.handlebars = Handlebars.create();
    this.registerHelpers();
  }

  /**
   * Register custom Handlebars helpers
   */
  private registerHelpers(): void {
    // Helper to safely access nested properties
    this.handlebars.registerHelper('get', function (object: any, path: string) {
      if (!object || !path) return '';

      const keys = path.split('.');
      let result = object;

      for (const key of keys) {
        if (result && typeof result === 'object' && key in result) {
          result = result[key];
        } else {
          return '';
        }
      }

      return result || '';
    });

    // Helper to check if a value exists (block helper)
    this.handlebars.registerHelper('exists', function (value: any, options: any) {
      const exists = value !== null && value !== undefined && value !== '';
      if (options.fn) {
        // Used as block helper {{#exists}}...{{/exists}}
        return exists ? options.fn(this) : options.inverse(this);
      } else {
        // Used as simple helper {{exists}}
        return exists;
      }
    });

    // Helper for conditional rendering based on array length (block helper)
    this.handlebars.registerHelper('hasItems', function (array: any[], options: any) {
      const hasItems = Array.isArray(array) && array.length > 0;
      if (options.fn) {
        // Used as block helper {{#hasItems}}...{{/hasItems}}
        return hasItems ? options.fn(this) : options.inverse(this);
      } else {
        // Used as simple helper {{hasItems}}
        return hasItems;
      }
    });

    // Helper to join array items
    this.handlebars.registerHelper('join', function (array: any[], separator: string = ', ') {
      if (!Array.isArray(array)) return '';
      return array.join(separator);
    });

    // Helper to check if array has certain element (block helper)
    this.handlebars.registerHelper('contains', function (array: any[], value: any, options: any) {
      const contains = Array.isArray(array) && array.includes(value);
      if (options.fn) {
        // Used as block helper {{#contains}}...{{/contains}}
        return contains ? options.fn(this) : options.inverse(this);
      } else {
        // Used as simple helper {{contains}}
        return contains;
      }
    });

    // Helper for default values
    this.handlebars.registerHelper('default', function (value: any, defaultValue: any) {
      return value || defaultValue;
    });

    // Helper to stringify objects as JSON
    this.handlebars.registerHelper('json', function (value: any, pretty?: boolean) {
      if (value === null || value === undefined) return '';
      try {
        return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error), value }, 'Failed to stringify value as JSON in handlebars helper');
        return String(value);
      }
    });

    // Comparison helpers
    this.handlebars.registerHelper('eq', function (a: any, b: any, options: any) {
      const isEqual = a === b;
      if (options.fn) {
        return isEqual ? options.fn(this) : options.inverse(this);
      }
      return isEqual;
    });

    this.handlebars.registerHelper('ne', function (a: any, b: any, options: any) {
      const notEqual = a !== b;
      if (options.fn) {
        return notEqual ? options.fn(this) : options.inverse(this);
      }
      return notEqual;
    });

    this.handlebars.registerHelper('gt', function (a: any, b: any, options: any) {
      const greaterThan = a > b;
      if (options.fn) {
        return greaterThan ? options.fn(this) : options.inverse(this);
      }
      return greaterThan;
    });

    this.handlebars.registerHelper('gte', function (a: any, b: any, options: any) {
      const greaterOrEqual = a >= b;
      if (options.fn) {
        return greaterOrEqual ? options.fn(this) : options.inverse(this);
      }
      return greaterOrEqual;
    });

    this.handlebars.registerHelper('lt', function (a: any, b: any, options: any) {
      const lessThan = a < b;
      if (options.fn) {
        return lessThan ? options.fn(this) : options.inverse(this);
      }
      return lessThan;
    });

    this.handlebars.registerHelper('lte', function (a: any, b: any, options: any) {
      const lessOrEqual = a <= b;
      if (options.fn) {
        return lessOrEqual ? options.fn(this) : options.inverse(this);
      }
      return lessOrEqual;
    });

    // Logical helpers
    this.handlebars.registerHelper('and', function (...args: any[]) {
      const options = args[args.length - 1];
      const values = args.slice(0, -1);
      const result = values.every(v => v);
      if (options.fn) {
        return result ? options.fn(this) : options.inverse(this);
      }
      return result;
    });

    this.handlebars.registerHelper('or', function (...args: any[]) {
      const options = args[args.length - 1];
      const values = args.slice(0, -1);
      const result = values.some(v => v);
      if (options.fn) {
        return result ? options.fn(this) : options.inverse(this);
      }
      return result;
    });

    this.handlebars.registerHelper('not', function (value: any, options: any) {
      const inverted = !value;
      if (options.fn) {
        return inverted ? options.fn(this) : options.inverse(this);
      }
      return inverted;
    });

    // Override default object-to-string conversion to use JSON.stringify
    // This ensures objects are properly serialized when used in templates
    this.handlebars.registerHelper('helperMissing', function (...args: any[]) {
      // Get the actual value (last arg is options object from Handlebars)
      const value = args.length > 1 ? args[0] : undefined;
      if (value !== null && value !== undefined && typeof value === 'object') {
        try {
          return JSON.stringify(value);
        } catch (error) {
          return '[Object]';
        }
      }
      return value !== undefined ? String(value) : '';
    });
  }

  /**
   * Gets a compiled template from cache or compiles and caches it
   * @param template - Template string to compile
   * @returns Compiled Handlebars template
   */
  private getCompiledTemplate(template: string): HandlebarsTemplateDelegate {
    // Check cache first
    let compiled = this.templateCache.get(template);
    
    if (!compiled) {
      // Compile and cache
      compiled = this.handlebars.compile(template);
      
      // Implement simple LRU by clearing cache when it gets too large
      if (this.templateCache.size >= this.maxCacheSize) {
        const firstKey = this.templateCache.keys().next().value;
        this.templateCache.delete(firstKey);
        logger.debug({ cacheSize: this.templateCache.size }, 'Template cache limit reached, removed oldest entry');
      }
      
      this.templateCache.set(template, compiled);
    }
    
    return compiled;
  }

  /**
   * Builds a prompt by compiling the Handlebars template with the provided context.
   * Templates are cached for improved performance on repeated renders.
   * @param template - Handlebars template string
   * @param context - LlmContext object containing data for template compilation
   * @returns Compiled prompt string
   * @throws Error if template compilation or rendering fails
   */
  async render(template: string, context: ConversationContext): Promise<string> {
    try {
      let compiledTemplate = this.getCompiledTemplate(template);
      let rendered = compiledTemplate(context);
      if (rendered.indexOf('{{') !== -1) {
        compiledTemplate = this.getCompiledTemplate(rendered);
        rendered = compiledTemplate(context);
      }
      if (rendered.indexOf('{{') !== -1) {
        logger.warn({ template: template.substring(0, 200) }, 'Rendered template still contains unprocessed Handlebars expressions after two passes. Ignoring further processing.');
      }

      return rendered;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, template: template.substring(0, 200) }, 'Failed to render Handlebars template');
      throw new Error(`Template rendering failed: ${errorMessage}`);
    }
  }

  /**
   * Clears the template cache
   * Useful for testing or when memory usage needs to be controlled
   */
  clearCache(): void {
    this.templateCache.clear();
    logger.debug('Template cache cleared');
  }

  /**
   * Gets current cache statistics
   * @returns Object with cache size and max size
   */
  getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.templateCache.size,
      maxSize: this.maxCacheSize,
    };
  }
}


