import React, { useState, useEffect, useRef } from 'react';
import { Stage, CourseType } from './types';
import { loadStages, loadSettings, saveSettings, loadHighScores, resetAllData } from './data';
import EditMode from './components/EditMode';
import GameScreen from './components/GameScreen';
import { Volume2, Settings, Trophy, HelpCircle, Sliders, Play, Edit, RotateCcw, Camera } from 'lucide-react';

type GameState = 'title' | 'stage_select' | 'level_select' | 'game' | 'score';

export default function App() {
  const [gameState, setGameState] = useState<GameState>('title');
  const [stages, setStages] = useState<Stage[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<CourseType | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
  const [currentStage, setCurrentStage] = useState<Stage | null>(null);
  const [lastScore, setLastScore] = useState<number>(0);

  // 設定とハイスコア
  const [volume, setVolume] = useState<number>(50);
  const [highScores, setHighScores] = useState<Record<string, number>>({});
  const [isEditModeOpen, setIsEditModeOpen] = useState<boolean>(false);

  // チュートリアル用のトラッキング調整変数
  const [trackingSensitivity, setTrackingSensitivity] = useState<number>(75);
  const [cameraTestActive, setCameraTestActive] = useState<boolean>(false);
  const tutorialVideoRef = useRef<HTMLVideoElement | null>(null);
  const tutorialStreamRef = useRef<MediaStream | null>(null);

  // 初回データロード
  useEffect(() => {
    setStages(loadStages());
    const settings = loadSettings();
    setVolume(settings.volume);
    setHighScores(loadHighScores());
  }, [gameState, isEditModeOpen]);

  // 音量の変更
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setVolume(val);
    saveSettings({ volume: val });
  };

  // データのフルリセット
  const handleFullReset = () => {
    if (window.confirm('すべての設定、音量、ハイスコア、編集したステージデータを初期状態（工場出荷時）に戻します。よろしいですか？')) {
      resetAllData();
      setStages(loadStages());
      const settings = loadSettings();
      setVolume(settings.volume);
      setHighScores(loadHighScores());
      alert('初期化が完了しました。');
    }
  };

  // ステージ、レベル選択決定
  const handleSelectCourse = (course: CourseType) => {
    setSelectedCourse(course);
    setGameState('level_select');
  };

  const handleSelectLevel = (level: number) => {
    setSelectedLevel(level);
    
    // 対象ステージデータをロード
    const targetStage = stages.find(s => s.course === selectedCourse && s.level === level);
    if (targetStage) {
      // プレイ時にお題単語（5問）をランダムにシャッフルしてロード
      const shuffledStage = {
        ...targetStage,
        words: [...targetStage.words].sort(() => 0.5 - Math.random())
      };
      setCurrentStage(shuffledStage);
      setGameState('game');
    } else {
      alert('該当するステージデータがロードできませんでした。');
    }
  };

  // ゲーム終了時
  const handleGameFinish = (score: number) => {
    setLastScore(score);
    setGameState('score');
    setHighScores(loadHighScores());
  };

  // チュートリアルにおけるカメラトラッキング調整のトグル
  const toggleCameraTest = () => {
    if (cameraTestActive) {
      if (tutorialStreamRef.current) {
        tutorialStreamRef.current.getTracks().forEach(track => track.stop());
      }
      setCameraTestActive(false);
    } else {
      navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => {
          if (tutorialVideoRef.current) {
            tutorialVideoRef.current.srcObject = stream;
            tutorialStreamRef.current = stream;
            setCameraTestActive(true);
          }
        })
        .catch(err => {
          console.error(err);
          alert('カメラが見つからないか、許可がありません。');
        });
    }
  };

  // チュートリアル終了時のクリーンアップ
  useEffect(() => {
    return () => {
      if (tutorialStreamRef.current) {
        tutorialStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // エディットモード起動時は他を遮断
  if (isEditModeOpen) {
    return <EditMode onClose={() => setIsEditModeOpen(false)} />;
  }

  // ゲームプレイ時は全画面を美しく表示するため、二重レイアウトを避けて遮断レンダリング
  if (gameState === 'game' && currentStage) {
    return (
      <GameScreen
        stage={currentStage}
        volume={volume}
        onFinish={handleGameFinish}
        onBackToMenu={() => setGameState('title')}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f5f0] text-[#4a3e3d] font-sans flex flex-col justify-center py-10 px-4">
      <div className="max-w-3xl w-full mx-auto bg-[#faf8f5] rounded-3xl border border-[#e6dfd5] p-8 md:p-12 shadow-sm">
        
        {/* ==================== 1. タイトル画面 ==================== */}
        {gameState === 'title' && (
          <div id="title-screen-container" className="space-y-10">
            {/* タイトル表示は不要との指示のため、ロゴやタイトル名は表示せず、美しく静かな佇まいで開始します。 */}
            
            {/* メインアクション */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                id="start-game-button"
                onClick={() => setGameState('stage_select')}
                className="py-4 px-6 bg-[#8c7a6b] hover:bg-[#78695c] text-white font-bold rounded-2xl transition-all flex items-center justify-center gap-3 cursor-pointer text-lg"
              >
                <Play className="w-5 h-5 fill-current" />
                ゲームを開始する
              </button>
              
              <button
                id="open-edit-mode-button"
                onClick={() => setIsEditModeOpen(true)}
                className="py-4 px-6 bg-[#eae4da] hover:bg-[#dfd8cd] text-[#5c4e4d] font-bold rounded-2xl transition-all flex items-center justify-center gap-3 cursor-pointer text-lg"
              >
                <Edit className="w-5 h-5" />
                エディットモード
              </button>
            </div>

            {/* 音量調整 ＆ 設定の初期化 */}
            <div className="bg-[#f0ece1] rounded-2xl p-6 border border-[#dfd8cd] space-y-4">
              <h3 className="text-xs font-semibold text-[#8c7a6b] uppercase tracking-wider flex items-center gap-2">
                <Settings className="w-4 h-4 text-[#8c7a6b]" />
                システム設定
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                {/* 音量スライダー */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-[#5c4e4d] flex items-center gap-1.5">
                      <Volume2 className="w-4 h-4 text-[#8c7a6b]" />
                      音量調整 (効果音・通知音)
                    </span>
                    <span className="text-xs font-semibold text-[#8c7a6b]">{volume}%</span>
                  </div>
                  <input
                    type="range"
                    id="volume-slider"
                    min="0"
                    max="100"
                    value={volume}
                    onChange={handleVolumeChange}
                    className="w-full h-1.5 bg-[#dfd8cd] rounded-lg appearance-none cursor-pointer accent-[#8c7a6b]"
                  />
                </div>

                {/* 初期化ボタン */}
                <div className="flex justify-end">
                  <button
                    id="initialize-settings-button"
                    onClick={handleFullReset}
                    className="px-4 py-2 bg-[#eae4da] hover:bg-[#f2dedb] text-[#5c4e4d] hover:text-[#b45a55] text-xs font-semibold rounded-lg border border-[#dfd8cd] transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    設定とデータを初期化
                  </button>
                </div>
              </div>
            </div>

            {/* ローカルハイスコア一覧表示 */}
            <div className="bg-[#f0ece1] rounded-2xl p-6 border border-[#dfd8cd]">
              <h3 className="text-xs font-semibold text-[#8c7a6b] uppercase tracking-wider flex items-center gap-2 mb-4">
                <Trophy className="w-4 h-4 text-[#bf9c72]" />
                現在のハイスコア記録
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(['tutorial', 'gesture', 'typing'] as CourseType[]).map(course => (
                  <div key={course} className="bg-[#faf8f5] p-4 rounded-xl border border-[#dfd8cd] space-y-2">
                    <span className="text-xs font-bold text-[#8c7a6b] block border-b border-[#f0ece1] pb-1.5">
                      {course === 'tutorial' && 'チュートリアル'}
                      {course === 'gesture' && 'ジェスチャー'}
                      {course === 'typing' && 'タイピング'}
                    </span>
                    <div className="space-y-1">
                      {[1, 2, 3, 4, 5].map(level => {
                        const key = `${course}_level_${level}`;
                        const score = highScores[key] || 0;
                        return (
                          <div key={level} className="flex justify-between text-xs font-medium">
                            <span className="text-[#6e5e5d]">レベル {level}</span>
                            <span className={score > 0 ? 'text-[#bf9c72] font-bold' : 'text-[#c7bfb4]'}>
                              {score} / 5 pt
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* ==================== 2. ステージセレクト ==================== */}
        {gameState === 'stage_select' && (
          <div id="stage-select-container" className="space-y-8">
            <div className="text-center">
              <h3 className="text-2xl font-bold text-[#4a3e3d]">コースを選択してください</h3>
              <p className="text-sm text-[#8c7a6b] mt-1">学習スタイルに合わせてコースを選択できます。</p>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {/* チュートリアルコース */}
              <button
                id="select-course-tutorial"
                onClick={() => handleSelectCourse('tutorial')}
                className="p-6 bg-[#faf8f5] hover:bg-[#f5f1e9] border border-[#e6dfd5] hover:border-[#8c7a6b] rounded-2xl transition-all text-left flex items-start gap-4 cursor-pointer group"
              >
                <div className="p-3 bg-[#f0ece1] text-[#8c7a6b] rounded-xl group-hover:bg-[#8c7a6b] group-hover:text-white transition-colors">
                  <HelpCircle className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-bold text-lg text-[#4a3e3d]">チュートリアル</h4>
                  <p className="text-sm text-[#7c6d62]">ゲーム概要・操作方法の説明、およびカメラトラッキング精度の調整枠のテストを行います。</p>
                </div>
              </button>

              {/* 手話ジェスチャーコース */}
              <button
                id="select-course-gesture"
                onClick={() => handleSelectCourse('gesture')}
                className="p-6 bg-[#faf8f5] hover:bg-[#f5f1e9] border border-[#e6dfd5] hover:border-[#8c7a6b] rounded-2xl transition-all text-left flex items-start gap-4 cursor-pointer group"
              >
                <div className="p-3 bg-[#f0ece1] text-[#8c7a6b] rounded-xl group-hover:bg-[#8c7a6b] group-hover:text-white transition-colors">
                  <Camera className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-bold text-lg text-[#4a3e3d]">手話ジェスチャーコース</h4>
                  <p className="text-sm text-[#7c6d62]">指示された内容に沿って、実際にカメラに向かって手話を実演して学習します。</p>
                </div>
              </button>

              {/* 読み取りタイピングコース */}
              <button
                id="select-course-typing"
                onClick={() => handleSelectCourse('typing')}
                className="p-6 bg-[#faf8f5] hover:bg-[#f5f1e9] border border-[#e6dfd5] hover:border-[#8c7a6b] rounded-2xl transition-all text-left flex items-start gap-4 cursor-pointer group"
              >
                <div className="p-3 bg-[#f0ece1] text-[#8c7a6b] rounded-xl group-hover:bg-[#8c7a6b] group-hover:text-white transition-colors">
                  <Sliders className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-bold text-lg text-[#4a3e3d]">読み取りタイピングコース</h4>
                  <p className="text-sm text-[#7c6d62]">提示された手話の意味（読み）を判別し、キーボードでタイピングして決定します。</p>
                </div>
              </button>
            </div>

            <div className="flex justify-center pt-4">
              <button
                id="back-to-title-from-select"
                onClick={() => setGameState('title')}
                className="px-6 py-2.5 bg-[#eae4da] hover:bg-[#dfd8cd] text-[#5c4e4d] font-semibold rounded-xl transition-all text-sm cursor-pointer"
              >
                タイトルに戻る
              </button>
            </div>
          </div>
        )}

        {/* ==================== 3. 難易度選択 ==================== */}
        {gameState === 'level_select' && (
          <div id="level-select-container" className="space-y-8">
            <div className="text-center">
              <h3 className="text-2xl font-bold text-[#4a3e3d]">難易度レベルを選択してください</h3>
              <p className="text-sm text-[#8c7a6b] mt-1">レベルに応じた制限時間や手本表示のルールが適用されます。</p>
            </div>

            {/* チュートリアル用のトラッキング調節UI */}
            {selectedCourse === 'tutorial' && (
              <div className="bg-[#f3eee5] p-6 rounded-2xl border border-[#dfd8cd] space-y-4">
                <h4 className="font-bold text-[#4a3e3d] flex items-center gap-1.5 text-sm">
                  <Sliders className="w-4 h-4 text-[#8c7a6b]" />
                  トラッキング精度の調節 ＆ カメラテスト
                </h4>
                <p className="text-xs text-[#7c6d62] leading-relaxed">
                  手話ジェスチャーコースを開始する前に、カメラが正しく機能しているか、手の認識感度が適正か確認・調節できます。
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                  {/* 感度調節スライダー */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[#5c4e4d] font-medium">認識感度（トラッキング閾値）</span>
                      <span className="font-bold text-[#8c7a6b]">{trackingSensitivity}%</span>
                    </div>
                    <input
                      type="range"
                      id="sensitivity-slider"
                      min="10"
                      max="100"
                      value={trackingSensitivity}
                      onChange={(e) => setTrackingSensitivity(parseInt(e.target.value))}
                      className="w-full h-1.5 bg-[#dfd8cd] rounded-lg appearance-none cursor-pointer accent-[#8c7a6b]"
                    />
                  </div>

                  {/* カメラテスト開始ボタン */}
                  <div className="flex justify-end">
                    <button
                      id="toggle-camera-test-button"
                      onClick={toggleCameraTest}
                      className="px-4 py-2 bg-[#faf8f5] hover:bg-[#f5f1e9] text-[#5c4e4d] text-xs font-bold rounded-lg border border-[#dfd8cd] flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5 text-[#8c7a6b]" />
                      {cameraTestActive ? 'カメラテストを終了' : 'カメラテストを開始'}
                    </button>
                  </div>
                </div>

                {/* カメラテストの映像プレビュー */}
                {cameraTestActive && (
                  <div className="mt-3 aspect-video bg-[#3a3530] rounded-xl overflow-hidden border border-[#dfd8cd] relative">
                    <video
                      id="tutorial-camera-preview"
                      ref={tutorialVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover scale-x-[-1]"
                    />
                    <div className="absolute inset-0 border-2 border-dashed border-[#eae4da]/50 pointer-events-none rounded-xl m-4 flex items-center justify-center">
                      <span className="bg-[#1f1a17]/90 text-[10px] text-[#eae4da] px-2 py-1 rounded">手のトラッキング判定調節枠</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 難易度レベル1〜5 */}
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              {[1, 2, 3, 4, 5].map(level => (
                <button
                  key={level}
                  id={`choose-level-btn-${level}`}
                  onClick={() => handleSelectLevel(level)}
                  className="py-4 px-3 bg-[#faf8f5] hover:bg-[#f5f1e9] border border-[#e6dfd5] hover:border-[#8c7a6b] rounded-xl transition-all cursor-pointer flex flex-col items-center justify-center text-center space-y-1.5"
                >
                  <span className="text-xs font-semibold text-[#8c7a6b]">Level</span>
                  <span className="text-2xl font-bold text-[#8c7a6b]">{level}</span>
                  <span className="text-[10px] text-[#7c6d62] font-medium leading-tight">
                    {level === 1 && '手本有 / 時間無'}
                    {level === 2 && '手本有 / お題UP'}
                    {level === 3 && '手本有 / 30秒'}
                    {level === 4 && '手本無 / 30秒'}
                    {level === 5 && '手本無 / 15秒・半減'}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex justify-center pt-4">
              <button
                id="back-to-course-select"
                onClick={() => setGameState('stage_select')}
                className="px-6 py-2.5 bg-[#eae4da] hover:bg-[#dfd8cd] text-[#5c4e4d] font-semibold rounded-xl transition-all text-sm cursor-pointer"
              >
                コース選択に戻る
              </button>
            </div>
          </div>
        )}

        {/* ==================== 5. スコア表示 ==================== */}
        {gameState === 'score' && (
          <div id="score-screen-container" className="text-center space-y-8">
            <div className="space-y-3">
              <Trophy className="w-16 h-16 text-[#bf9c72] mx-auto animate-bounce" />
              <h3 className="text-2xl font-bold text-[#4a3e3d]">お疲れ様でした！</h3>
              <p className="text-sm text-[#8c7a6b]">現在のプレイ結果スコアは以下の通りです。</p>
            </div>

            <div className="bg-[#f0ece1] p-6 rounded-2xl border border-[#dfd8cd] max-w-sm mx-auto space-y-2">
              <span className="text-xs font-bold text-[#8c7a6b] uppercase tracking-widest block">獲得スコア</span>
              <span id="final-score" className="text-5xl font-extrabold text-[#8c7a6b] block">
                {lastScore} <span className="text-lg font-bold text-[#5c4e4d]">/ 5 pt</span>
              </span>

              <div className="pt-2 text-xs text-[#7c6d62]">
                コース: {selectedCourse === 'tutorial' && 'チュートリアル'}
                {selectedCourse === 'gesture' && '手話ジェスチャー'}
                {selectedCourse === 'typing' && '読み取りタイピング'} / レベル: {selectedLevel}
              </div>
            </div>

            <div className="flex justify-center gap-4 pt-4">
              <button
                id="retry-button"
                onClick={() => handleSelectLevel(selectedLevel!)}
                className="px-6 py-3 bg-[#8c7a6b] hover:bg-[#78695c] text-white font-bold rounded-xl transition-all text-sm cursor-pointer"
              >
                もう一度挑戦する
              </button>
              <button
                id="score-to-title-button"
                onClick={() => setGameState('title')}
                className="px-6 py-3 bg-[#eae4da] hover:bg-[#dfd8cd] text-[#5c4e4d] font-bold rounded-xl transition-all text-sm cursor-pointer"
              >
                タイトルに戻る
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

