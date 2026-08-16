// Maps a room's current status (+ gameMode where the phase mechanically
// differs) to the gm.readAloudPhase* locale key describing what's happening
// right now / what happens next. Shared by GMDashboard.jsx's read-aloud
// toolbar popup, Modal.jsx's HowToPlayModal phase block, and
// PlayerScreen.jsx's opt-in auto-explain popup, so there's exactly one
// mapping to keep in sync as phases change instead of three that can drift.
//
// 'paired' and 'role_reveal' share one body - both are the brief "roles are
// being handed out, dancing is about to start" moment, too short-lived to
// need separate texts. 'lobby' (and anything unrecognized) returns null:
// GMDashboard's popup falls back to the mode overview there instead (see
// buildReadAloudText), and the other two surfaces simply render no phase
// block while still in lobby.
export function phaseBodyKeyFor(status, gameMode) {
  switch (status) {
    case 'paired':
    case 'role_reveal':
      return 'gm.readAloudPhaseRoleRevealBody';
    case 'dancing':
      return gameMode === 'maxkills' ? 'gm.readAloudPhaseDancingMaxKillsBody' : 'gm.readAloudPhaseDancingBody';
    case 'silent_report':
      return 'gm.readAloudPhaseSilentReportBody';
    case 'kill_reveal':
      return gameMode === 'maxkills' ? 'gm.readAloudPhaseKillRevealMaxKillsBody' : 'gm.readAloudPhaseKillRevealBody';
    case 'voting':
      return 'gm.readAloudPhaseVotingBody';
    case 'vote_reveal':
      return 'gm.readAloudPhaseVoteRevealBody';
    case 'ended':
      return 'gm.readAloudPhaseEndedBody';
    default:
      return null;
  }
}

// GM-only counterpart: what the GM personally needs to do / watch for in
// the current phase, as opposed to phaseBodyKeyFor's group narration for
// reading aloud to players. Used only by GMDashboard.jsx's opt-in auto-
// popup (gm.explanationsEnable) - the read-aloud popup and the (?) icon
// both keep using phaseBodyKeyFor above, unaffected by this one.
// killMode matters here (unlike phaseBodyKeyFor): during 'dancing', a
// classic-mode GM has to actively watch the floor and mark the kill
// themselves, while a silent-mode GM does nothing until the report phase -
// different enough to need separate copy, not just a shared narration line.
export function gmExplainPhaseBodyKeyFor(status, gameMode, killMode) {
  const silent = killMode === 'silent';
  switch (status) {
    case 'paired':
    case 'role_reveal':
      return 'gm.explainPhaseRoleRevealBody';
    case 'dancing':
      if (gameMode === 'maxkills') {
        return silent ? 'gm.explainPhaseDancingMaxKillsSilentBody' : 'gm.explainPhaseDancingMaxKillsClassicBody';
      }
      return silent ? 'gm.explainPhaseDancingSilentBody' : 'gm.explainPhaseDancingClassicBody';
    case 'silent_report':
      return 'gm.explainPhaseSilentReportBody';
    case 'kill_reveal':
      return gameMode === 'maxkills' ? 'gm.explainPhaseKillRevealMaxKillsBody' : 'gm.explainPhaseKillRevealBody';
    case 'voting':
      return 'gm.explainPhaseVotingBody';
    case 'vote_reveal':
      return 'gm.explainPhaseVoteRevealBody';
    case 'ended':
      return 'gm.explainPhaseEndedBody';
    default:
      return null;
  }
}
