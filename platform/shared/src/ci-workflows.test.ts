import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const WORKFLOWS_DIR = resolve(import.meta.dirname, '../../../.github/workflows');

/**
 * Simple YAML key extractor for GitHub Actions workflows.
 * Finds top-level keys (lines starting at column 0 with `key:`)
 * and second-level keys (lines starting with exactly 2 spaces).
 */
function extractTopLevelKeys(content: string): Set<string> {
  const keys = new Set<string>();
  for (const line of content.split('\n')) {
    const match = line.match(/^(\w[\w\s—-]*):/);
    if (match?.[1]) keys.add(match[1].trim());
  }
  return keys;
}

function extractJobNames(content: string): string[] {
  const names: string[] = [];
  const jobsIndex = content.indexOf('\njobs:');
  if (jobsIndex === -1) return names;

  const afterJobs = content.slice(jobsIndex + '\njobs:'.length);
  for (const line of afterJobs.split('\n')) {
    // Job names are indented by exactly 2 spaces
    const match = line.match(/^ {2}(\w[\w-]*):/);
    if (match?.[1]) names.push(match[1]);
  }
  return names;
}

function extractJobContent(content: string, jobName: string): string {
  const pattern = new RegExp(`^  ${jobName}:`, 'm');
  const match = pattern.exec(content);
  if (!match) return '';

  const start = match.index;
  const afterStart = content.slice(start + match[0].length);

  // Find the next job (another 2-space-indented key) or end of file
  const nextJob = afterStart.search(/^\n {2}\w/m);
  return nextJob === -1 ? afterStart : afterStart.slice(0, nextJob);
}

describe('GitHub Actions workflow YAML validity', () => {
  let workflowFiles: string[];

  test('workflow directory exists and contains .yml files', async () => {
    const entries = await readdir(WORKFLOWS_DIR);
    workflowFiles = entries.filter(f => f.endsWith('.yml'));
    expect(workflowFiles.length).toBeGreaterThan(0);
  });

  test('each workflow file is non-empty and has required top-level fields', async () => {
    const entries = await readdir(WORKFLOWS_DIR);
    const ymlFiles = entries.filter(f => f.endsWith('.yml'));

    for (const file of ymlFiles) {
      const content = await readFile(join(WORKFLOWS_DIR, file), 'utf-8');
      expect(content.length, `${file} should not be empty`).toBeGreaterThan(0);

      const keys = extractTopLevelKeys(content);
      expect(keys.has('name'), `${file} missing 'name' field`).toBe(true);
      expect(keys.has('on'), `${file} missing 'on' field`).toBe(true);
      expect(keys.has('jobs'), `${file} missing 'jobs' field`).toBe(true);
    }
  });

  test('each job has runs-on and steps', async () => {
    const entries = await readdir(WORKFLOWS_DIR);
    const ymlFiles = entries.filter(f => f.endsWith('.yml'));

    for (const file of ymlFiles) {
      const content = await readFile(join(WORKFLOWS_DIR, file), 'utf-8');
      const jobNames = extractJobNames(content);
      expect(jobNames.length, `${file} should have at least one job`).toBeGreaterThan(0);

      for (const job of jobNames) {
        const jobContent = extractJobContent(content, job);
        expect(jobContent, `${file}: job '${job}' has no content`).toBeTruthy();
        expect(jobContent.includes('runs-on:'), `${file}: job '${job}' missing 'runs-on'`).toBe(true);
        expect(jobContent.includes('steps:'), `${file}: job '${job}' missing 'steps'`).toBe(true);
      }
    }
  });

  test('CI workflow has expected jobs', async () => {
    const content = await readFile(join(WORKFLOWS_DIR, 'ci.yml'), 'utf-8');
    const jobNames = extractJobNames(content);
    expect(jobNames).toContain('check');
    expect(jobNames).toContain('e2e');
    expect(jobNames).toContain('plugins');
  });

  test('CI docs workflow has expected structure', async () => {
    const content = await readFile(join(WORKFLOWS_DIR, 'ci-docs.yml'), 'utf-8');
    const jobNames = extractJobNames(content);
    expect(jobNames).toContain('check');
    expect(content).toContain('docs/**');
  });
});
