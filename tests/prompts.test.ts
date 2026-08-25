import assert from 'node:assert/strict';
import * as path from 'node:path';
import test, { describe } from 'node:test';
import { PromptLoader } from '../src/prompts/PromptLoader';
import { ROOT } from './helpers';

const loader = new PromptLoader({ dir: path.join(ROOT, 'prompts'), version: 'v1' });

describe('prompt loader', () => {
  test('every prompt the agents reference exists on disk', async () => {
    const required = [
      'system/base',
      'system/correction',
      'ontology/discovery',
      'ontology/entity-resolution',
      'ontology/relationship-detection',
      'ontology/concept-discovery',
      'exploration/depth-decision',
      'exploration/observation-planning',
      'exploration/gap-analysis',
      'validation/validation',
      'validation/refinement',
      'validation/completion',
    ];
    const available = await loader.list();
    for (const name of required) {
      assert.ok(available.includes(name), `missing prompt ${name}`);
    }
  });

  test('no prompt text is embedded in TypeScript sources', async () => {
    // The prompts directory is the source of truth; a prompt string in src/
    // would silently override a reviewed prompt file.
    const { execSync } = await import('node:child_process');
    const hits = execSync(
      'node -e "const fs=require(\'fs\'),p=require(\'path\');' +
        'const bad=[];const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){' +
        'const f=p.join(d,e.name);if(e.isDirectory())walk(f);' +
        'else if(f.endsWith(\'.ts\')){const t=fs.readFileSync(f,\'utf8\');' +
        'if(/You are (a|an) [a-z]/.test(t))bad.push(f);}}};walk(\'src\');' +
        'console.log(bad.join(\',\'))"',
      { cwd: ROOT, encoding: 'utf-8' }
    ).trim();
    assert.equal(hits, '', `prompt-like text found in: ${hits}`);
  });

  test('the harness supplies every variable every prompt asks for', async () => {
    // Prompts are edited without touching TypeScript, so a renamed placeholder
    // would otherwise render as an empty section and quietly degrade reasoning.
    const { buildContext } = await import('../src/agents/context');
    const { createState } = await import('../src/exploration/ExplorationState');
    const context = buildContext(createState('run', 'shop'), {
      limits: { maxDepth: 10, maxNodes: 1000, maxIterations: 25 },
    });

    for (const name of await loader.list()) {
      if (name === 'system/correction') continue; // rendered by the LLM layer
      const rendered = await loader.render(name, context);
      assert.deepEqual(
        rendered.missingVariables,
        [],
        `${name} references variables the harness does not supply`
      );
    }
  });

  test('carries name, version and hash for the execution trace', async () => {
    const prompt = await loader.load('exploration/depth-decision');
    assert.equal(prompt.name, 'exploration/depth-decision');
    assert.equal(prompt.version, 'v1');
    assert.match(prompt.hash, /^[0-9a-f]{16}$/);
  });

  test('renders template variables', async () => {
    const rendered = await loader.render('system/correction', {
      SCHEMA_NAME: 'DepthDecision',
      VALIDATION_ERRORS: 'decision: Required',
      PREVIOUS_OUTPUT: 'oops',
      ORIGINAL_TASK: 'decide',
    });
    assert.match(rendered.rendered, /DepthDecision/);
    assert.match(rendered.rendered, /decision: Required/);
    assert.ok(!rendered.rendered.includes('{{'), 'no placeholder should survive');
    assert.deepEqual(rendered.missingVariables, []);
  });

  test('reports variables the caller forgot instead of leaving them literal', async () => {
    const rendered = await loader.render('system/correction', {
      SCHEMA_NAME: 'X',
    });
    assert.ok(rendered.missingVariables.includes('VALIDATION_ERRORS'));
    assert.ok(!rendered.rendered.includes('{{VALIDATION_ERRORS}}'));
  });

  test('rejects a prompt name that escapes the prompt root', async () => {
    await assert.rejects(loader.load('../../etc/passwd'), /Illegal prompt name/);
  });

  test('a missing prompt names the directory to check', async () => {
    await assert.rejects(loader.load('ontology/nope'), /PROMPTS_DIR and PROMPT_VERSION/);
  });

  test('an unknown prompt version fails rather than falling back', async () => {
    const other = new PromptLoader({ dir: path.join(ROOT, 'prompts'), version: 'v99' });
    await assert.rejects(other.load('system/base'), /not found/);
  });
});
