import React, { useState, useEffect, useRef } from 'react';
import { Stage, SignWord, CourseType } from '../types';
import { loadStages, saveStages, createDefaultStages } from '../data';
import { Save, RotateCcw, Settings, Camera, Trash2, Undo, Upload, Download, Check, HelpCircle, ChevronDown, ChevronUp } from 'lucide-react';

interface EditModeProps {
  onClose: () => void;
}

export default function EditMode({ onClose }: EditModeProps) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<CourseType>('tutorial');
  const [selectedLevel, setSelectedLevel] = useState<number>(1);
  const [editWords, setEditWords] = useState<SignWord[]>([]);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  // 1画面に収めるためのアクティブな問題のインデックス
  const [activeWordIndex, setActiveWordIndex] = useState<number>(0);

  // AIトラッキング学習用の状態
  const [learningWord, setLearningWord] = useState<string>('こんにちは');
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [landmarksCount, setLandmarksCount] = useState<number>(0);
  const [learningSamples, setLearningSamples] = useState<Record<string, any[][]>>(() => {
    const saved = localStorage.getItem('sign_learning_samples');
    return saved ? JSON.parse(saved) : {
      'こんにちは': [],
      'ありがとう': [],
      'さようなら': [],
      'だめ': [],
      'いいよ': [],
      'すみません': []
    };
  });

  // 3秒カウントダウン & 3秒サンプリング用の状態
  const [countdown, setCountdown] = useState<number>(0);
  const [isCountingDown, setIsCountingDown] = useState<boolean>(false);
  const [isSampling, setIsSampling] = useState<boolean>(false);
  const [samplingTimeLeft, setSamplingTimeLeft] = useState<number>(3.0);

  // 時系列データ蓄積用のRef
  const samplingBufferRef = useRef<any[]>([]);
  const isSamplingRef = useRef<boolean>(false);

  // GitHub連携用の状態
  const [githubToken, setGithubToken] = useState<string>(() => localStorage.getItem('github_token') || '');
  const [githubRepo, setGithubRepo] = useState<string>(() => localStorage.getItem('github_repo') || '');
  const [githubPath, setGithubPath] = useState<string>(() => localStorage.getItem('github_path') || 'sign_learning_samples.json');
  const [showGithubSettings, setShowGithubSettings] = useState<boolean>(false);
  const [githubStatus, setGithubStatus] = useState<string>('');

  // カメラ・MediaPipe参照
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const latestLandmarks = useRef<any>(null);

  // データの初期ロード
  useEffect(() => {
    const loaded = loadStages();
    setStages(loaded);
  }, []);

  // カウントダウンタイマー制御
  useEffect(() => {
    let timer: any;
    if (isCountingDown) {
      timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            setIsCountingDown(false);
            startSampling(); // 3秒カウントダウン終了後にサンプリング開始
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isCountingDown]);

  // サンプリング開始（3秒間計測）
  const startSampling = () => {
    setIsSampling(true);
    isSamplingRef.current = true;
    setSamplingTimeLeft(3.0);
    samplingBufferRef.current = [];

    let timeLeft = 3.0;
    const interval = setInterval(() => {
      timeLeft = Math.max(0, timeLeft - 0.1);
      setSamplingTimeLeft(parseFloat(timeLeft.toFixed(1)));

      if (timeLeft <= 0) {
        clearInterval(interval);
        setIsSampling(false);
        isSamplingRef.current = false;

        // サンプリングバッファが空でなければ学習データを登録
        if (samplingBufferRef.current.length === 0) {
          alert('サンプリング期間中、カメラに手が検出されませんでした。もう一度試してください。');
          return;
        }

        const currentSamples = learningSamples[learningWord] || [];
        const updated = {
          ...learningSamples,
          [learningWord]: [...currentSamples, [...samplingBufferRef.current]] // 時系列フレーム群（一連の流れ）を1サンプルとして追加
        };
        saveSamples(updated);
        setGithubStatus('一時保存されました（未エクスポート）');
      }
    }, 100);
  };

  // コースやレベルが変更されたら、対象の編集用単語を抽出
  useEffect(() => {
    if (stages.length > 0) {
      const stage = stages.find(s => s.course === selectedCourse && s.level === selectedLevel);
      if (stage) {
        setEditWords(JSON.parse(JSON.stringify(stage.words))); // ディープコピー
      } else {
        setEditWords([]);
      }
    }
  }, [selectedCourse, selectedLevel, stages]);

  // 特定の単語のフィールド変更
  const handleWordChange = (index: number, field: keyof SignWord, value: string) => {
    const updated = [...editWords];
    updated[index] = {
      ...updated[index],
      [field]: value
    };
    setEditWords(updated);
  };

  // 編集データの保存
  const handleSave = () => {
    const updatedStages = stages.map(s => {
      if (s.course === selectedCourse && s.level === selectedLevel) {
        return {
          ...s,
          words: editWords
        };
      }
      return s;
    });

    setStages(updatedStages);
    saveStages(updatedStages);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  // 初期値（デフォルト）リセット
  const handleResetDefaults = () => {
    if (window.confirm('すべてのステージデータをデフォルトの初心者向け単語にリセットします。よろしいですか？')) {
      const defaults = createDefaultStages();
      setStages(defaults);
      saveStages(defaults);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    }
  };

  // サンプルデータの保存
  const saveSamples = (newData: Record<string, any[][]>) => {
    setLearningSamples(newData);
    localStorage.setItem('sign_learning_samples', JSON.stringify(newData));
  };

  // サンプリング開始（カウントダウン起動）
  const handleAddSample = () => {
    if (!cameraActive) {
      alert('カメラを起動してください。');
      return;
    }
    setIsCountingDown(true);
    setCountdown(3);
    setIsSampling(false);
    samplingBufferRef.current = [];
    isSamplingRef.current = false;
  };

  // 一つ前の学習を忘れる（履歴巻き戻し・アンドゥ）
  const handleUndoSample = () => {
    const currentSamples = learningSamples[learningWord] || [];
    if (currentSamples.length === 0) {
      alert('消去できる学習データ履歴がありません。');
      return;
    }
    const updatedSamples = [...currentSamples];
    updatedSamples.pop(); // 直前の1件を削除
    const updated = {
      ...learningSamples,
      [learningWord]: updatedSamples
    };
    saveSamples(updated);
    setGithubStatus('直前のデータを削除しました');
  };

  // 選択単語の学習データリセット
  const handleResetWordSamples = () => {
    if (window.confirm(`「${learningWord}」の学習データをすべて消去し、デフォルトの認識基準に戻します。よろしいですか？`)) {
      const updated = {
        ...learningSamples,
        [learningWord]: []
      };
      saveSamples(updated);
      setGithubStatus('学習データをリセットしました');
    }
  };

  // GitHubへエクスポート
  const handleExportToGithub = async () => {
    if (!githubToken || !githubRepo) {
      alert('GitHub個人用アクセストークン（PAT）とリポジトリ名を設定してください。');
      return;
    }
    setGithubStatus('エクスポート中...');
    try {
      const url = `https://api.github.com/repos/${githubRepo}/contents/${githubPath}`;
      const headers: HeadersInit = {
        'Authorization': `token ${githubToken}`,
        'Content-Type': 'application/json'
      };

      let sha = '';
      const getRes = await fetch(url, { headers });
      if (getRes.ok) {
        const fileInfo = await getRes.json();
        sha = fileInfo.sha;
      }

      const content = btoa(unescape(encodeURIComponent(JSON.stringify(learningSamples, null, 2))));
      const body = {
        message: 'Update sign language learning samples via Game Edit Mode',
        content,
        sha: sha || undefined
      };

      const putRes = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body)
      });

      if (putRes.ok) {
        setGithubStatus('GitHubに学習データを保存しました！');
        localStorage.setItem('github_token', githubToken);
        localStorage.setItem('github_repo', githubRepo);
        localStorage.setItem('github_path', githubPath);
      } else {
        const errData = await putRes.json();
        setGithubStatus(`エラー: ${errData.message}`);
      }
    } catch (e: any) {
      console.error(e);
      setGithubStatus(`通信エラー: ${e.message}`);
    }
  };

  // GitHubからインポート
  const handleImportFromGithub = async () => {
    if (!githubToken || !githubRepo) {
      alert('GitHub個人用アクセストークン（PAT）とリポジトリ名を設定してください。');
      return;
    }
    setGithubStatus('インポート中...');
    try {
      const url = `https://api.github.com/repos/${githubRepo}/contents/${githubPath}`;
      const headers = { 'Authorization': `token ${githubToken}` };

      const res = await fetch(url, { headers });
      if (res.ok) {
        const fileInfo = await res.json();
        const decodedContent = decodeURIComponent(escape(atob(fileInfo.content)));
        const data = JSON.parse(decodedContent);
        saveSamples(data);
        setGithubStatus('GitHubから学習データを同期しました！');
        localStorage.setItem('github_token', githubToken);
        localStorage.setItem('github_repo', githubRepo);
        localStorage.setItem('github_path', githubPath);
      } else {
        const errData = await res.json();
        setGithubStatus(`読込失敗: ${errData.message}`);
      }
    } catch (e: any) {
      console.error(e);
      setGithubStatus(`通信エラー: ${e.message}`);
    }
  };

  // カメラ・MediaPipeセットアップ
  useEffect(() => {
    if (!cameraActive) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      return;
    }

    const Hands = (window as any).Hands;
    const Camera = (window as any).Camera;
    const drawConnectors = (window as any).drawConnectors;
    const drawLandmarks = (window as any).drawLandmarks;
    const HAND_CONNECTIONS = (window as any).HAND_CONNECTIONS;

    if (!Hands || !Camera) {
      console.warn('MediaPipe Hands is not loaded yet.');
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
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        setLandmarksCount(results.multiHandLandmarks.length);
        latestLandmarks.current = results.multiHandLandmarks;

        // サンプリング中であれば、ディープコピーした関節データをバッファに追加
        if (isSamplingRef.current) {
          samplingBufferRef.current.push(JSON.parse(JSON.stringify(results.multiHandLandmarks)));
        }

        for (const landmarks of results.multiHandLandmarks) {
          drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: '#8c7a6b', lineWidth: 4 });
          drawLandmarks(ctx, landmarks, { color: '#bf9c72', lineWidth: 2 });
        }
      } else {
        setLandmarksCount(0);
        latestLandmarks.current = null;
        // 手が検出されない場合でも、時系列データのタイミングずれを防ぐため
        // サンプリング中であれば空の配列またはnullを挿入し、位置・存在なしを記録
        if (isSamplingRef.current) {
          samplingBufferRef.current.push(null);
        }
      }
    });

    let cameraInstance: any = null;
    navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
      .then(stream => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          cameraInstance = new Camera(videoRef.current, {
            onFrame: async () => {
              if (videoRef.current) {
                await hands.send({ image: videoRef.current });
              }
            },
            width: 640,
            height: 480
          });
          cameraInstance.start();
        }
      })
      .catch(err => {
        console.error(err);
        alert('カメラの起動に失敗しました。');
      });

    return () => {
      active = false;
      if (cameraInstance) {
        cameraInstance.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, [cameraActive]);

  return (
    <div id="edit-mode-container" className="min-h-screen bg-[#f7f5f0] text-[#4a3e3d] p-4 font-sans flex flex-col justify-center">
      <div className="max-w-6xl w-full mx-auto bg-[#faf8f5] rounded-2xl border border-[#e6dfd5] p-6 shadow-xs flex flex-col gap-6">
        
        {/* ヘッダー */}
        <div className="flex justify-between items-center border-b border-[#f0ece1] pb-3">
          <div>
            <h2 id="edit-mode-title" className="text-xl font-bold text-[#4a3e3d] flex items-center gap-2">
              <Settings className="w-5 h-5 text-[#8c7a6b]" />
              エディットモード
            </h2>
            <p className="text-xs text-[#8c7a6b]">
              各コースとレベルの組み合わせで出題される手話単語の編集と、手の骨格を認識させるAIトラッキング学習を行います。
            </p>
          </div>
          <button
            id="close-edit-button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#eae4da] hover:bg-[#dfd8cd] text-[#5c4e4d] text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            閉じる
          </button>
        </div>

        {/* 2カラムレイアウト (スクロールレス) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* 左側カラム (ステージデータ編集) - 5カラム */}
          <div className="lg:col-span-5 space-y-4">
            <h3 className="text-sm font-bold text-[#4a3e3d] border-b border-[#f0ece1] pb-1.5 flex items-center gap-1.5">
              ステージデータ編集
            </h3>

            {/* コース＆難易度 セレクター */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#f5f1e9] p-2.5 rounded-xl border border-[#e6dfd5]">
                <label className="block text-[10px] font-bold text-[#8c7a6b] uppercase tracking-wider mb-1">コース選択</label>
                <select
                  id="course-select-dropdown"
                  value={selectedCourse}
                  onChange={(e) => setSelectedCourse(e.target.value as CourseType)}
                  className="w-full text-xs font-semibold bg-white border border-[#e6dfd5] rounded px-2 py-1 focus:outline-none focus:border-[#8c7a6b]"
                >
                  <option value="tutorial">チュートリアル</option>
                  <option value="gesture">手話ジェスチャー</option>
                  <option value="typing">読み取りタイピング</option>
                </select>
              </div>

              <div className="bg-[#f5f1e9] p-2.5 rounded-xl border border-[#e6dfd5]">
                <label className="block text-[10px] font-bold text-[#8c7a6b] uppercase tracking-wider mb-1">難易度選択</label>
                <div className="flex gap-1 justify-between">
                  {[1, 2, 3, 4, 5].map(level => (
                    <button
                      key={level}
                      id={`level-select-btn-${level}`}
                      onClick={() => setSelectedLevel(level)}
                      className={`w-7 h-7 flex items-center justify-center text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                        selectedLevel === level
                          ? 'bg-[#8c7a6b] text-white border-[#8c7a6b]'
                          : 'bg-white text-[#5c4e4d] border-[#e6dfd5] hover:bg-[#fcfbf9]'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 単語編集：5つの問題をタブで切り替える (スクロール削減) */}
            <div className="bg-white p-4 rounded-xl border border-[#e6dfd5] space-y-3 shadow-2xs">
              <div className="flex justify-between items-center border-b border-[#f0ece1] pb-2">
                <span className="text-xs font-bold text-[#5c4e4d]">出題ワード (全5問)</span>
                <div className="flex gap-1">
                  {[0, 1, 2, 3, 4].map(idx => (
                    <button
                      key={idx}
                      id={`word-tab-btn-${idx}`}
                      onClick={() => setActiveWordIndex(idx)}
                      className={`w-6 h-6 flex items-center justify-center text-xs font-bold rounded transition-colors ${
                        activeWordIndex === idx
                          ? 'bg-[#8c7a6b] text-white'
                          : 'bg-[#f5f1e9] text-[#5c4e4d] hover:bg-[#eae4da]'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
              </div>

              {editWords[activeWordIndex] && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] text-[#8c7a6b] font-bold mb-1">手話単語 (表示名)</label>
                    <input
                      type="text"
                      id="edit-word-name"
                      value={editWords[activeWordIndex].word}
                      onChange={(e) => handleWordChange(activeWordIndex, 'word', e.target.value)}
                      placeholder="例: こんにちは"
                      className="w-full px-3 py-1 bg-[#faf8f5] border border-[#e6dfd5] rounded-lg text-xs focus:outline-none focus:border-[#8c7a6b] transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-[#8c7a6b] font-bold mb-1">ローマ字読み (タイピング用・小文字英字)</label>
                    <input
                      type="text"
                      id="edit-word-romaji"
                      value={editWords[activeWordIndex].romaji}
                      onChange={(e) => handleWordChange(activeWordIndex, 'romaji', e.target.value.toLowerCase())}
                      placeholder="例: konnichiha"
                      className="w-full px-3 py-1 bg-[#faf8f5] border border-[#e6dfd5] rounded-lg text-xs focus:outline-none focus:border-[#8c7a6b] transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-[#8c7a6b] font-bold mb-1">ジェスチャー説明（お手本テキスト）</label>
                    <textarea
                      id="edit-word-desc"
                      value={editWords[activeWordIndex].description}
                      onChange={(e) => handleWordChange(activeWordIndex, 'description', e.target.value)}
                      placeholder="ジェスチャーの動きを説明します。"
                      rows={2}
                      className="w-full px-3 py-1 bg-[#faf8f5] border border-[#e6dfd5] rounded-lg text-xs focus:outline-none focus:border-[#8c7a6b] transition-colors resize-none"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* ステージ保存・リセット */}
            <div className="flex justify-between gap-2 pt-2">
              <button
                id="reset-stage-button"
                onClick={handleResetDefaults}
                className="flex items-center gap-1 px-3 py-2 bg-[#f5f1e9] hover:bg-[#f2dedb] text-[#5c4e4d] hover:text-[#b45a55] text-xs font-semibold rounded-lg border border-[#e6dfd5] transition-all cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                リセット
              </button>

              <div className="flex items-center gap-2">
                {saveSuccess && (
                  <span className="text-emerald-700 text-xs font-bold animate-pulse">保存完了しました</span>
                )}
                <button
                  id="save-stage-button"
                  onClick={handleSave}
                  className="flex items-center gap-1 px-4 py-2 bg-[#8c7a6b] hover:bg-[#78695c] text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  ステージを保存
                </button>
              </div>
            </div>
          </div>

          {/* 右側カラム (AIトラッキング学習) - 7カラム */}
          <div className="lg:col-span-7 space-y-4">
            <h3 className="text-sm font-bold text-[#4a3e3d] border-b border-[#f0ece1] pb-1.5 flex items-center justify-between">
              <span>AIトラッキング学習</span>
              <span className="text-[10px] text-[#8c7a6b] font-normal">認識アルゴリズムのサンプリング & 調整</span>
            </h3>

            {/* 自動保存のヒントボックス */}
            <div className="bg-[#eef6f3] text-[#2e5b47] p-3 rounded-xl border border-[#d1e7dd] text-xs leading-relaxed space-y-1 shadow-2xs">
              <span className="font-bold flex items-center gap-1 text-[#224b37]">
                💡 学習データは自動保存されています（追加設定は不要です）
              </span>
              <p>
                「学習データ登録」ボタンを押して撮影した手話モーションは、<strong>お使いのブラウザ（LocalStorage）に即座に自動保存されます。</strong> 
                特別なアカウント設定をすることなく、ゲームプレイに即座に反映されますので、ご安心ください。
              </p>
            </div>

            {/* 対象単語の選択 ＆ カメラON/OFF */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-[#f5f1e9] p-2.5 rounded-xl border border-[#e6dfd5] flex items-center justify-between gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] font-bold text-[#8c7a6b] mb-1">学習対象の手話</label>
                  <select
                    id="learning-word-select"
                    value={learningWord}
                    onChange={(e) => setLearningWord(e.target.value)}
                    className="w-full text-xs font-semibold bg-white border border-[#e6dfd5] rounded px-2 py-1 focus:outline-none focus:border-[#8c7a6b]"
                  >
                    {['こんにちは', 'ありがとう', 'さようなら', 'だめ', 'いいよ', 'すみません'].map(w => (
                      <option key={w} value={w}>{w}</option>
                    ))}
                  </select>
                </div>
                <div className="text-right whitespace-nowrap min-w-[70px]">
                  <span className="text-[10px] font-bold text-[#8c7a6b] block">登録データ</span>
                  <span id="samples-count" className="text-sm font-extrabold text-[#8c7a6b]">
                    {(learningSamples[learningWord] || []).length} 件
                  </span>
                </div>
              </div>

              <div className="bg-[#f5f1e9] p-2.5 rounded-xl border border-[#e6dfd5] flex items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <span className="text-[10px] font-bold text-[#8c7a6b] block">Webカメラ</span>
                  <span className="text-[11px] text-[#5c4e4d]">手のトラッキングを起動します</span>
                </div>
                <button
                  id="camera-toggle-btn"
                  onClick={() => setCameraActive(!cameraActive)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                    cameraActive 
                      ? 'bg-[#b45a55] text-white hover:bg-[#a14b46]' 
                      : 'bg-[#8c7a6b] text-white hover:bg-[#78695c]'
                  }`}
                >
                  <Camera className="w-3.5 h-3.5" />
                  {cameraActive ? 'カメラOFF' : 'カメラON'}
                </button>
              </div>
            </div>

            {/* トラッキングプレビュー窓 */}
            <div className="aspect-video bg-[#2c2825] rounded-xl overflow-hidden border border-[#e6dfd5] relative flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="hidden"
              />
              <canvas
                ref={canvasRef}
                width={640}
                height={480}
                className="w-full h-full object-cover scale-x-[-1]"
              />
              
              {!cameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4 bg-[#2c2825]/95 text-[#c7bfb4]">
                  <Camera className="w-10 h-10 mb-2 text-[#8c7a6b]" />
                  <p className="text-xs font-bold">カメラが停止しています</p>
                  <p className="text-[10px] mt-1 text-[#8c7a6b]">「カメラON」を押すとリアルタイムの関節トラッキングが開始されます。</p>
                </div>
              )}

              {cameraActive && (
                <div className="absolute top-2 left-2 bg-[#1f1a17]/80 text-[10px] text-white px-2 py-0.5 rounded-md flex items-center gap-1.5 border border-[#8c7a6b]/30">
                  <span className={`w-1.5 h-1.5 rounded-full ${landmarksCount > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                  {landmarksCount > 0 ? `手部検出中 (手: ${landmarksCount})` : '手をカメラに映してください'}
                </div>
              )}

              {/* カウントダウン表示オーバーレイ */}
              {cameraActive && isCountingDown && (
                <div className="absolute inset-0 bg-[#2c2825]/85 flex flex-col items-center justify-center text-center z-10">
                  <div className="text-[#bf9c72] text-xs font-bold tracking-wider uppercase mb-3 animate-pulse">
                    手話の動きの準備をしてください...
                  </div>
                  <div className="w-16 h-16 bg-[#8c7a6b] text-white font-extrabold text-3xl rounded-full flex items-center justify-center border-2 border-white shadow-md animate-bounce">
                    {countdown}
                  </div>
                </div>
              )}

              {/* サンプリング中表示オーバーレイ */}
              {cameraActive && isSampling && (
                <div className="absolute inset-0 bg-[#b45a55]/10 pointer-events-none border-4 border-[#b45a55] z-10 flex flex-col justify-between p-4">
                  <div className="flex items-center bg-black/60 text-white px-2.5 py-1 rounded-md text-[10px] font-bold self-start border border-red-500/20">
                    <span className="w-2 h-2 rounded-full bg-[#b45a55] mr-1.5 animate-pulse" />
                    手話動作を連続記録中...残り {samplingTimeLeft}s
                  </div>
                  
                  {/* 下部プログレスバー */}
                  <div className="w-full bg-black/40 h-2 rounded-full overflow-hidden border border-white/20">
                    <div 
                      className="bg-[#b45a55] h-full transition-all duration-75" 
                      style={{ width: `${(samplingTimeLeft / 3.0) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 学習操作・GitHub連携ボタン群 */}
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  id="add-sample-btn"
                  onClick={handleAddSample}
                  disabled={!cameraActive || isCountingDown || isSampling}
                  className={`flex-1 min-w-[120px] py-2 bg-[#8c7a6b] hover:bg-[#78695c] disabled:bg-[#eae4da] text-white disabled:text-[#c7bfb4] text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1 cursor-pointer`}
                >
                  <Check className="w-3.5 h-3.5" />
                  {isCountingDown ? `撮影開始まで ${countdown}秒` : isSampling ? `記録中 (${samplingTimeLeft}秒)` : '学習データ登録（サンプリング）'}
                </button>

                <button
                  id="undo-sample-btn"
                  onClick={handleUndoSample}
                  disabled={(learningSamples[learningWord] || []).length === 0}
                  className="px-3 py-2 bg-[#f5f1e9] hover:bg-[#eae4da] disabled:opacity-40 text-[#5c4e4d] text-xs font-semibold rounded-lg border border-[#e6dfd5] flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Undo className="w-3.5 h-3.5" />
                  一つ前の学習を忘れる
                </button>

                <button
                  id="reset-word-samples-btn"
                  onClick={handleResetWordSamples}
                  disabled={(learningSamples[learningWord] || []).length === 0}
                  className="px-3 py-2 bg-rose-50 hover:bg-rose-100 disabled:opacity-40 text-rose-700 text-xs font-semibold rounded-lg border border-rose-200 flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  学習クリア
                </button>
              </div>

              {/* GitHub連携 (アコーディオン式) */}
              <div className="bg-[#f5f1e9] rounded-xl border border-[#e6dfd5] overflow-hidden">
                <button
                  id="toggle-github-settings-btn"
                  onClick={() => setShowGithubSettings(!showGithubSettings)}
                  className="w-full px-3 py-2 text-left text-xs font-bold text-[#5c4e4d] flex justify-between items-center bg-[#eae4da]/30 hover:bg-[#eae4da]/60 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5 text-[#8c7a6b]" />
                    別PCとの同期・クラウド永続化（上級者向け・通常は不要）
                  </span>
                  {showGithubSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {showGithubSettings && (
                  <div className="p-3 space-y-3 border-t border-[#e6dfd5] bg-[#faf8f5]/50">
                    <div className="bg-[#fff3cd] text-[#664d03] p-2.5 rounded-lg border border-[#ffecb5] text-[10px] leading-relaxed">
                      <strong>💡 お読みください</strong><br />
                      この設定は、別のパソコンと学習データをクラウド経由で同期・バックアップしたい場合のみ利用します。
                      個人アクセストークン（PAT）やリポジトリの作成方法が分からない場合は、<strong>すべて空欄のままで問題ありません。</strong>
                      （通常通り「学習データ登録」を押すだけで自動的にブラウザに保存され動作します）
                    </div>
                    <p className="text-[10px] text-[#8c7a6b] leading-relaxed">
                      GitHubのJSONファイルとして学習特徴量を保存し、別環境でもインポート/エクスポートして同期できるようにします。
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[9px] font-bold text-[#8c7a6b] mb-1">個人アクセストークン(PAT)</label>
                        <input
                          type="password"
                          id="github-token"
                          value={githubToken}
                          onChange={(e) => setGithubToken(e.target.value)}
                          placeholder="ghp_xxxxxxxx"
                          className="w-full px-2 py-1 text-xs bg-white border border-[#e6dfd5] rounded focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-[#8c7a6b] mb-1">リポジトリ (ユーザ名/レポ)</label>
                        <input
                          type="text"
                          id="github-repo"
                          value={githubRepo}
                          onChange={(e) => setGithubRepo(e.target.value)}
                          placeholder="username/repo"
                          className="w-full px-2 py-1 text-xs bg-white border border-[#e6dfd5] rounded focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-[#8c7a6b] mb-1">保存ファイル名</label>
                        <input
                          type="text"
                          id="github-path"
                          value={githubPath}
                          onChange={(e) => setGithubPath(e.target.value)}
                          className="w-full px-2 py-1 text-xs bg-white border border-[#e6dfd5] rounded focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex justify-between items-center gap-2 pt-1 border-t border-[#f0ece1]">
                      <span id="github-status-msg" className="text-[10px] font-bold text-[#8c7a6b] flex items-center gap-1">
                        {githubStatus || '未同期'}
                      </span>
                      <div className="flex gap-2">
                        <button
                          id="github-import-btn"
                          onClick={handleImportFromGithub}
                          className="px-3 py-1 bg-white hover:bg-[#eae4da] text-[#5c4e4d] text-[10px] font-bold rounded border border-[#e6dfd5] flex items-center gap-1 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          GitHubから読込
                        </button>
                        <button
                          id="github-export-btn"
                          onClick={handleExportToGithub}
                          className="px-3 py-1 bg-[#8c7a6b] hover:bg-[#78695c] text-white text-[10px] font-bold rounded flex items-center gap-1 cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          GitHubへ保存
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
