import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

const API_BASE = import.meta.env.PROD ? '/api' : 'http://localhost:8000/api';

function App() {
  // Get Telegram WebApp reference (may be undefined in browser)
  const TelegramWebApp = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
  
  const [currentView, setCurrentView] = useState('home');
  const [selectedMode, setSelectedMode] = useState(null);
  const [cards, setCards] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState({ known: [], unknown: [] });
  const [stats, setStats] = useState(null);
  const [swipeDirection, setSwipeDirection] = useState(null);
  const [isExamMode, setIsExamMode] = useState(false);
  const [examResults, setExamResults] = useState(null);
  const [user, setUser] = useState({ id: 'anonymous', username: 'Guest' });
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [dragX, setDragX] = useState(0); // For card drag animation
  const [audioCards, setAudioCards] = useState([]);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState('');

  const touchStartX = useRef(0);
  const touchCurrentX = useRef(0);

  // Start in anonymous mode immediately
  useEffect(() => {
    // Always start as anonymous user
    fetchStats();
    fetchProgress();
    
    // Check if we're in Telegram and suggest login
    if (TelegramWebApp?.initDataUnsafe?.user) {
      setShowLoginPrompt(true);
    }
  }, []);

  const authenticate = async (initData, tgUser) => {
    try {
      const params = new URLSearchParams(initData);
      const userParam = params.get('user');
      const hash = params.get('hash');

      if (!userParam || !hash) {
        return false;
      }

      const res = await fetch(`${API_BASE}/auth/telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: tgUser, hash }),
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data);
        setShowLoginPrompt(false);
        fetchProgress(); // Reload progress for authenticated user
        return true;
      }
      return false;
    } catch (e) {
      console.error('Auth error:', e);
      return false;
    }
  };

  const handleLogin = () => {
    console.log('Login clicked', {
      hasTelegram: !!TelegramWebApp,
      hasInitData: !!TelegramWebApp?.initData,
      hasUser: !!TelegramWebApp?.initDataUnsafe?.user
    });
    
    if (TelegramWebApp?.initData && TelegramWebApp?.initDataUnsafe?.user) {
      authenticate(TelegramWebApp.initData, TelegramWebApp.initDataUnsafe.user);
    } else {
      console.warn('Telegram auth data not available');
      alert('Откройте приложение в Telegram для входа');
    }
  };

  const handleLogout = () => {
    setUser({ id: 'anonymous', username: 'Guest' });
    setShowLoginPrompt(false);
    fetchProgress();
  };

  const getAuthHeaders = () => {
    // Use user from state (works even after page refresh in Telegram)
    const tgUser = user?.telegram_id ? { id: user.telegram_id, username: user.username } : (TelegramWebApp?.initDataUnsafe?.user);
    if (!tgUser) return {};
    return { 'X-Telegram-User': JSON.stringify(tgUser) };
  };

  // Load data on mount
  useEffect(() => {
    fetchStats();
    fetchProgress();
  }, []);

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/stats`);
      const data = await res.json();
      setStats(data);
    } catch (e) {
      console.error('Failed to fetch stats:', e);
    }
  };

  const fetchProgress = async () => {
    try {
      const res = await fetch(`${API_BASE}/progress`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      setProgress(data);
    } catch (e) {
      console.error('Failed to fetch progress:', e);
    }
  };

  const fetchAudioCards = async () => {
    setIsAudioLoading(true);
    setAudioError('');

    try {
      const res = await fetch(`${API_BASE}/audio/cards`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setAudioCards(data);
    } catch (e) {
      console.error('Failed to fetch audio cards:', e);
      setAudioError('Не удалось загрузить аудио карточки');
    } finally {
      setIsAudioLoading(false);
    }
  };

  const resetProgress = async () => {
    if (!confirm('Вы уверены, что хотите сбросить весь прогресс?')) return;
    
    try {
      const res = await fetch(`${API_BASE}/progress/reset`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      
      if (res.ok) {
        setProgress({ known: [], unknown: [], total_known: 0, total_unknown: 0 });
        alert('Прогресс сброшен!');
      }
    } catch (e) {
      console.error('Failed to reset progress:', e);
      alert('Ошибка при сбросе прогресса');
    }
  };

  const startStudy = async (mode) => {
    setSelectedMode(mode);
    setIsExamMode(mode === 'exam');
    
    try {
      const params = new URLSearchParams({
        mode,
        known_ids: progress.known.join(','),
        unknown_ids: progress.unknown.join(','),
      });
      
      const res = await fetch(`${API_BASE}/cards?${params}`);
      const data = await res.json();
      setCards(data);
      setCurrentIndex(0);
      setExamResults(null);
      setCurrentView('study');
    } catch (e) {
      console.error('Failed to start study:', e);
    }
  };

  const openAudioMode = () => {
    setCurrentView('audio');
    fetchAudioCards();
  };

  const updateCardProgress = async (ruleId, status) => {
    const headers = {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    };
    
    try {
      const res = await fetch(`${API_BASE}/progress`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ rule_id: ruleId, status }),
      });
      
      if (res.ok && !isExamMode) {
        // Update local progress state immediately
        setProgress(prev => {
          const newKnown = status === 'known' 
            ? [...new Set([...prev.known, ruleId])]
            : prev.known.filter(id => id !== ruleId);
          const newUnknown = status === 'unknown'
            ? [...new Set([...prev.unknown, ruleId])]
            : prev.unknown.filter(id => id !== ruleId);
          return {
            known: newKnown,
            unknown: newUnknown,
            total_known: newKnown.length,
            total_unknown: newUnknown.length,
          };
        });
        
        // Also update global stats
        setStats(prev => {
          if (!prev) return prev;
          const isKnownChange = status === 'known';
          // Check if this card was already counted
          const wasUnknown = progress.unknown.includes(ruleId);
          const wasKnown = progress.known.includes(ruleId);
          
          return {
            ...prev,
            known: prev.known + (isKnownChange && !wasKnown ? 1 : 0),
            unknown: prev.unknown + (!isKnownChange && !wasUnknown && !wasKnown ? 1 : 0),
            not_started: prev.not_started - (!wasKnown && !wasUnknown ? 1 : 0),
          };
        });
      }
    } catch (e) {
      console.error('Failed to update progress:', e);
    }
  };

  const handleSwipe = useCallback((direction) => {
    if (currentIndex >= cards.length) return;

    setSwipeDirection(direction);
    const currentCard = cards[currentIndex];

    setTimeout(() => {
      if (isExamMode) {
        setExamResults(prev => {
          const newResults = prev || { correct: 0, incorrect: 0, details: [] };
          return {
            correct: direction === 'right' ? newResults.correct + 1 : newResults.correct,
            incorrect: direction === 'left' ? newResults.incorrect + 1 : newResults.incorrect,
            details: [...newResults.details, { cardId: currentCard.id, known: direction === 'right' }],
          };
        });
      } else {
        updateCardProgress(currentCard.id, direction === 'right' ? 'known' : 'unknown');
      }

      setSwipeDirection(null);
      setDragX(0); // Reset drag for next card
      setCurrentIndex(prev => prev + 1);
    }, 300);
  }, [currentIndex, cards, isExamMode]);

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    setDragX(0);
  };

  const handleTouchMove = (e) => {
    touchCurrentX.current = e.touches[0].clientX;
    const diff = touchCurrentX.current - touchStartX.current;
    setDragX(diff);
  };

  const handleTouchEnd = () => {
    const diff = touchCurrentX.current - touchStartX.current;
    const threshold = 100;

    if (diff > threshold) {
      handleSwipe('right');
    } else if (diff < -threshold) {
      handleSwipe('left');
    } else {
      // Return to center if not swiped far enough
      setDragX(0);
    }

    touchStartX.current = 0;
    touchCurrentX.current = 0;
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (currentView !== 'study') return;
      if (e.key === 'ArrowLeft') handleSwipe('left');
      if (e.key === 'ArrowRight') handleSwipe('right');
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentView, handleSwipe]);

  const currentCard = cards[currentIndex];
  const isComplete = currentIndex >= cards.length;

  return (
    <div className="app">
      {currentView === 'home' && (
        <HomeView
          stats={stats}
          user={user}
          showLoginPrompt={showLoginPrompt}
          onLogin={handleLogin}
          onLogout={handleLogout}
          onStartStudy={startStudy}
          onOpenAudio={openAudioMode}
          onViewStats={() => setCurrentView('stats')}
          progress={progress}
          onResetProgress={resetProgress}
        />
      )}
      
      {currentView === 'study' && (
        <StudyView
          mode={selectedMode}
          card={currentCard}
          currentIndex={currentIndex}
          totalCards={cards.length}
          swipeDirection={swipeDirection}
          dragX={dragX}
          isComplete={isComplete}
          examResults={examResults}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onSwipe={handleSwipe}
          onBack={() => setCurrentView('home')}
          onRestart={() => startStudy(selectedMode)}
        />
      )}
      
      {currentView === 'stats' && (
        <StatsView 
          progress={progress} 
          stats={stats}
          user={user}
          onBack={() => setCurrentView('home')}
        />
      )}

      {currentView === 'audio' && (
        <AudioView
          cards={audioCards}
          isLoading={isAudioLoading}
          error={audioError}
          onBack={() => setCurrentView('home')}
          onReload={fetchAudioCards}
        />
      )}
    </div>
  );
}

function HomeView({
  stats,
  user,
  showLoginPrompt,
  onLogin,
  onLogout,
  onStartStudy,
  onOpenAudio,
  onViewStats,
  progress,
  onResetProgress,
}) {
  const modes = [
    { id: 'sequential', name: '📋 Последовательно', desc: 'Все карточки по порядку', icon: '📖' },
    { id: 'random', name: '🔀 Случайно', desc: 'Все карточки в случайном порядке', icon: '🎲' },
    { id: 'unknown_sequential', name: '❓ Неизвестные (по порядку)', desc: 'Только сложные карточки', icon: '📚' },
    { id: 'unknown_random', name: '❓ Неизвестные (случайно)', desc: 'Сложные карточки случайно', icon: '🎯' },
    { id: 'exam', name: '📝 Экзамен', desc: '20 случайных вопросов', icon: '🎓' },
  ];

  const isAnonymous = user?.id === 'anonymous';

  return (
    <div className="home-view">
      <header className="header">
        <h1>🚦 ПДД Испании</h1>
        <p className="subtitle">Изучайте правила дорожного движения</p>
        
        <div className="user-section">
          {isAnonymous ? (
            <p className="user-greeting anonymous">👤 Гость</p>
          ) : (
            <p className="user-greeting">👤 {user?.username}</p>
          )}
          
          {isAnonymous ? (
            <button className="login-btn" onClick={onLogin}>
              🔐 Войти через Telegram
            </button>
          ) : (
            <button className="logout-btn" onClick={onLogout}>
              🚪 Выйти
            </button>
          )}
        </div>
      </header>

      {showLoginPrompt && isAnonymous && (
        <div className="login-prompt">
          <p>💡 Войдите чтобы сохранить прогресс</p>
          <button onClick={onLogin}>Войти через Telegram</button>
        </div>
      )}

      {stats && (
        <div className="stats-summary">
          <div className="stat-item">
            <span className="stat-value">{stats.total_cards}</span>
            <span className="stat-label">Всего карточек</span>
          </div>
          <div className="stat-item known">
            <span className="stat-value">{stats.known}</span>
            <span className="stat-label">Знаю</span>
          </div>
          <div className="stat-item unknown">
            <span className="stat-value">{stats.unknown}</span>
            <span className="stat-label">Учу</span>
          </div>
        </div>
      )}

      <div className="modes-grid">
        {modes.map(mode => (
          <button
            key={mode.id}
            className="mode-card"
            onClick={() => onStartStudy(mode.id)}
          >
            <span className="mode-icon">{mode.icon}</span>
            <h3>{mode.name}</h3>
            <p>{mode.desc}</p>
          </button>
        ))}
      </div>

      <button className="stats-btn" onClick={onViewStats}>
        📊 Подробная статистика
      </button>

      <button className="audio-btn" onClick={onOpenAudio}>
        🎧 Аудио карточки
      </button>
      
      {(progress?.total_known > 0 || progress?.total_unknown > 0) && (
        <button className="reset-btn" onClick={onResetProgress}>
          🗑️ Сбросить прогресс
        </button>
      )}
    </div>
  );
}

function StudyView({
  mode, card, currentIndex, totalCards, swipeDirection, dragX,
  isComplete, examResults, onTouchStart, onTouchMove, onTouchEnd, onSwipe, onBack, onRestart
}) {
  if (isComplete) {
    return (
      <div className="study-view complete">
        <div className="complete-content">
          <h2>🎉 Готово!</h2>
          {examResults ? (
            <div className="exam-results">
              <p className="result-text">
                Правильно: <strong>{examResults.correct}</strong> из {examResults.correct + examResults.incorrect}
              </p>
              <p className="result-percent">
                {Math.round((examResults.correct / (examResults.correct + examResults.incorrect)) * 100)}%
              </p>
            </div>
          ) : (
            <p>Вы прошли все карточки в этом режиме</p>
          )}
          <div className="complete-actions">
            <button className="btn-primary" onClick={onRestart}>
              🔄 Начать заново
            </button>
            <button className="btn-secondary" onClick={onBack}>
              🏠 На главную
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="study-view empty">
        <p>Нет карточек для этого режима</p>
        <button className="btn-secondary" onClick={onBack}>🏠 На главную</button>
      </div>
    );
  }

  return (
    <div className="study-view">
      <header className="study-header">
        <button className="back-btn" onClick={onBack}>← Назад</button>
        <span className="mode-name">
          {mode === 'exam' ? '📝 Экзамен' : '📚 Обучение'}
        </span>
        <span className="card-counter">{currentIndex + 1} / {totalCards}</span>
      </header>

      <div
        className="card-container"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div
          className={`flashcard swipe-${swipeDirection || ''}`}
          style={{
            transform: dragX ? `translateX(${dragX}px) rotate(${dragX * 0.1}deg)` : undefined,
            transition: dragX ? 'none' : 'transform 0.3s ease',
          }}
        >
          <div className="card-content">
            <div className="card-label">Правило #{card.id}</div>
            <p className="card-text">{card.russian}</p>
          </div>

          <div className="card-hint">
            <span className="hint-left">← Не знаю</span>
            <span className="hint-right">Знаю →</span>
          </div>
        </div>

        {swipeDirection && (
          <div className={`swipe-indicator ${swipeDirection}`}>
            {swipeDirection === 'right' ? '✓ ЗНАЮ' : '✗ НЕ ЗНАЮ'}
          </div>
        )}
      </div>

      <div className="study-actions">
        <button 
          className="btn-unknown" 
          onClick={() => onSwipe('left')}
        >
          ✗ Не знаю
        </button>
        <button 
          className="btn-known" 
          onClick={() => onSwipe('right')}
        >
          ✓ Знаю
        </button>
      </div>

      <p className="keyboard-hint">
        Используйте ← → или свайп для навигации
      </p>
    </div>
  );
}

function AudioView({ cards, isLoading, error, onBack, onReload }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentSource, setCurrentSource] = useState('');
  const [playMode, setPlayMode] = useState('single'); // single | sequential | shuffle
  const [shuffleQueue, setShuffleQueue] = useState([]);
  const [shufflePosition, setShufflePosition] = useState(-1);
  const audioRef = useRef(null);

  const playableCards = cards.filter(card => card.has_audio && card.audio_url);
  const missingCount = cards.length - playableCards.length;
  const activeCardId = playableCards[currentIndex]?.id;

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (audio) {
        audio.pause();
      }
    };
  }, []);

  const buildShuffleQueue = useCallback((length, startIndex = null) => {
    const queue = Array.from({ length }, (_, idx) => idx);
    for (let i = queue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }

    if (startIndex === null || startIndex < 0 || startIndex >= length) {
      return queue;
    }

    const withoutStart = queue.filter(idx => idx !== startIndex);
    return [startIndex, ...withoutStart];
  }, []);

  const playCard = useCallback((index, mode = 'single') => {
    if (index < 0 || index >= playableCards.length) return;

    const card = playableCards[index];
    setCurrentIndex(index);
    setCurrentSource(card.audio_url);
    setPlayMode(mode);

    if (mode !== 'shuffle') {
      setShuffleQueue([]);
      setShufflePosition(-1);
    }
  }, [playableCards]);

  const handlePlayAll = () => {
    if (!playableCards.length) return;
    const hasCurrentSelection = Boolean(currentSource) && currentIndex >= 0 && currentIndex < playableCards.length;
    const startIndex = hasCurrentSelection ? currentIndex : 0;
    playCard(startIndex, 'sequential');
  };

  const handlePlayShuffle = () => {
    if (!playableCards.length) return;
    const hasCurrentSelection = Boolean(currentSource) && currentIndex >= 0 && currentIndex < playableCards.length;
    const startIndex = hasCurrentSelection ? currentIndex : Math.floor(Math.random() * playableCards.length);
    const queue = buildShuffleQueue(playableCards.length, startIndex);
    setShuffleQueue(queue);
    setShufflePosition(0);
    playCard(queue[0], 'shuffle');
  };

  const handlePause = () => {
    setPlayMode('single');
    if (audioRef.current) {
      audioRef.current.pause();
    }
  };

  const handleTrackEnd = () => {
    if (playMode === 'sequential') {
      const nextIndex = currentIndex + 1;
      if (nextIndex >= playableCards.length) {
        setPlayMode('single');
        return;
      }
      playCard(nextIndex, 'sequential');
      return;
    }

    if (playMode === 'shuffle') {
      const nextPosition = shufflePosition + 1;
      if (nextPosition < 0 || nextPosition >= shuffleQueue.length) {
        setPlayMode('single');
        return;
      }
      setShufflePosition(nextPosition);
      playCard(shuffleQueue[nextPosition], 'shuffle');
    }
  };

  return (
    <div className="audio-view">
      <header className="stats-header">
        <button className="back-btn" onClick={onBack}>← Назад</button>
        <h2>🎧 Аудио карточки</h2>
        <span></span>
      </header>

      <div className="audio-controls">
        <div className="audio-meta">
          <p>Всего карточек: <strong>{cards.length}</strong></p>
          <p>С аудио: <strong>{playableCards.length}</strong></p>
          {missingCount > 0 && (
            <p className="audio-warning">Без аудио: {missingCount}</p>
          )}
        </div>

        <div className="audio-actions">
          <button className="btn-primary" onClick={handlePlayAll} disabled={!playableCards.length}>
            {playMode === 'sequential' ? '▶ Идёт подряд' : '▶ Слушать все подряд'}
          </button>
          <button className="btn-primary" onClick={handlePlayShuffle} disabled={!playableCards.length}>
            {playMode === 'shuffle' ? '🔀 Идёт вразнобой' : '🔀 Слушать вразнобой'}
          </button>
          <button className="btn-secondary" onClick={handlePause}>
            ⏸ Пауза
          </button>
          <button className="btn-secondary" onClick={onReload}>
            🔄 Обновить список
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="audio-empty">
          <p>Загрузка аудио карточек...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="audio-empty">
          <p>{error}</p>
          <button className="btn-secondary" onClick={onReload}>Повторить</button>
        </div>
      )}

      {!isLoading && !error && !playableCards.length && (
        <div className="audio-empty">
          <p>Аудио пока нет. Сначала запустите скрипт генерации озвучки.</p>
        </div>
      )}

      {!isLoading && !error && playableCards.length > 0 && (
        <>
          <audio
            className="audio-player"
            ref={audioRef}
            src={currentSource}
            controls
            autoPlay
            onEnded={handleTrackEnd}
          />

          <div className="audio-list">
            {playableCards.map((card, index) => (
              <div
                key={card.id}
                className={`audio-card-item ${activeCardId === card.id ? 'active' : ''}`}
              >
                <div className="audio-card-info">
                  <div className="audio-card-title">Правило #{card.id}</div>
                  <p>{card.russian}</p>
                </div>
                <button
                  className="audio-play-btn"
                  onClick={() => playCard(index, 'single')}
                >
                  {activeCardId === card.id ? '🔊 Сейчас' : '▶ Слушать'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatsView({ progress, stats, user, onBack }) {
  return (
    <div className="stats-view">
      <header className="stats-header">
        <button className="back-btn" onClick={onBack}>← Назад</button>
        <h2>📊 Статистика</h2>
        <span></span>
      </header>

      {user && user.username && user.username !== 'Guest' && (
        <div className="user-stats-header">
          <p>Пользователь: <strong>{user.username}</strong></p>
          <p>Ваши изученные: <strong className="known">{progress.total_known}</strong></p>
          <p>Ваи в процессе: <strong className="unknown">{progress.total_unknown}</strong></p>
        </div>
      )}

      {stats && (
        <div className="stats-content">
          <div className="progress-bar-container">
            <div className="progress-bar">
              <div 
                className="progress-known" 
                style={{ width: `${(stats.known / stats.total_cards) * 100}%` }}
              />
              <div 
                className="progress-unknown" 
                style={{ width: `${(stats.unknown / stats.total_cards) * 100}%` }}
              />
            </div>
            <div className="progress-legend">
              <span className="legend-known">✓ Все знают: {stats.known}</span>
              <span className="legend-unknown">📚 Все учат: {stats.unknown}</span>
              <span className="legend-remaining">⏳ Осталось: {stats.not_started}</span>
            </div>
          </div>

          <div className="stats-details">
            <div className="stat-row">
              <span>Всего карточек:</span>
              <strong>{stats.total_cards}</strong>
            </div>
            <div className="stat-row">
              <span>Изучено (все пользователи):</span>
              <strong className="known">{stats.known}</strong>
            </div>
            <div className="stat-row">
              <span>В процессе (все пользователи):</span>
              <strong className="unknown">{stats.unknown}</strong>
            </div>
            <div className="stat-row">
              <span>Прогресс сообщества:</span>
              <strong>{Math.round(((stats.known + stats.unknown) / stats.total_cards) * 100)}%</strong>
            </div>
          </div>

          {progress.total_known > 0 && (
            <div className="personal-stats">
              <h3>Ваш прогресс</h3>
              <div className="stat-row">
                <span>Знаете:</span>
                <strong className="known">{progress.total_known}</strong>
              </div>
              <div className="stat-row">
                <span>Учите:</span>
                <strong className="unknown">{progress.total_unknown}</strong>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
