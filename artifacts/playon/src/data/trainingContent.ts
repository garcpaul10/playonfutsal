export interface RuleCard {
  id: string;
  title: string;
  body: string;
  playonNote?: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface TrainingSection {
  id: number;
  title: string;
  subtitle: string;
  requiredFor: ("ref" | "scorekeeper")[];
  cards: RuleCard[];
  questions: QuizQuestion[];
}

export const TRAINING_SECTIONS: TrainingSection[] = [
  {
    id: 1,
    title: "Futsal Rules",
    subtitle: "Official rules of futsal as PlayOn runs them",
    requiredFor: ["ref", "scorekeeper"],
    cards: [
      {
        id: "1-1",
        title: "Rolling Clock — No Stoppages",
        body: "Futsal uses a running clock that counts down continuously throughout each half. The clock does NOT stop for kick-ins, substitutions, goal kicks, corner kicks, or free kicks. Only the referee may pause the clock for a serious injury or major incident.",
        playonNote: "PlayOn uses a rolling clock for all futsal games. This departs from strict FIFA rules (which allow timekeeper stoppages) but matches how virtually all US recreational and tournament futsal is actually run.",
      },
      {
        id: "1-2",
        title: "Kick-ins Replace Throw-ins",
        body: "When the ball crosses the touchline, play is restarted with a kick-in — not a throw-in. The ball is placed on or behind the touchline and kicked back into play. Opponents must be at least 5 metres from the ball. The goalkeeper may receive a kick-in directly.",
        playonNote: "Always record restarts as kick-ins, not throw-ins. There are no throw-ins in futsal.",
      },
      {
        id: "1-3",
        title: "No Offside Rule",
        body: "There is no offside rule in futsal. Players may position themselves anywhere on the pitch at any time. This is one of the most important differences from 11v11 soccer.",
        playonNote: "No offside tracking is needed in PlayOn for futsal.",
      },
      {
        id: "1-4",
        title: "Accumulated Fouls (AF)",
        body: "Accumulated fouls are counted per team per half. Starting from the 6th accumulated foul in a half, a direct free kick is taken from the second penalty spot with no defensive wall allowed. This applies to every foul from the 6th onward. Accumulated foul counts reset to zero at halftime.",
        playonNote: "Scorekeepers must track accumulated fouls per team and reset the counter at halftime. At 6+ accumulated fouls, the scorecard must indicate the 2nd-penalty-spot rule is active.",
      },
      {
        id: "1-5",
        title: "Goalkeeper — 4-Second Rule & Back-Pass",
        body: "The goalkeeper may not hold the ball for more than 4 seconds in their own half. After distributing the ball, the goalkeeper may not receive it back directly from a deliberate kick by a teammate (back-pass rule). Violation of either results in an indirect free kick for the opposing team. The GK must wear a different-color jersey from all other players.",
        playonNote: "Refs should track the 4-second count. The back-pass applies only to deliberate kicks — headers and deflections are allowed.",
      },
      {
        id: "1-6",
        title: "Flying Substitutions",
        body: "Substitutions in futsal are flying (on-the-fly): they may happen during live play. Outgoing and incoming players must use the designated substitution zone on the touchline. A substitution does not stop the clock.",
        playonNote: "The rolling clock does not pause for substitutions. A sent-off substitute may not be replaced. A sent-off field player may be replaced after 2 minutes of playing time, or when a goal is scored.",
      },
      {
        id: "1-7",
        title: "Cards & Suspensions",
        body: "Yellow card: caution. Two yellow cards in the same match result in a red card. Red card: the player is ejected and their team plays short-handed for 2 minutes of playing time (or until a goal is scored, whichever comes first). After 2 minutes the team may add a replacement player.",
        playonNote: "Yellow cards are per-match only in futsal. Red card suspensions extend to the next game as determined by competition rules.",
      },
      {
        id: "1-8",
        title: "Slide Tackles — Prohibited",
        body: "Slide tackles are strictly prohibited in futsal. A player who slide-tackles receives a direct free kick against their team regardless of whether they touch the ball. Reckless challenges earn a yellow card; excessive force earns a red card.",
      },
      {
        id: "1-9",
        title: "Game Duration & Timeouts",
        body: "Youth futsal games typically consist of two equal halves (commonly 20 minutes each for U13+). Each team is entitled to one 1-minute timeout per half. Timeouts may not be called in the final 2 minutes of the second half. Halftime is typically 10–15 minutes.",
        playonNote: "Only the team in possession may call a timeout (some competition rules vary). Timeout usage is tracked per team per half.",
      },
      {
        id: "1-10",
        title: "Scoring & Tiebreakers",
        body: "Pool play: Win = 3 pts, Draw = 1 pt, Loss = 0 pts. Forfeit = 5–0 score. Tiebreakers (in order): total points → goal difference → goals scored → head-to-head result → penalty shootout.",
      },
    ],
    questions: [
      {
        id: "1-q1",
        question: "The clock is running and the ball rolls out of bounds on the touchline. What happens to the clock?",
        options: [
          "The clock stops until the kick-in is taken",
          "The clock continues running — there are no stoppages for kick-ins",
          "The timekeeper pauses the clock for 10 seconds",
          "The clock stops only if the referee signals",
        ],
        correctIndex: 1,
        explanation: "PlayOn uses a rolling clock. The clock never stops for kick-ins, substitutions, or any dead ball situation. Only the referee may pause it for a serious injury.",
      },
      {
        id: "1-q2",
        question: "A team has committed 6 accumulated fouls in the first half. Where is the free kick taken on the 7th foul?",
        options: [
          "From the spot of the foul with a normal defensive wall",
          "From the first penalty spot with no wall",
          "From the second penalty spot with no wall",
          "A penalty kick from the centre of the penalty area",
        ],
        correctIndex: 2,
        explanation: "From the 6th accumulated foul onward, all direct free kicks are taken from the second penalty spot with no defensive wall allowed.",
      },
      {
        id: "1-q3",
        question: "A player receives a red card. When can the team return to full strength?",
        options: [
          "Immediately — the team stays at full strength",
          "After 2 minutes of playing time or when the opposing team scores, whichever is first",
          "At halftime",
          "After 5 minutes",
        ],
        correctIndex: 1,
        explanation: "After a red card the team plays short for 2 minutes of playing time. If the opposing team scores before 2 minutes are up, the team may immediately add a replacement player.",
      },
      {
        id: "1-q4",
        question: "Is there an offside rule in futsal?",
        options: [
          "Yes, the standard offside rule applies",
          "Yes, but only in the attacking half",
          "No — there is no offside in futsal",
          "Only in the final 5 minutes",
        ],
        correctIndex: 2,
        explanation: "There is no offside rule in futsal. Players may position themselves anywhere on the pitch at any time.",
      },
      {
        id: "1-q5",
        question: "The goalkeeper holds the ball in their own half for 5 seconds. What is the correct restart?",
        options: [
          "Direct free kick for the opposing team",
          "Indirect free kick for the opposing team",
          "Penalty kick for the opposing team",
          "Drop ball",
        ],
        correctIndex: 1,
        explanation: "Violating the 4-second rule is restarted with an indirect free kick for the opposing team, taken from the spot of the infringement.",
      },
      {
        id: "1-q6",
        question: "An accumulated foul counter reads 5 at halftime. What is the count at the start of the second half?",
        options: [
          "5 — it carries over",
          "3 — it's reduced by half",
          "0 — the counter resets each half",
          "1 — the counter resets to 1",
        ],
        correctIndex: 2,
        explanation: "Accumulated foul counts reset to zero at halftime for both teams. The 6th-foul rule applies independently in each half.",
      },
    ],
  },

  {
    id: 2,
    title: "3v3 Rules",
    subtitle: "How PlayOn runs 3v3 youth tournaments",
    requiredFor: ["ref", "scorekeeper"],
    cards: [
      {
        id: "2-1",
        title: "Rolling Clock — Always Running",
        body: "3v3 games use a continuous (rolling) clock that never stops. The clock does NOT stop for kick-ins, substitutions, goal kicks, corner kicks, free kicks, or goals. There are no timeouts in 3v3.",
        playonNote: "This is standard for 3v3 across the US and is consistent with how PlayOn runs all its formats.",
      },
      {
        id: "2-2",
        title: "No Goalkeeper",
        body: "There are no goalkeepers in 3v3. All 3 field players are equal — any player may defend the goal. Teams play 3 players vs. 3 players at all times. The minimum to start a game is 2 players per side.",
        playonNote: "PlayOn's roster builder does not require or track a GK position for 3v3 teams.",
      },
      {
        id: "2-3",
        title: "No Offside Rule",
        body: "Like futsal, there is no offside rule in 3v3. Players may position themselves anywhere on the field at any time.",
      },
      {
        id: "2-4",
        title: "Goal Box Violations",
        body: "Each goal has a goal box (8 ft wide × 4 ft deep) directly in front of it. No player may touch the ball while inside the goal box. If a defender touches the ball inside their own goal box → goal is awarded to the attacking team. If an attacker touches the ball inside the opposing goal box → goal kick for the defenders. If the ball comes to rest in the goal box → goal kick for the defenders.",
        playonNote: "Goal box violations are a major scoring mechanism in 3v3. Scorekeepers must be ready to record awarded goals resulting from defensive goal-box infractions.",
      },
      {
        id: "2-5",
        title: "Kick-ins Replace Throw-ins",
        body: "When the ball crosses the touchline, play is restarted with a kick-in from the sideline — not a throw-in. All defending players must be at least 5 yards away. All dead-ball kicks in 3v3 are indirect (the kicker may not score directly) except corner kicks and penalty kicks.",
      },
      {
        id: "2-6",
        title: "Mercy Rule",
        body: "A game ends immediately if one team builds a 10-goal lead at any point. Additionally, if a team leads by 7 or more goals at the 15-minute mark of a 20-minute game, the game ends immediately.",
        playonNote: "PlayOn checks goal differential after every goal and at the 15-minute mark. The system triggers an immediate game end when these thresholds are reached.",
      },
      {
        id: "2-7",
        title: "Substitutions",
        body: "Substitutions may happen at any dead ball stoppage. Players must enter and exit at the half-field mark only. The substitute must be at the half-field mark when the dead ball occurs. Some events allow on-the-fly substitutions during live play — check the tournament rules.",
      },
      {
        id: "2-8",
        title: "Slide Tackles — Prohibited",
        body: "Slide tackles are not allowed at any time in 3v3. A player who slide-tackles receives a direct free kick against their team regardless of ball contact.",
      },
      {
        id: "2-9",
        title: "Cards & Card Accumulation",
        body: "Yellow card: caution. 3 yellow cards accumulated across games in a single tournament = suspended for the next game. Red card: player is ejected and suspended for the rest of the game plus the next game. When a field player receives a red card, the team plays the entire game (not just 2 minutes) a player short. Fighting results in ejection from the entire tournament.",
        playonNote: "Unlike futsal (where cards are per match), in 3v3 yellow cards accumulate across all games in the event. PlayOn auto-flags a player when they reach 3 yellows in a tournament.",
      },
      {
        id: "2-10",
        title: "Overtime & Tiebreakers",
        body: "Pool play: games can end in a draw — no overtime. Playoffs: games cannot end tied. Overtime is played as a 2-minute Golden Goal period with teams reduced to 2v2. If still tied after Golden Goal, each team removes another player and plays 1v1 until a goal is scored. Some tournaments instead use 3 penalty kicks per team — confirm with the tournament director.",
        playonNote: "PlayOn's bracket engine supports the 2v2 → 1v1 OT ladder for playoff games.",
      },
      {
        id: "2-11",
        title: "Forfeit Rules",
        body: "Teams have 5 minutes from the scheduled game time before a forfeit is issued. The forfeit score is 5–0. Three forfeits during pool play may result in removal from the tournament. One forfeit during playoffs may result in removal.",
        playonNote: "PlayOn shows a 5-minute countdown from scheduled kickoff before prompting the referee to issue a forfeit.",
      },
    ],
    questions: [
      {
        id: "2-q1",
        question: "A player scores a goal directly from a kick-in (not a corner kick or PK). Does the goal count?",
        options: [
          "Yes — all goals count regardless of restart type",
          "No — kick-ins are indirect, so the ball must touch another player first",
          "Only if the referee signals it valid",
          "Yes, but only if the kicker is in their own half",
        ],
        correctIndex: 1,
        explanation: "All dead-ball kicks in 3v3 (except corner kicks and penalty kicks) are indirect. The ball must touch another player before a goal can be scored from a kick-in.",
      },
      {
        id: "2-q2",
        question: "A defending player reaches into the goal box and deflects the ball out. What is the correct call?",
        options: [
          "Goal kick for the defenders",
          "Direct free kick from the spot",
          "A goal is awarded to the attacking team",
          "Indirect free kick from the edge of the goal box",
        ],
        correctIndex: 2,
        explanation: "If a defender touches the ball while inside their own goal box, a goal is immediately awarded to the attacking team.",
      },
      {
        id: "2-q3",
        question: "The score is 8–1 at the 12-minute mark. Does the game end immediately?",
        options: [
          "Yes — a 7-goal lead ends the game immediately",
          "No — it's only 7 goals, and the 7-goal mercy only applies at the 15-minute mark",
          "Yes — any lead over 5 goals ends the game",
          "No — the game always plays to full time",
        ],
        correctIndex: 1,
        explanation: "The 10-goal mercy applies at any time. The 7-goal mercy only triggers at the 15-minute mark. At the 12-minute mark a 7-goal lead does not end the game.",
      },
      {
        id: "2-q4",
        question: "A player receives their 3rd yellow card across tournament games. What is the consequence?",
        options: [
          "Nothing until they get a 4th",
          "Automatic red card for this game",
          "Suspended for the next game",
          "Ejected from the tournament",
        ],
        correctIndex: 2,
        explanation: "In 3v3 yellow cards accumulate across games in the tournament. Three yellows results in suspension for the next game.",
      },
      {
        id: "2-q5",
        question: "A playoff game is tied after regulation. What happens first?",
        options: [
          "Penalty shootout (3 PKs per team)",
          "2-minute Golden Goal period played 2v2",
          "1v1 until a goal is scored",
          "The team with more yellow cards loses",
        ],
        correctIndex: 1,
        explanation: "The first OT step is a 2-minute Golden Goal period played 2v2. If still tied, each team reduces to 1v1 and plays until a goal is scored.",
      },
      {
        id: "2-q6",
        question: "How long does a team have before a forfeit is called?",
        options: [
          "No grace period — forfeit at kickoff time",
          "3 minutes",
          "5 minutes",
          "10 minutes",
        ],
        correctIndex: 2,
        explanation: "Teams have 5 minutes from the scheduled game time before a forfeit is issued. The forfeit score is 5–0.",
      },
    ],
  },

  {
    id: 3,
    title: "How PlayOn Works",
    subtitle: "Game card workflow for scorekeepers",
    requiredFor: ["scorekeeper"],
    cards: [
      {
        id: "3-1",
        title: "Your Role as Scorekeeper",
        body: "As a scorekeeper you are responsible for the game card from the moment both teams arrive until the referee signs off and the card is locked. Your job covers: opening the assigned card, checking in both teams, recording scores and goal scorers, tracking accumulated fouls (futsal), managing the halftime reset, and confirming the referee approval at the end.",
      },
      {
        id: "3-2",
        title: "Opening Your Assigned Card",
        body: "From your dashboard, tap 'Score & Fouls' on the game card for your assigned fixture. You can also navigate to My Games → select the fixture. The card opens in 'upcoming' status until you start the check-in process. You should arrive at the court 10–15 minutes before kickoff.",
      },
      {
        id: "3-3",
        title: "Checking In Both Teams",
        body: "Check-in confirms which players are present and eligible to play. You can check in players by: (1) scanning their profile QR code from the Check In Players button, or (2) tapping player names in the roster list to toggle them present. A player is not eligible until they are marked present. Roster is frozen at check-in.",
        playonNote: "Both teams must be checked in before the game can start. The game card will warn you if either roster has not been confirmed.",
      },
      {
        id: "3-4",
        title: "Entering Scores & Goal Scorers",
        body: "During the game, record each goal using the + button next to the scoring team's tally. You can optionally attach a goal scorer by selecting the player from the roster. Score entry is live — the score updates immediately for the referee and on any admin view. You can also subtract a goal if a score was entered in error.",
        playonNote: "Always enter goals in real time. Do not wait until the end of the game.",
      },
      {
        id: "3-5",
        title: "Tracking Accumulated Fouls (Futsal Only)",
        body: "For futsal games, you must track accumulated fouls per team per half. Tap the AF counter for the fouling team each time the referee signals an accumulated foul. At 6 accumulated fouls for a team, the game card will highlight that the 2nd-penalty-spot rule is now active for all subsequent direct free kicks by that team. Reset both counters at halftime.",
        playonNote: "Accumulated fouls do not carry over between halves. The scorecard automatically prompts you to reset AF counts when you trigger halftime.",
      },
      {
        id: "3-6",
        title: "Halftime",
        body: "When the referee signals halftime, tap the 'End Half' button on the game card. This freezes the first-half score, resets the accumulated foul counters (futsal), and starts the halftime period. When play is ready to resume, tap 'Start 2nd Half' to restart the clock. Do not start the second half without the referee's signal.",
      },
      {
        id: "3-7",
        title: "What the Ref Approval Step Means",
        body: "At the end of the game, you finalize the score and tap 'Submit for Ref Approval'. This sends the completed card to the referee for review. The referee checks the score, any disciplinary notes, and signs off digitally by approving the card. Only the referee — not the scorekeeper — can approve the final card.",
        playonNote: "You cannot edit the score after submitting for approval without the referee first rejecting and returning the card to you.",
      },
      {
        id: "3-8",
        title: "After Ref Sign-Off — Card Lock",
        body: "Once the referee approves the card, it is locked. A locked card cannot be edited by anyone except an admin. The final score, goal scorers, accumulated foul totals, and disciplinary flags are all preserved. The data is automatically used to update standings, brackets, and player statistics.",
        playonNote: "If you spot an error after the card is locked, contact an admin — they can unlock it for correction.",
      },
      {
        id: "3-9",
        title: "Disciplinary Notes",
        body: "If a card or send-off is issued during the game, record it in the disciplinary section of the game card. Select the player, the card type (yellow or red), and the minute of the incident. For futsal, a red card also triggers the 2-minute short-handed timer. These records feed into the suspension tracking system.",
      },
    ],
    questions: [
      {
        id: "3-q1",
        question: "Which of these is the correct order for the game card workflow?",
        options: [
          "Enter score → check in players → get ref approval → lock card",
          "Open card → check in both teams → enter score & fouls live → submit for ref approval → card locks",
          "Open card → submit for approval → check in teams → enter score",
          "Check in players → lock card → enter score",
        ],
        correctIndex: 1,
        explanation: "The correct order is: Open card → check in both teams → enter score & fouls live during the game → submit for ref approval when done → the ref approves and the card locks.",
      },
      {
        id: "3-q2",
        question: "A futsal team has 5 accumulated fouls at halftime. What should you do with that counter at the start of the second half?",
        options: [
          "Leave it at 5 — it carries over",
          "Set it to 1",
          "Reset it to 0",
          "Ask the referee to decide",
        ],
        correctIndex: 2,
        explanation: "Accumulated fouls reset to zero at halftime. The 6th-foul rule applies independently in each half. PlayOn prompts you to reset the counters when you trigger halftime.",
      },
      {
        id: "3-q3",
        question: "Who can approve (sign off on) a completed game card?",
        options: [
          "The scorekeeper",
          "Either team's captain",
          "The referee assigned to the game",
          "Any admin",
        ],
        correctIndex: 2,
        explanation: "Only the assigned referee can approve the final game card. Scorekeepers submit the card for approval, but the referee must sign off.",
      },
      {
        id: "3-q4",
        question: "A goal was entered for the wrong team by mistake. What should you do?",
        options: [
          "Leave it and note it in the comments",
          "Use the subtract/remove goal button to correct it before submitting",
          "Submit the card and let the referee fix it",
          "Lock the card and ask an admin",
        ],
        correctIndex: 1,
        explanation: "You can subtract or remove a goal before the card is submitted for approval. Always correct scoring errors before submitting.",
      },
      {
        id: "3-q5",
        question: "The game card is locked after the referee approves it. A scoring error is later discovered. What is the correct next step?",
        options: [
          "The scorekeeper can reopen the card from their dashboard",
          "The referee can reopen and re-approve",
          "Contact an admin — they can unlock the card for correction",
          "The error cannot be fixed once locked",
        ],
        correctIndex: 2,
        explanation: "After a card is locked, only an admin can unlock it for correction. The scorekeeper and referee do not have this ability.",
      },
      {
        id: "3-q6",
        question: "When should you check in players?",
        options: [
          "After the game — check-in is just a formality",
          "Before the game starts — both teams must be checked in before kickoff",
          "Only if a player is flagged for an ID issue",
          "At halftime",
        ],
        correctIndex: 1,
        explanation: "Both teams must be checked in before the game starts. Check-in confirms which players are present and eligible to play. Rosters are frozen at check-in.",
      },
    ],
  },
];

export const REQUIRED_SECTIONS: Record<"ref" | "scorekeeper", number[]> = {
  ref: [1, 2],
  scorekeeper: [1, 2, 3],
};

export const PASSING_SCORE = 0.8;
