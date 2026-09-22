// Real "way-too-early" 2027 NFL Draft skill-position prospects (the class
// that would actually be available in a dynasty rookie draft held after
// this season), pulled from published early big boards (Yahoo Sports,
// SI, 247Sports, Fox Sports - late-Sept 2026 rankings) and ranked within
// position, since these entirely reorder as an actual college season
// plays out. Restricted to QB/RB/WR/TE - the positions a standard (non-IDP)
// dynasty startup actually drafts.

export type PlayerPos = "QB" | "RB" | "WR" | "TE";

export interface DraftProspect {
  name: string;
  pos: PlayerPos;
  school: string;
  /** rank within its own position group, 1 = best */
  posRank: number;
}

export const DRAFT_PROSPECTS: DraftProspect[] = [
  // Quarterbacks
  { name: "Arch Manning", pos: "QB", school: "Texas", posRank: 1 },
  { name: "Dante Moore", pos: "QB", school: "Oregon", posRank: 2 },
  { name: "C.J. Carr", pos: "QB", school: "Notre Dame", posRank: 3 },
  { name: "Julian Sayin", pos: "QB", school: "Ohio State", posRank: 4 },
  { name: "Drew Mestemaker", pos: "QB", school: "Oklahoma State", posRank: 5 },
  { name: "LaNorris Sellers", pos: "QB", school: "South Carolina", posRank: 6 },
  { name: "Drake Lindsey", pos: "QB", school: "Minnesota", posRank: 7 },
  { name: "Trinidad Chambliss", pos: "QB", school: "Ole Miss", posRank: 8 },
  { name: "Darian Mensah", pos: "QB", school: "Miami", posRank: 9 },
  { name: "Jayden Maiava", pos: "QB", school: "USC", posRank: 10 },
  { name: "Sam Leavitt", pos: "QB", school: "LSU", posRank: 11 },

  // Running Backs
  { name: "Kewan Lacy", pos: "RB", school: "Ole Miss", posRank: 1 },
  { name: "Jadan Baugh", pos: "RB", school: "Florida", posRank: 2 },
  { name: "Ahmad Hardy", pos: "RB", school: "Missouri", posRank: 3 },
  { name: "Nate Frazier", pos: "RB", school: "Georgia", posRank: 4 },
  { name: "Mark Fletcher Jr.", pos: "RB", school: "Miami", posRank: 5 },
  { name: "Isaac Brown", pos: "RB", school: "Louisville", posRank: 6 },

  // Wide Receivers
  { name: "Jeremiah Smith", pos: "WR", school: "Ohio State", posRank: 1 },
  { name: "Cam Coleman", pos: "WR", school: "Texas", posRank: 2 },
  { name: "Charlie Becker", pos: "WR", school: "Indiana", posRank: 3 },
  { name: "Nick Marsh", pos: "WR", school: "Indiana", posRank: 4 },
  { name: "Ryan Coleman-Williams", pos: "WR", school: "Alabama", posRank: 5 },
  { name: "Jordan Faison", pos: "WR", school: "Notre Dame", posRank: 6 },
  { name: "KJ Duff", pos: "WR", school: "Rutgers", posRank: 7 },
  { name: "Wyatt Young", pos: "WR", school: "Oklahoma", posRank: 8 },
  { name: "Ryan Wingo", pos: "WR", school: "Texas", posRank: 9 },
  { name: "Mario Craver", pos: "WR", school: "Texas A&M", posRank: 10 },
  { name: "Bryant Wesco Jr.", pos: "WR", school: "Clemson", posRank: 11 },
  { name: "Duce Robinson", pos: "WR", school: "Florida State", posRank: 12 },
  { name: "Omarion Miller", pos: "WR", school: "Arizona State", posRank: 13 },

  // Tight Ends
  { name: "Trey'Dez Green", pos: "TE", school: "LSU", posRank: 1 },
  { name: "Jamari Johnson", pos: "TE", school: "Oregon", posRank: 2 },
  { name: "Terrance Carter Jr.", pos: "TE", school: "Texas Tech", posRank: 3 },
  { name: "Luke Reynolds", pos: "TE", school: "Virginia Tech", posRank: 4 },
  { name: "Benjamin Brahmer", pos: "TE", school: "Penn State", posRank: 5 },
];
