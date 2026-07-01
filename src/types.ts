export interface SignWord {
  id: string;
  word: string;     // お題単語 (例: "こんにちは")
  romaji: string;   // ローマ字読み (例: "konnichiha")
  description: string; // 動きの説明や手本情報
}

export type CourseType = 'tutorial' | 'gesture' | 'typing';

export interface Stage {
  id: string;
  course: CourseType;
  level: number; // 1, 2, 3, 4, 5
  words: SignWord[];
}

export interface GameSettings {
  volume: number; // 0 to 100
}

export interface HighScore {
  course: CourseType;
  level: number;
  score: number;
}
