// Turns Max Kills' final [{ coupleId, kills }] (already sorted by kills
// descending - see server/gameStore.js's maxKillsFinalRanking) into display
// entries carrying a `rankLabel` that accounts for ties, instead of the
// couple's plain array position. Shared by GMDashboard.jsx's and
// PlayerScreen.jsx's final-ranking screens so there's one place to keep the
// tie rule in sync instead of two that can drift.
//
// Couples tied on kills always share one rank (the count of couples
// strictly ahead of the group, +1 - "1224" scoring: 1st, 2nd tied, 2nd tied,
// 4th, never "1223" or "1233"). How that shared rank displays depends on how
// many are tied: exactly two couples just repeat the single number ("#2" for
// both - a "#2-#3" range would only restate what "two couples share #2"
// already says), three or more show the full span they occupy ("#2-#4") so
// the size of the tie is visible at a glance instead of reading as a
// deceptively clean single placement.
export function buildMaxKillsRanks(ranking) {
  const groups = [];
  for (const entry of ranking) {
    const last = groups[groups.length - 1];
    if (last && last.kills === entry.kills) {
      last.entries.push(entry);
    } else {
      const startRank = groups.reduce((sum, g) => sum + g.entries.length, 0) + 1;
      groups.push({ kills: entry.kills, entries: [entry], startRank });
    }
  }
  return groups.flatMap(({ entries, startRank }) => {
    const endRank = startRank + entries.length - 1;
    const rankLabel = entries.length >= 3 ? `#${startRank}-#${endRank}` : `#${startRank}`;
    return entries.map(entry => ({ ...entry, rankLabel }));
  });
}
