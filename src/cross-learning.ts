import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { loadPerformance } from './performance.js';
import { loadProfile } from './investor.js';
import { getBrainStats } from './brain-manager.js';
import { getWatchlistTickers } from './watchlist.js';
import { log } from './index.js';

// Shared location where Jarvis can read Neutron's summaries
const SHARED_DIR = '/home/mo/trading-bot/data/shared';

/**
 * Write a weekly summary that Jarvis can read.
 * One-way: Neutron writes, Jarvis reads. Jarvis never writes here.
 */
export function exportWeeklySummary(): void {
  try {
    if (!existsSync(SHARED_DIR)) mkdirSync(SHARED_DIR, { recursive: true });

    const perf = loadPerformance();
    const profile = loadProfile();
    const brain = getBrainStats();
    const watchlist = getWatchlistTickers();

    const reviewed = perf.recommendations.filter(r => r.outcome && r.outcome !== 'pending');
    const correct = reviewed.filter(r => r.outcome === 'correct').length;
    const wrong = reviewed.filter(r => r.outcome === 'wrong').length;
    const accuracy = reviewed.length > 0
      ? ((correct / reviewed.length) * 100).toFixed(0)
      : 'N/A';

    const recentWeek = perf.weeklyScores.slice(-1)[0];

    const summary = [
      `# Neutron Weekly Summary`,
      `*Generated: ${new Date().toISOString()}*`,
      `*For Jarvis — read-only, do not modify*\n`,

      `## Investor: ${profile.username}`,
      `- Trading style: ${profile.tradingStyle.join(', ') || 'still learning'}`,
      `- Preferred sectors: ${profile.preferredSectors.join(', ') || 'still learning'}`,
      `- Watchlist: ${watchlist.join(', ') || 'empty'}`,
      `- Total trades tracked: ${profile.stats.totalTrades}`,
      `- Win/Loss: ${profile.stats.wins}W / ${profile.stats.losses}L\n`,

      `## Neutron Performance`,
      `- Total recommendations reviewed: ${reviewed.length}`,
      `- Overall accuracy: ${accuracy}%`,
      `- Correct: ${correct} | Wrong: ${wrong} | Partial: ${reviewed.filter(r => r.outcome === 'partial').length}`,
      recentWeek ? `- Last week (${recentWeek.weekOf}): ${recentWeek.accuracy}% accuracy` : '',
      recentWeek?.lesson ? `- Key lesson: ${recentWeek.lesson}` : '',
      '',

      `## Brain Stats`,
      `- Files: ${brain.totalFiles}`,
      `- Total size: ${(brain.totalSize / 1024).toFixed(0)}KB`,
      `- Newest: ${brain.newestFile}`,
      '',

      `## Self-Improvement Notes`,
      ...(perf.strategyNotes.slice(-5).map(n => `- ${n}`)),
      '',

      `## Recent Recommendations (last 10)`,
      ...perf.recommendations.slice(-10).map(r => {
        const outcome = r.outcome ? ` [${r.outcome}]` : ' [pending]';
        return `- ${r.date}: ${r.direction} ${r.ticker} (${r.confidence}%)${outcome} — ${r.summary.slice(0, 80)}`;
      }),
    ].filter(Boolean).join('\n');

    writeFileSync(`${SHARED_DIR}/neutron-weekly.md`, summary, 'utf-8');
    log('[cross-learning] Exported weekly summary for Jarvis');
  } catch (err) {
    log(`[cross-learning] Failed to export summary: ${err}`);
  }
}
