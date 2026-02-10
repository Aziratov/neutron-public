import { readdirSync, readFileSync, writeFileSync, unlinkSync, statSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';
import { log } from './index.js';

const BRAIN_DIR = config.paths.brain;

/**
 * Get all brain files with metadata.
 */
function getBrainFiles(): { name: string; size: number; mtime: Date }[] {
  if (!existsSync(BRAIN_DIR)) return [];
  return readdirSync(BRAIN_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const stat = statSync(join(BRAIN_DIR, f));
      return { name: f, size: stat.size, mtime: stat.mtime };
    })
    .sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
}

/**
 * Consolidate old daily files (morning briefs, EOD recaps, scans) into weekly summaries.
 * Keeps files from the current week, consolidates older ones.
 */
export function consolidateOldFiles(): { consolidated: number; deleted: number } {
  const files = getBrainFiles();
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  let consolidated = 0;
  let deleted = 0;

  // Group old daily files by week
  const weeklyGroups: Record<string, { name: string; content: string }[]> = {};
  const dailyPatterns = ['morning-brief-', 'eod-recap-', 'scan-'];

  for (const file of files) {
    // Only consolidate daily files older than a week
    if (file.mtime >= oneWeekAgo) continue;

    const isDaily = dailyPatterns.some(p => file.name.startsWith(p));
    if (!isDaily) continue;

    // Extract date and compute week key
    const dateMatch = file.name.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;

    const fileDate = new Date(dateMatch[1]);
    const weekStart = new Date(fileDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // Monday
    const weekKey = weekStart.toISOString().split('T')[0];

    if (!weeklyGroups[weekKey]) weeklyGroups[weekKey] = [];

    try {
      const content = readFileSync(join(BRAIN_DIR, file.name), 'utf-8');
      weeklyGroups[weekKey].push({ name: file.name, content });
    } catch { /* skip */ }
  }

  // Write consolidated weekly files and delete originals
  for (const [weekKey, entries] of Object.entries(weeklyGroups)) {
    if (entries.length < 2) continue; // Not worth consolidating 1 file

    const summaryName = `weekly-summary-${weekKey}.md`;
    const summaryPath = join(BRAIN_DIR, summaryName);

    // Don't overwrite existing summaries
    if (existsSync(summaryPath)) continue;

    const summary = [
      `# Weekly Summary — Week of ${weekKey}`,
      `*Consolidated from ${entries.length} daily files*\n`,
      ...entries.map(e => `---\n### ${e.name}\n${e.content.slice(0, 500)}`),
    ].join('\n\n');

    writeFileSync(summaryPath, summary, 'utf-8');
    consolidated++;

    // Delete original files
    for (const entry of entries) {
      try {
        unlinkSync(join(BRAIN_DIR, entry.name));
        deleted++;
      } catch { /* skip */ }
    }
  }

  if (consolidated > 0 || deleted > 0) {
    log(`[brain] Consolidated ${consolidated} weekly summaries, removed ${deleted} old daily files`);
  }

  return { consolidated, deleted };
}

/**
 * Clean up old analysis and sentiment files (keep last 30 days).
 */
export function pruneOldAnalyses(): number {
  const files = getBrainFiles();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  let pruned = 0;

  const analysisPatterns = ['analysis-', 'options-', 'sentiment-'];

  for (const file of files) {
    if (file.mtime >= thirtyDaysAgo) continue;
    const isAnalysis = analysisPatterns.some(p => file.name.startsWith(p));
    if (!isAnalysis) continue;

    try {
      unlinkSync(join(BRAIN_DIR, file.name));
      pruned++;
    } catch { /* skip */ }
  }

  if (pruned > 0) {
    log(`[brain] Pruned ${pruned} analysis files older than 30 days`);
  }

  return pruned;
}

/**
 * Get brain stats for logging / monitoring.
 */
export function getBrainStats(): { totalFiles: number; totalSize: number; oldestFile: string; newestFile: string } {
  const files = getBrainFiles();
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  return {
    totalFiles: files.length,
    totalSize,
    oldestFile: files[0]?.name || 'none',
    newestFile: files[files.length - 1]?.name || 'none',
  };
}

/**
 * Run all brain maintenance tasks.
 */
export function runBrainMaintenance(): void {
  log('[brain] Running maintenance...');
  consolidateOldFiles();
  pruneOldAnalyses();
  const stats = getBrainStats();
  log(`[brain] Maintenance complete — ${stats.totalFiles} files, ${(stats.totalSize / 1024).toFixed(0)}KB total`);
}
