import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Stage, SignWord, CourseType } from '../types';
import { saveHighScore } from '../data';
import { Camera, Volume2, Timer, Check, AlertTriangle, ArrowRight, Keyboard, EyeOff, Play } from 'lucide-react';

interface GameScreenProps {
  stage: Stage;
  volume: number;
  onFinish: (score: number) => void;
  onBackToMenu: () => void;
}

export default function GameScreen({ stage, volume, onFinish, onBackToMenu }: GameScreenProps) {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);
  const [score, setScore] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState<number>(30); // デフォルト30秒
  const [inputValue, setInputValue] = useState<string>(''); // タイピングコース用
  const [hasFailedThisQuestion, setHasFailedThisQuestion] = useState<boolean>(false);
  
  // カメラ関連
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<boolean>(false);

  const setVideoRef = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
    }
  }, []);

  // 回答済みの二重発火防止フラグ
  const [hasAnswered, setHasAnswered] = useState<boolean>(false);

  // ジェスチャーオート判定（シミュレーター用）
  const [gestureMatchProgress, setGestureMatchProgress] = useState<number>(0);
  const [isRecognizing, setIsRecognizing] = useState<boolean>(false);

  // 手話ジェスチャー解答テスト用の状態
  const [isTestReady, setIsTestReady] = useState<boolean>(true);
  const [testCountdown, setTestCountdown] = useState<number>(0);
  const [isTestCountingDown, setIsTestCountingDown] = useState<boolean>(false);
  const [isMeasuring, setIsMeasuring] = useState<boolean>(false);
  const [measuringTimeLeft, setMeasuringTimeLeft] = useState<number>(3.0);
  const [testResultStatus, setTestResultStatus] = useState<'idle' | 'success' | 'failed'>('idle');

  const isMeasuringRef = useRef<boolean>(false);
  const testSamplingBufferRef = useRef<any[]>([]);
  const latestLandmarksRef = useRef<any>(null);

  // タイマークリーンアップ用のRef
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // 音調整 (仮のビープ音/Web Audio APIによる正解・不正解音)
  const playSound = (type: 'correct' | 'incorrect') => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      // ユーザー設定の音量を反映 (0 to 1)
      gain.gain.value = (volume / 100) * 0.15;

      if (type === 'correct') {
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.setValueAtTime(800, ctx.currentTime + 0.1);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      } else {
        osc.frequency.setValueAtTime(250, ctx.currentTime);
        osc.frequency.setValueAtTime(150, ctx.currentTime + 0.1);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      }
    } catch (e) {
      console.log('Audio Context is not allowed or supported yet', e);
    }
  };

  const currentWord: SignWord = stage.words[currentQuestionIndex] || {
    id: '',
    word: '未定義のお題',
    romaji: '',
    description: ''
  };

  // 難易度別の制限時間設定
  const hasTimer = stage.level >= 3;
  const initialTime = stage.level === 5 ? 15 : 30;

  // 手本の表示可否
  const showHelper = stage.level < 4;

  // --- カメラの開始と停止 ---
  useEffect(() => {
    let active = true;
    if (stage.course === 'tutorial' || stage.course === 'gesture') {
      navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
        .then(stream => {
          if (!active) {
            stream.getTracks().forEach(track => track.stop());
            return;
          }
          streamRef.current = stream;
          setCameraActive(true);
          setCameraError(false);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        })
        .catch(err => {
          if (active) {
            console.error('Camera access error:', err);
            setCameraError(true);
            setCameraActive(false);
          }
        });
    }

    return () => {
      active = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      setCameraActive(false);
    };
  }, [stage.course]);

  // --- 制限時間（タイマー）処理 ---
  useEffect(() => {
    if (!hasTimer) return;

    setTimeLeft(initialTime);
    setHasFailedThisQuestion(false);

    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          handleTimeOut();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [currentQuestionIndex, stage.level]);

  // --- タイムアウト時のペナルティ処理 ---
  const handleTimeOut = () => {
    if (hasAnswered) return;
    setHasAnswered(true);

    playSound('incorrect');
    setHasFailedThisQuestion(true);

    let newScore = score;
    if (stage.level === 5) {
      // レベル5ペナルティ: 失敗するたびに現在のスコアが半分になる
      newScore = Math.floor(score / 2);
      setScore(newScore);
    }

    // 1.5秒後に自動で次の問題へ進む
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      moveToNextQuestion(newScore);
    }, 1500);
  };

  // --- 時系列ジェスチャーの照合・比較アルゴリズム ---
  const resampleTrajectory = (frames: any[], targetSize: number = 20): any[] => {
    // 有効なフレーム（nullではない、かつ手が1つ以上検出されている）を抽出
    const validFrames = frames.filter(f => f && f.length > 0 && f[0] && f[0].length >= 21);
    if (validFrames.length === 0) return [];

    const resampled: any[] = [];
    for (let i = 0; i < targetSize; i++) {
      const idx = Math.floor((i / (targetSize - 1)) * (validFrames.length - 1));
      resampled.push(validFrames[idx][0]); // 最初の片手を採用
    }
    return resampled;
  };

  const calculateHandDistance = (handA: any[], handB: any[]): number => {
    const getDist = (p1: any, p2: any) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2) + Math.pow(p1.z - p2.z, 2));
    
    const lenA = getDist(handA[0], handA[9]) || 1;
    const lenB = getDist(handB[0], handB[9]) || 1;

    let totalDist = 0;
    for (let i = 0; i < 21; i++) {
      // 手首からの相対座標を正規化
      const normAx = (handA[i].x - handA[0].x) / lenA;
      const normAy = (handA[i].y - handA[0].y) / lenA;
      const normAz = (handA[i].z - handA[0].z) / lenA;

      const normBx = (handB[i].x - handB[0].x) / lenB;
      const normBy = (handB[i].y - handB[0].y) / lenB;
      const normBz = (handB[i].z - handB[0].z) / lenB;

      totalDist += Math.sqrt(
        Math.pow(normAx - normBx, 2) +
        Math.pow(normAy - normBy, 2) +
        Math.pow(normAz - normBz, 2)
      );
    }
    return totalDist / 21;
  };

  const compareGestures = (userFrames: any[], trainedFrames: any[]): number => {
    const size = 20;
    const resampledUser = resampleTrajectory(userFrames, size);
    const resampledTrained = resampleTrajectory(trainedFrames, size);

    if (resampledUser.length < size || resampledTrained.length < size) {
      return 999;
    }

    let distanceSum = 0;
    for (let i = 0; i < size; i++) {
      distanceSum += calculateHandDistance(resampledUser[i], resampledTrained[i]);
    }
    return distanceSum / size;
  };

  // --- カウントダウンタイマー & サンプリングタイマー制御 ---
  useEffect(() => {
    let countdownInterval: any;
    if (isTestCountingDown) {
      countdownInterval = setInterval(() => {
        setTestCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(countdownInterval);
            setIsTestCountingDown(false);
            startMeasuring(); // 3秒カウントダウン終了後に計測開始
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(countdownInterval);
  }, [isTestCountingDown]);

  // 計測（サンプリング）開始（3秒間計測）
  const startMeasuring = () => {
    setIsMeasuring(true);
    isMeasuringRef.current = true;
    setMeasuringTimeLeft(3.0);
    testSamplingBufferRef.current = [];

    let timeLeft = 3.0;
    const interval = setInterval(() => {
      timeLeft = Math.max(0, timeLeft - 0.1);
      setMeasuringTimeLeft(parseFloat(timeLeft.toFixed(1)));

      if (timeLeft <= 0) {
        clearInterval(interval);
        setIsMeasuring(false);
        isMeasuringRef.current = false;
        evaluateGestureTest(); // 3秒計測終了後に評価
      }
    }, 100);
  };

  // 判定の評価
  const evaluateGestureTest = () => {
    const wordName = currentWord.word;
    const userFrames = testSamplingBufferRef.current;

    // ローカルストレージから学習データをロード
    let savedSamples: any = {};
    try {
      const stored = localStorage.getItem('sign_learning_samples');
      if (stored) {
        savedSamples = JSON.parse(stored);
      }
    } catch (e) {
      console.error('Failed to parse learning samples:', e);
    }

    const wordSamples: any[][] = savedSamples[wordName] || [];

    // 有効なフレームがユーザーの解答データにあるか確認
    const validUserFrames = userFrames.filter(f => f && f.length > 0 && f[0] && f[0].length >= 21);
    if (validUserFrames.length === 0) {
      playSound('incorrect');
      setTestResultStatus('failed');
      alert('サンプリング期間中、カメラに手が検出されませんでした。もう一度試してください。');
      setIsTestReady(true);
      return;
    }

    let isMatched = false;

    if (wordSamples.length > 0) {
      // 1. 学習データが存在する場合：保存された各サンプルと比較し、最も近い距離を測定
      let minDistance = 999;
      for (const trained of wordSamples) {
        const dist = compareGestures(userFrames, trained);
        if (dist < minDistance) {
          minDistance = dist;
        }
      }

      console.log(`[Gesture Matching] Word: ${wordName}, Distance: ${minDistance}`);

      // 閾値 0.22（関節ペアの平均座標ずれ率が約22%以内なら一致と判定、微調整を考慮して少し緩めの0.22。学習が正確なら完璧に捉えます）
      if (minDistance <= 0.22) {
        isMatched = true;
      }
    } else {
      // 2. 学習データがまだない場合のフォールバック（旧ルールベース判定）
      const checkGestureMatchFallback = (wordName: string, multiHandLandmarks: any[]): boolean => {
        if (!multiHandLandmarks || multiHandLandmarks.length === 0) return false;
        const firstHand = multiHandLandmarks[0];
        if (!firstHand || firstHand.length < 21) return false;
        const isExtended = (tip: number, pip: number) => firstHand[tip].y < firstHand[pip].y;
        const indexExt = isExtended(8, 6);
        const middleExt = isExtended(12, 10);
        const ringExt = isExtended(16, 14);
        const pinkyExt = isExtended(20, 18);

        if (wordName === 'こんにちは') return indexExt && middleExt && !ringExt && !pinkyExt;
        if (wordName === 'ありがとう') return (indexExt && middleExt && ringExt && pinkyExt) || multiHandLandmarks.length >= 2;
        if (wordName === 'さようなら') return indexExt && middleExt && ringExt && pinkyExt;
        if (wordName === 'だめ') return multiHandLandmarks.length >= 2;
        if (wordName === 'いいよ') return indexExt;
        if (wordName === 'すみません') return indexExt && !middleExt && !ringExt && !pinkyExt;
        return true;
      };

      const matchCount = validUserFrames.filter(frame => checkGestureMatchFallback(wordName, frame)).length;
      const ratio = matchCount / validUserFrames.length;
      if (ratio >= 0.5) {
        isMatched = true;
      }
    }

    if (isMatched) {
      playSound('correct');
      setTestResultStatus('success');
      setGestureMatchProgress(100);
      setIsRecognizing(false);
      
      const newScore = score + 1;
      setScore(newScore);
      
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setIsTestReady(true);
        setTestResultStatus('idle');
        moveToNextQuestion(newScore);
      }, 1500);
    } else {
      playSound('incorrect');
      setTestResultStatus('failed');
      alert('動きや形が登録された手話と一致しませんでした。もう一度チャレンジしてください！');
      setIsTestReady(true);
    }
  };

  // 解答開始ボタントリガー
  const handleStartGestureTest = () => {
    if (!cameraActive) {
      alert('カメラが起動していません。カメラへのアクセスを許可してください。');
      return;
    }
    setIsTestReady(false);
    setTestResultStatus('idle');
    setTestCountdown(3);
    setIsTestCountingDown(true);
    setIsMeasuring(false);
    testSamplingBufferRef.current = [];
    isMeasuringRef.current = false;
  };

  // --- 手話ジェスチャーコース：MediaPipe Hands によるリアルタイムハンドトラッキング ---
  useEffect(() => {
    if (stage.course !== 'gesture' && stage.course !== 'tutorial') return;
    if (!cameraActive) return;

    setGestureMatchProgress(0);
    setIsRecognizing(true);

    const Hands = (window as any).Hands;
    const Camera = (window as any).Camera;
    const drawConnectors = (window as any).drawConnectors;
    const drawLandmarks = (window as any).drawLandmarks;
    const HAND_CONNECTIONS = (window as any).HAND_CONNECTIONS;

    if (!Hands || !Camera) {
      console.warn('MediaPipe Hands is not loaded from CDN yet.');
      return;
    }

    let active = true;

    const hands = new Hands({
      locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    hands.onResults((results: any) => {
      if (!active) return;
      if (hasAnswered) return; // すでに正答済みの場合は何も行わない

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // キャンバスをクリア
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let handsDetected = false;
      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        handsDetected = true;
        latestLandmarksRef.current = results.multiHandLandmarks;

        // 解答計測（サンプリング）中であれば、関節データをバッファに追加
        if (isMeasuringRef.current) {
          testSamplingBufferRef.current.push(JSON.parse(JSON.stringify(results.multiHandLandmarks)));
        }

        for (const landmarks of results.multiHandLandmarks) {
          // 指の関節と接続を描画
          if (drawConnectors && HAND_CONNECTIONS) {
            drawConnectors(ctx, landmarks, HAND_CONNECTIONS, {
              color: '#d97706', // より鮮明なアンバー
              lineWidth: 3
            });
          }
          if (drawLandmarks) {
            drawLandmarks(ctx, landmarks, {
              color: '#3b82f6', // 鮮明なブルー of 関節点
              lineWidth: 1,
              radius: 4
            });
          }
        }
      } else {
        latestLandmarksRef.current = null;
        // 手が検出されない場合でも、時系列データのタイミングずれを防ぐため
        // サンプリング中であればnullを挿入し、存在なしを記録
        if (isMeasuringRef.current) {
          testSamplingBufferRef.current.push(null);
        }
      }
    });

    // 既存のWebcamビデオ要素からフレームデータをMediaPipeへ転送
    const camera = new Camera(videoRef.current, {
      onFrame: async () => {
        if (videoRef.current && active) {
          try {
            await hands.send({ image: videoRef.current });
          } catch (err) {
            // 一時的なエラーを無視
          }
        }
      },
      width: 640,
      height: 480
    });

    camera.start();

    return () => {
      active = false;
      try {
        camera.stop();
        hands.close();
      } catch (e) {
        // ignore
      }
    };
  }, [currentQuestionIndex, cameraActive, stage.course, hasAnswered]);

  // 1問正解時の処理 (ジェスチャー)
  const handleCorrectGesture = () => {
    if (hasAnswered) return;
    setHasAnswered(true);

    playSound('correct');
    const newScore = score + 1;
    setScore(newScore);
    
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      moveToNextQuestion(newScore);
    }, 1200);
  };

  // 手動認識シミュレートボタン（またはスペースキー）が押されたときの即座正解判定
  const triggerInstantCorrect = () => {
    if (hasAnswered) return;
    if (!isRecognizing && stage.course === 'gesture') return;
    setGestureMatchProgress(100);
    setIsRecognizing(false);
    handleCorrectGesture();
  };

  // --- タイピングコース：正誤判定 ---
  const handleTypingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (hasAnswered) return;

    const normalizedInput = inputValue.trim().toLowerCase();
    const answer = currentWord.romaji.trim().toLowerCase();

    if (normalizedInput === answer) {
      setHasAnswered(true);
      playSound('correct');
      const newScore = score + 1;
      setScore(newScore);
      moveToNextQuestion(newScore);
    } else {
      setHasAnswered(true);
      playSound('incorrect');
      setHasFailedThisQuestion(true);

      let newScore = score;
      if (stage.level === 5) {
        newScore = Math.floor(score / 2);
        setScore(newScore);
      }

      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        moveToNextQuestion(newScore);
      }, 1500);
    }
  };

  // --- チュートリアルコースの進行 ---
  const handleTutorialNext = () => {
    if (hasAnswered) return;
    setHasAnswered(true);

    playSound('correct');
    const newScore = score + 1;
    setScore(newScore);
    moveToNextQuestion(newScore);
  };

  // --- 次の質問へ遷移 / ゲーム終了 ---
  const moveToNextQuestion = (nextScore?: number) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    
    setInputValue('');
    setHasFailedThisQuestion(false);
    setGestureMatchProgress(0);
    setHasAnswered(false);

    const scoreToSave = nextScore !== undefined ? nextScore : score;

    if (currentQuestionIndex + 1 < stage.words.length) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else {
      // 5問満点を絶対に超えないようにガード
      const safeScore = Math.min(5, scoreToSave);
      saveHighScore(stage.course, stage.level, safeScore);
      onFinish(safeScore);
    }
  };

  return (
    <div id="game-play-container" className="min-h-screen bg-[#f7f5f0] flex flex-col font-sans text-[#4a3e3d]">
      
      {/* プレイ画面ヘッダー情報 */}
      <div className="bg-[#faf8f5] border-b border-[#e6dfd5] px-6 py-4 flex justify-between items-center shadow-xs">
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 bg-[#eae4da] text-[#5c4e4d] text-xs font-semibold rounded-full uppercase tracking-wider">
            {stage.course === 'tutorial' && 'チュートリアル'}
            {stage.course === 'gesture' && '手話ジェスチャー'}
            {stage.course === 'typing' && '読み取りタイピング'}
          </span>
          <span className="text-sm font-medium text-[#8c7a6b]">
            難易度: レベル {stage.level}
          </span>
        </div>

        {/* スコア ＆ 進行度 */}
        <div className="flex items-center gap-6">
          <div className="text-right">
            <span className="text-xs text-[#8c7a6b] block font-medium">現在スコア</span>
            <span id="current-score" className="text-xl font-bold text-[#bf9c72]">{score} pt</span>
          </div>
          <div className="text-right">
            <span className="text-xs text-[#8c7a6b] block font-medium">問題</span>
            <span className="text-sm font-semibold text-[#5c4e4d]">{currentQuestionIndex + 1} / {stage.words.length}</span>
          </div>
          <button
            id="abort-game-button"
            onClick={onBackToMenu}
            className="text-xs text-[#8c7a6b] hover:text-[#5c4e4d] transition-colors border border-[#dfd8cd] hover:border-[#8c7a6b] rounded px-2.5 py-1"
          >
            中断する
          </button>
        </div>
      </div>

      {/* メインレイアウト - 最大幅を抑えて中央寄せ、余計なパディングを排除して1画面に収める */}
      <div className="flex-1 max-w-4xl w-full mx-auto p-4 flex flex-col justify-center">
        
        {/* メインカード (スクロールレスにするため余白を詰める) */}
        <div className="bg-[#faf8f5] p-5 rounded-2xl border border-[#e6dfd5] shadow-xs flex flex-col gap-4">
          
          {/* 上部：お題ヘッダーと制限時間タイマー (レベル3以上) */}
          <div className="flex justify-between items-center pb-2 border-b border-[#f0ece1]">
            <span className="text-[11px] text-[#8c7a6b] uppercase font-bold tracking-wider">お題</span>
            {hasTimer && (
              <div className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                timeLeft <= 5 ? 'bg-[#f2dedb] text-[#b45a55] animate-pulse' : 'bg-[#f0ece1] text-[#5c4e4d]'
              }`}>
                <Timer className="w-3 h-3" />
                残り {timeLeft} 秒
              </div>
            )}
          </div>

          {/* 1. 読み取りタイピングコースの超スリム表示 */}
          {stage.course === 'typing' && (
            <div className="py-4 space-y-5 max-w-md mx-auto w-full">
              <div className="text-center">
                <span className="text-[#8c7a6b] text-xs block mb-1 font-medium">この手話の意味は何ですか？</span>
                <h2 id="question-word" className="text-3xl font-extrabold text-[#4a3e3d] tracking-wide mb-2">
                  「 {currentWord.word} 」
                </h2>
              </div>

              <form id="typing-form" onSubmit={handleTypingSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#8c7a6b] uppercase tracking-wider mb-2 flex items-center justify-center gap-1.5">
                    <Keyboard className="w-4 h-4 text-[#8c7a6b]" />
                    ローマ字でタイピング（小文字）:
                  </label>
                  <input
                    type="text"
                    id="typing-input-field"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder={`「 ${currentWord.romaji} 」と入力してください`}
                    autoFocus
                    disabled={hasFailedThisQuestion}
                    className="w-full px-4 py-2.5 bg-[#faf8f5] border border-[#e6dfd5] rounded-xl font-mono text-base focus:outline-none focus:border-[#8c7a6b] focus:bg-white transition-all text-center tracking-wide"
                  />
                </div>

                <button
                  type="submit"
                  id="typing-submit-button"
                  disabled={hasFailedThisQuestion || !inputValue}
                  className="w-full py-2.5 bg-[#8c7a6b] hover:bg-[#78695c] disabled:bg-[#dfd8cd] text-white font-bold text-sm rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2"
                >
                  回答を決定する
                </button>

                {hasFailedThisQuestion && (
                  <div className="text-center py-1 text-[#b45a55] font-bold flex items-center justify-center gap-1.5 animate-pulse text-xs">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {stage.level === 5 ? '間違っています！ペナルティでスコアが半減しました' : '間違っています！'}
                  </div>
                )}
              </form>
            </div>
          )}

          {/* 2. 手話ジェスチャーコース ＆ チュートリアルコース：超コンパクト2カラムレイアウト */}
          {(stage.course === 'gesture' || stage.course === 'tutorial') && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
              
              {/* 左側：お題 ＆ 動作ヒント ＆ 解答操作UI (7カラム) */}
              <div className="md:col-span-7 space-y-4">
                <div className="text-left">
                  <span className="text-[10px] text-[#8c7a6b] font-bold uppercase tracking-wider block">現在のお題</span>
                  <h2 id="question-word" className="text-2xl font-extrabold text-[#4a3e3d] tracking-wide mt-1 mb-2">
                    「 {currentWord.word} 」
                  </h2>

                  {/* 動作テキストヒント (難易度レベル4以上では非表示に) */}
                  {showHelper ? (
                    <div className="bg-[#f5f1e9] p-3 rounded-xl border border-[#e6dfd5] text-xs leading-relaxed text-[#5c4e4d]">
                      <span className="font-bold text-[#8c7a6b] block mb-0.5">【手話の動作ヒント】</span>
                      {currentWord.description}
                    </div>
                  ) : (
                    <div className="bg-[#f5f1e9] p-3 rounded-xl border border-dashed border-[#dfd8cd] text-xs text-[#8c7a6b] flex items-center gap-1.5">
                      <EyeOff className="w-4 h-4 shrink-0 text-[#8c7a6b]" />
                      <span>動作ヒント非表示（レベル4以上）。記憶を頼りに実演してください！</span>
                    </div>
                  )}
                </div>

                <div className="border-t border-[#f0ece1] pt-3">
                  
                  {/* チュートリアルコース進行 */}
                  {stage.course === 'tutorial' && (
                    <div className="space-y-3">
                      <div className="bg-[#f3eee5] p-3 rounded-xl border border-[#dfd8cd] text-[#5c4e4d] text-xs leading-relaxed">
                        <span className="font-bold text-[#8c7a6b] block mb-0.5">チュートリアル手順:</span>
                        右のミニカメラに手を映してください。骨格判定が表示されれば、認識環境のセットアップは完了です！準備ができたら「次へ進む」を押してください。
                      </div>
                      
                      {hasAnswered ? (
                        <div className="flex items-center justify-center gap-1.5 text-emerald-700 font-bold bg-emerald-50 py-2 rounded-xl border border-emerald-200 text-xs">
                          <Check className="w-4 h-4 animate-bounce" />
                          準備完了！次の設問に進みます。
                        </div>
                      ) : (
                        <button
                          id="tutorial-next-button"
                          onClick={handleTutorialNext}
                          className="w-full py-2.5 bg-[#8c7a6b] hover:bg-[#78695c] text-white font-bold rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5 text-xs"
                        >
                          確認して次へ進む
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}

                  {/* 手話ジェスチャーコース解答制御 */}
                  {stage.course === 'gesture' && (() => {
                    // 現在のお題単語に学習サンプルが登録されているか
                    let hasLearningSample = false;
                    try {
                      const stored = localStorage.getItem('sign_learning_samples');
                      if (stored) {
                        const samples = JSON.parse(stored);
                        hasLearningSample = Array.isArray(samples[currentWord.word]) && samples[currentWord.word].length > 0;
                      }
                    } catch (e) {
                      // ignore
                    }

                    return (
                      <div className="space-y-3">
                        {/* 未スタート ＆ 準備状態 */}
                        {isTestReady && !isTestCountingDown && !isMeasuring && (
                          <div className="space-y-3">
                            <button
                              id="start-gesture-test-button"
                              onClick={handleStartGestureTest}
                              className="w-full py-3 bg-[#8c7a6b] hover:bg-[#78695c] text-white font-bold text-sm rounded-xl shadow-xs transition-all transform hover:-translate-y-0.5 duration-200 cursor-pointer flex items-center justify-center gap-1.5"
                            >
                              <Play className="w-4 h-4 fill-current" />
                              解答を開始する（3秒計測）
                            </button>

                            {/* 学習データがない場合の警告インジケーター */}
                            {!hasLearningSample && (
                              <div className="bg-[#fcf8e3] border border-[#fbeed5] text-[#c09853] text-[10px] p-2.5 rounded-lg flex items-start gap-1 leading-relaxed">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-[#c09853] mt-0.5" />
                                <span>
                                  <strong>AI学習データ未登録:</strong> このお題の登録データがありません。簡易判定が行われます。エディットモードで事前に学習させると高精度に判定されます。
                                </span>
                              </div>
                            )}

                            {/* 開発・デバッグ用の即座成功ボタン */}
                            <div className="text-right">
                              <button
                                id="instant-correct-button"
                                onClick={triggerInstantCorrect}
                                className="text-[10px] text-[#8c7a6b] hover:text-[#5c4e4d] hover:underline cursor-pointer"
                              >
                                【開発用】即座に正解判定にする
                              </button>
                            </div>
                          </div>
                        )}

                        {/* 準備カウントダウン中 */}
                        {isTestCountingDown && (
                          <div className="bg-[#eae4da] border border-[#dfd8cd] p-4 rounded-xl text-center space-y-1 animate-pulse">
                            <span className="text-[10px] font-bold text-[#8c7a6b] uppercase tracking-wider block">準備カウントダウン</span>
                            <div id="gesture-countdown" className="text-3xl font-extrabold text-[#8c7a6b] tracking-wider">
                              {testCountdown}
                            </div>
                            <p className="text-xs font-medium text-[#5c4e4d]">
                              ミニカメラの前に手を構えて初期姿勢を整えてください！
                            </p>
                          </div>
                        )}

                        {/* 解答サンプリング計測中 */}
                        {isMeasuring && (
                          <div className="bg-[#eae4da] border-2 border-[#8c7a6b] p-4 rounded-xl text-center space-y-2.5">
                            <div className="flex justify-between items-center text-[10px] font-bold text-[#8c7a6b] uppercase tracking-wider">
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                                トラッキング中...
                              </span>
                              <span>残り {measuringTimeLeft} 秒</span>
                            </div>
                            
                            {/* プログレスバー */}
                            <div className="w-full bg-[#f0ece1] h-1.5 rounded-full overflow-hidden border border-[#dfd8cd]">
                              <div
                                id="measuring-progress-bar"
                                className="bg-red-500 h-full transition-all duration-100 ease-linear"
                                style={{ width: `${((3.0 - measuringTimeLeft) / 3.0) * 100}%` }}
                              />
                            </div>

                            <p className="text-base font-bold text-[#4a3e3d] animate-bounce">
                              「{currentWord.word}」の手話を実演してください！
                            </p>
                          </div>
                        )}

                        {/* 判定結果ステータスの演出 */}
                        {!isTestReady && !isTestCountingDown && !isMeasuring && testResultStatus !== 'idle' && (
                          <div className={`p-4 rounded-xl text-center space-y-1 border ${
                            testResultStatus === 'success' 
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                              : 'bg-red-50 border-red-200 text-red-800'
                          }`}>
                            {testResultStatus === 'success' ? (
                              <>
                                <div className="flex justify-center items-center gap-1.5 text-base font-extrabold">
                                  <Check className="w-5 h-5 animate-bounce" />
                                  正解です！
                                </div>
                                <p className="text-xs">動きが登録データと一致しました！次の問題に進みます。</p>
                              </>
                            ) : (
                              <>
                                <div className="flex justify-center items-center gap-1.5 text-base font-extrabold">
                                  <AlertTriangle className="w-5 h-5 animate-pulse" />
                                  判定不一致（エラー）
                                </div>
                                <p className="text-xs">
                                  もう一度「解答を開始する」ボタンを押して、3秒間しっかりと動かしてください。
                                </p>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                </div>
              </div>

              {/* 右側：従来の約半分のサイズに縮小されたミニカメラプレビュー (5カラム) */}
              <div className="md:col-span-5 flex flex-col items-center">
                <div className="bg-[#f5f1e9] p-3 rounded-xl border border-[#e6dfd5] w-full max-w-[260px] shadow-2xs">
                  <div className="flex justify-between items-center mb-1.5 text-[10px] font-bold text-[#5c4e4d]">
                    <span className="flex items-center gap-1">
                      <Camera className="w-3.5 h-3.5 text-[#8c7a6b]" />
                      ミニプレビュー
                    </span>
                    <span className={`w-2 h-2 rounded-full ${cameraActive ? 'bg-emerald-500 animate-pulse' : 'bg-[#b45a55]'}`} />
                  </div>

                  <div className="relative aspect-video bg-[#3a3530] rounded-lg overflow-hidden border border-[#dfd8cd] flex items-center justify-center text-white">
                    {cameraError ? (
                      <div className="text-center p-3 text-[#eae4da]">
                        <EyeOff className="w-6 h-6 mx-auto mb-1 text-[#b45a55]" />
                        <p className="text-[10px] font-bold text-[#b45a55]">カメラ未許可</p>
                      </div>
                    ) : (
                      <div className="relative w-full h-full">
                        <video
                          id="webcam-stream"
                          ref={setVideoRef}
                          autoPlay
                          playsInline
                          muted
                          className="w-full h-full object-cover scale-x-[-1]"
                        />
                        <canvas
                          ref={canvasRef}
                          className="absolute top-0 left-0 w-full h-full object-cover scale-x-[-1] pointer-events-none"
                          width={640}
                          height={480}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

            </div>
          )}

        </div>

      </div>

    </div>
  );
}
