import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface LoadedPrompt {
  /** logical name, e.g. "exploration/depth-decision" */
  name: string;
  /** prompt set version, e.g. "v1" */
  version: string;
  /** absolute file the text came from */
  file: string;
  text: string;
  /** sha256 of the raw template, recorded in the execution trace */
  hash: string;
}

export interface RenderedPrompt extends LoadedPrompt {
  rendered: string;
  /** variables that appeared in the template but were not supplied */
  missingVariables: string[];
}

export class PromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptError';
  }
}

export interface PromptLoaderOptions {
  dir: string;
  version: string;
  /** disable in-memory caching (useful when editing prompts live) */
  cache?: boolean;
}

const VARIABLE = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;

/**
 * Loads prompts from disk. Prompt text lives in `prompts/<version>/...` and is
 * never embedded in TypeScript, so prompts can be reviewed, diffed and swapped
 * without touching or rebuilding the harness.
 *
 * Returns a descriptor rather than a bare string because the execution trace
 * must record which prompt name + version + hash produced each decision.
 */
export class PromptLoader {
  private readonly cache = new Map<string, LoadedPrompt>();
  private readonly root: string;
  readonly version: string;
  private readonly useCache: boolean;

  constructor(options: PromptLoaderOptions) {
    this.root = path.resolve(options.dir);
    this.version = options.version;
    this.useCache = options.cache ?? true;
  }

  private resolve(name: string): string {
    const clean = name.replace(/\.md$/, '');
    // Reject traversal: prompt names are logical paths, not filesystem input.
    if (clean.includes('..') || path.isAbsolute(clean)) {
      throw new PromptError(`Illegal prompt name: ${name}`);
    }
    const file = path.resolve(this.root, this.version, `${clean}.md`);
    const base = path.resolve(this.root, this.version);
    if (!file.startsWith(base + path.sep)) {
      throw new PromptError(`Prompt name escapes prompt root: ${name}`);
    }
    return file;
  }

  async load(name: string): Promise<LoadedPrompt> {
    const cached = this.useCache ? this.cache.get(name) : undefined;
    if (cached) return cached;

    const file = this.resolve(name);
    let text: string;
    try {
      text = await fs.readFile(file, 'utf-8');
    } catch {
      throw new PromptError(
        `Prompt "${name}" not found at ${file}. ` +
          `Check PROMPTS_DIR and PROMPT_VERSION.`
      );
    }
    const prompt: LoadedPrompt = {
      name,
      version: this.version,
      file,
      text,
      hash: crypto.createHash('sha256').update(text).digest('hex').slice(0, 16),
    };
    if (this.useCache) this.cache.set(name, prompt);
    return prompt;
  }

  /**
   * Substitutes {{VARIABLE}} placeholders. Deliberately not a general template
   * engine: no expressions, no code execution, no partials.
   */
  async render(
    name: string,
    variables: Record<string, string | number | undefined> = {}
  ): Promise<RenderedPrompt> {
    const prompt = await this.load(name);
    const missing = new Set<string>();
    const rendered = prompt.text.replace(VARIABLE, (_match, key: string) => {
      const value = variables[key];
      if (value === undefined) {
        missing.add(key);
        return '';
      }
      return String(value);
    });
    return {
      ...prompt,
      rendered,
      missingVariables: [...missing],
    };
  }

  /** Lists prompt names available for the configured version. */
  async list(): Promise<string[]> {
    const base = path.resolve(this.root, this.version);
    const out: string[] = [];
    const walk = async (dir: string, prefix: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) await walk(path.join(dir, e.name), `${prefix}${e.name}/`);
        else if (e.name.endsWith('.md')) out.push(prefix + e.name.replace(/\.md$/, ''));
      }
    };
    await walk(base, '');
    return out.sort();
  }
}
