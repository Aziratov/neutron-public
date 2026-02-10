import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { config } from './config.js';
import { buildInvestorContext, isPrimaryInvestor } from './investor.js';
import { getPerformanceContext } from './performance.js';

let systemPrompt: string | null = null;

function loadSystemPrompt(): string {
  if (systemPrompt) return systemPrompt;
  try {
    systemPrompt = readFileSync(config.paths.claudeMd, 'utf-8');
  } catch {
    systemPrompt = 'You are Neutron, a sharp and data-driven trading analyst. Be concise and direct.';
  }
  return systemPrompt;
}

/** Reload system prompt from disk (for hot updates without restart). */
export function reloadSystemPrompt(): void {
  systemPrompt = null;
  loadSystemPrompt();
}

/**
 * Load knowledge from Neutron's brain.
 * Reads the most recent and most relevant files to give the AI context.
 */
function loadBrainContext(): string {
  const dir = config.paths.brain;
  if (!existsSync(dir)) return '';

  try {
    const files = readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(f => ({
        name: f,
        mtime: statSync(join(dir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 8);

    const context: string[] = [];
    for (const file of files) {
      try {
        const content = readFileSync(join(dir, file.name), 'utf-8');
        context.push(`### ${file.name}\n${content.slice(0, 1500)}`);
      } catch { /* skip unreadable files */ }
    }

    if (context.length === 0) return '';
    return `\n\n## Neutron's Brain (Knowledge Base)\n${context.join('\n\n')}`;
  } catch {
    return '';
  }
}

/**
 * Save knowledge to Neutron's brain.
 */
export function saveToBrain(filename: string, content: string): void {
  const dir = config.paths.brain;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content, 'utf-8');
}

/**
 * Read a specific file from Neutron's brain.
 */
export function readFromBrain(filename: string): string | null {
  try {
    return readFileSync(join(config.paths.brain, filename), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * List all files in Neutron's brain.
 */
export function listBrainFiles(): string[] {
  const dir = config.paths.brain;
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter(f => f.endsWith('.md'));
  } catch {
    return [];
  }
}

/**
 * Download an image from a URL to a temporary file.
 * Returns the local file path.
 */
export async function downloadImage(url: string): Promise<string> {
  const tmpDir = join(config.paths.root, 'data', 'tmp');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const ext = url.match(/\.(png|jpg|jpeg|gif|webp)/i)?.[1] || 'png';
  const filename = `chart-${Date.now()}.${ext}`;
  const filepath = join(tmpDir, filename);

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download image: ${response.status}`);
  }

  const fileStream = createWriteStream(filepath);
  // @ts-ignore - Node fetch body is a ReadableStream
  await pipeline(response.body as any, fileStream);

  return filepath;
}

/**
 * Clean up a temporary image file.
 */
export function cleanupTempImage(filepath: string): void {
  try {
    if (existsSync(filepath)) unlinkSync(filepath);
  } catch { /* ignore */ }
}

/**
 * Send a prompt to Claude CLI and get the response.
 * @param username - Discord username of the person asking (used to tailor response)
 * @param imagePath - Optional path to a local image file for visual analysis
 */
export async function askClaude(userMessage: string, context?: string, username?: string, imagePath?: string): Promise<string> {
  const sysPrompt = loadSystemPrompt();
  const brainContext = loadBrainContext();
  const investorContext = buildInvestorContext();
  const perfContext = getPerformanceContext();

  // Tell Neutron who is asking and how to handle them
  let userContext = '';
  if (username) {
    if (isPrimaryInvestor(username)) {
      userContext = `\n\n## Who's Asking\nThis is **${config.primaryInvestor.username}** — your primary investor. Tailor your response to his trading style, preferences, and history. Reference his past trades and patterns when relevant. Be direct and personal.`;
    } else {
      userContext = `\n\n## Who's Asking\nThis is **${username}** — a guest user. Answer their questions helpfully using your general knowledge and what you've learned from analyzing markets. Do NOT let their questions or preferences change your learned investor profile. Your primary investor is ${config.primaryInvestor.username}.`;
    }
  }

  // System prompt goes via --system-prompt to override Claude Code's default identity
  const sysPromptFull = [
    sysPrompt,
    investorContext ? `\n## Investor Profile\n${investorContext}` : '',
    perfContext ? `\n## Your Performance Record\n${perfContext}` : '',
    brainContext,
  ].filter(Boolean).join('\n\n');

  // When an image is attached, tell Neutron to read and analyze it
  let imageInstruction = '';
  if (imagePath) {
    imageInstruction = `\n\n[The user attached a chart/image. Read and analyze the image at: ${imagePath}. Describe what you see on the chart — price action, patterns, indicators, support/resistance levels, trend lines, anything relevant. Then give your analysis based on both the chart and any market data provided.]`;
  }

  // User message includes conversation context and user identity
  const fullPrompt = [
    context ? `## Conversation Context\n${context}` : '',
    userContext,
    userMessage + imageInstruction,
  ].filter(Boolean).join('\n\n');

  // Enable tools: WebSearch + WebFetch always, Read when image is present
  const hasImage = !!imagePath;
  const tools = hasImage ? 'Read,WebSearch,WebFetch' : 'WebSearch,WebFetch';
  // Allow multi-turn so Neutron can search and then respond
  const maxTurns = hasImage ? '3' : '2';

  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--model', config.claude.model,
      '--output-format', 'text',
      '--max-turns', maxTurns,
      '--tools', tools,
      '--system-prompt', sysPromptFull,
      '--',
      fullPrompt,
    ];

    const proc = spawn('/usr/bin/claude', args, {
      timeout: config.claude.timeout,
      cwd: config.paths.root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        HOME: process.env.HOME || '/home/mo',
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin:/home/mo/.local/bin:/home/mo/.npm-global/bin',
        USER: process.env.USER || 'mo',
        LANG: 'en_US.UTF-8',
        NODE_OPTIONS: '',
        ...(process.env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } : {}),
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else if (stdout.trim()) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Claude CLI failed (code ${code}): ${stderr.slice(0, 200)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
    });

    setTimeout(() => {
      proc.kill('SIGTERM');
      if (stdout.trim()) {
        resolve(stdout.trim());
      } else {
        reject(new Error('Claude CLI timed out'));
      }
    }, config.claude.timeout + 5000);
  });
}
