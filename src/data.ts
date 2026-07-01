import { Stage, SignWord, CourseType } from './types';

// 初期シードデータ (初心者向けの日常日本手話単語)
export const DEFAULT_WORDS: SignWord[] = [
  { id: 'w1', word: 'こんにちは', romaji: 'konnichiha', description: '右手の人差し指と中指を立てて額に当ててから、お互いのお辞儀のように2本指を曲げて前に倒す。' },
  { id: 'w2', word: 'ありがとう', romaji: 'arigatou', description: '左手を平らにして前に出し、右手の側面を左手の甲の上にトントンと当ててから、右手をお相撲さんの手刀を切るように上げる。' },
  { id: 'w3', word: 'さようなら', romaji: 'sayounara', description: '手のひらを相手に向けて、左右に数回振る（バイバイの動き）。' },
  { id: 'w4', word: 'だめ', romaji: 'dame', description: '両手（または両手の人差し指）を胸の前で「X」の形に交差させる。' },
  { id: 'w5', word: 'いいよ', romaji: 'iiyo', description: '右手の親指と人差し指で円（OKサイン）を作る。' },
  { id: 'w6', word: 'すみません', romaji: 'sumimasen', description: '右手の親指と人差し指を立てて、眉間のあたりでペコリと下げるような動き。' },
];

// 初期ステージデータを生成する関数
export function createDefaultStages(): Stage[] {
  const courses: CourseType[] = ['tutorial', 'gesture', 'typing'];
  const stages: Stage[] = [];

  courses.forEach(course => {
    for (let level = 1; level <= 5; level++) {
      // 各レベルごとに5つの単語を割り当てる (この6つの中からランダムまたは固定で選択)
      const selectedWords = [...DEFAULT_WORDS]
        .sort(() => 0.5 - Math.random())
        .slice(0, 5);

      stages.push({
        id: `${course}_level_${level}`,
        course,
        level,
        words: selectedWords,
      });
    }
  });

  return stages;
}

const STAGES_STORAGE_KEY = 'sign_language_stages';
const SETTINGS_STORAGE_KEY = 'sign_language_settings';
const HIGHSCORES_STORAGE_KEY = 'sign_language_highscores';

// ステージデータのロード
export function loadStages(): Stage[] {
  const stored = localStorage.getItem(STAGES_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Stage[];
      // 古い単語（例: "よろしく" や "おねがい"）が含まれている場合は最新の単語リストに強制同期する
      const hasOldWords = parsed.some(s => 
        s.words.some(w => !DEFAULT_WORDS.some(dw => dw.word === w.word))
      );
      if (!hasOldWords && parsed.length > 0) {
        return parsed;
      }
      console.log('Detected old/outdated stage words. Resetting stages to align with new sign language vocabulary...');
    } catch (e) {
      console.error('Failed to parse stages, loading default stages', e);
    }
  }
  const defaults = createDefaultStages();
  saveStages(defaults);
  return defaults;
}

// ステージデータの保存
export function saveStages(stages: Stage[]): void {
  localStorage.setItem(STAGES_STORAGE_KEY, JSON.stringify(stages));
}

// 音量設定のロード
export function loadSettings(): { volume: number } {
  const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      console.error('Failed to parse settings, loading defaults', e);
    }
  }
  return { volume: 50 }; // デフォルト音量 50
}

// 音量設定の保存
export function saveSettings(settings: { volume: number }): void {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

// ハイスコアのロード
export function loadHighScores(): Record<string, number> {
  const stored = localStorage.getItem(HIGHSCORES_STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      console.error('Failed to parse highscores', e);
    }
  }
  return {};
}

// ハイスコアの保存
export function saveHighScore(course: CourseType, level: number, score: number): void {
  const scores = loadHighScores();
  const key = `${course}_level_${level}`;
  const currentMax = scores[key] || 0;
  if (score > currentMax) {
    scores[key] = score;
    localStorage.setItem(HIGHSCORES_STORAGE_KEY, JSON.stringify(scores));
  }
}

// すべての設定とデータを初期化する
export function resetAllData(): void {
  localStorage.removeItem(STAGES_STORAGE_KEY);
  localStorage.removeItem(SETTINGS_STORAGE_KEY);
  localStorage.removeItem(HIGHSCORES_STORAGE_KEY);
}
