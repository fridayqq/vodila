import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

const API_BASE = import.meta.env.PROD ? '/api' : 'http://localhost:8000/api';

// Telegram WebApp integration
const TelegramWebApp = window.Telegram?.WebApp;

function App() {
  const [currentView, setCurrentView] = useState('home');
  const [selectedMode, setSelectedMode] = useState(null);
  const [cards, setCards] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState({ known: [], unknown: [] });
  const [stats, setStats] = useState(null);
  const [swipeDirection, setSwipeDirection] = useState(null);
  const [isExamMode, setIsExamMode] = useState(false);
  const [examResults, setExamResults] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);

  const touchStartX = useRef(0);
  const touchCurrentX = useRef(0);

  // Authenticate with Telegram
  useEffect(() => {
    // Always allow access - Telegram or browser
    const tgUser = TelegramWebApp?.initDataUnsafe?.user;
    
    if (TelegramWebApp) {
      TelegramWebApp.ready();
      TelegramWebApp.expand();

      const initData = TelegramWebApp.initData;
      if (initData && tgUser) {
        authenticate(initData, tgUser);
      } else {
        // In Telegram but no auth data, or not in Telegram
        setIsAuthenticated(true);
        setUser({ id: 'anonymous', username: 'Guest' });
      }
    } else {
      // Not in Telegram - browser mode
      setIsAuthenticated(true);
      setUser({ id: 'anonymous', username: 'Guest' });
    }
  }, []);

  const authenticate = async (initData, tgUser) => {
    try {
      const params = new URLSearchParams(initData);
      const userParam = params.get('user');
      const hash = params.get('hash');

      if (!userParam || !hash) {
        // No auth data - use anonymous mode
        setIsAuthenticated(true);
        setUser({ id: 'anonymous', username: 'Guest' });
        return;
      }

      const res = await fetch(`${API_BASE}/auth/telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: tgUser, hash }),
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data);
        setIsAuthenticated(true);
      } else {
        // Auth failed - use anonymous mode
        console.warn('Telegram auth failed, using anonymous mode');
        setIsAuthenticated(true);
        setUser({ id: 'anonymous', username: 'Guest' });
      }
    } catch (e) {
      console.error('Auth error:', e);
      // Error - use anonymous mode
      setIsAuthenticated(true);
      setUser({ id: 'anonymous', username: 'Guest' });
    }
  };

  const getAuthHeaders = () => {
    const tgUser = TelegramWebApp?.initDataUnsafe?.user;
    if (!tgUser) return {};
    return { 'X-Telegram-User': JSON.stringify(tgUser) };
  };

  // Load data after auth
  useEffect(() => {
    if (isAuthenticated) {
      fetchStats();
      fetchProgress();
    }
  }, [isAuthenticated]);

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

  const updateCardProgress = async (ruleId, status) => {
    try {
      await fetch(`${API_BASE}/progress`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ rule_id: ruleId, status }),
      });
      
      if (!isExamMode) {
        fetchProgress();
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
      setCurrentIndex(prev => prev + 1);
    }, 300);
  }, [currentIndex, cards, isExamMode]);

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e) => {
    touchCurrentX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    const diff = touchCurrentX.current - touchStartX.current;
    const threshold = 100;
    
    if (diff > threshold) {
      handleSwipe('right');
    } else if (diff < -threshold) {
      handleSwipe('left');
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

  if (!isAuthenticated) {
    return (
      <div className="app">
        <div className="loading-screen">
          <div className="spinner"></div>
          <p>Загрузка...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {currentView === 'home' && (
        <HomeView 
          stats={stats} 
          user={user}
          onStartStudy={startStudy} 
          onViewStats={() => setCurrentView('stats')}
        />
      )}
      
      {currentView === 'study' && (
        <StudyView
          mode={selectedMode}
          card={currentCard}
          currentIndex={currentIndex}
          totalCards={cards.length}
          swipeDirection={swipeDirection}
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
    </div>
  );
}

function HomeView({ stats, user, onStartStudy, onViewStats }) {
  const modes = [
    { id: 'sequential', name: '📋 Последовательно', desc: 'Все карточки по порядку', icon: '📖' },
    { id: 'random', name: '🔀 Случайно', desc: 'Все карточки в случайном порядке', icon: '🎲' },
    { id: 'unknown_sequential', name: '❓ Неизвестные (по порядку)', desc: 'Только сложные карточки', icon: '📚' },
    { id: 'unknown_random', name: '❓ Неизвестные (случайно)', desc: 'Сложные карточки случайно', icon: '🎯' },
    { id: 'exam', name: '📝 Экзамен', desc: '20 случайных вопросов', icon: '🎓' },
  ];

  return (
    <div className="home-view">
      <header className="header">
        <h1>🚦 ПДД Испании</h1>
        <p className="subtitle">Изучайте правила дорожного движения</p>
        {user && user.username && user.username !== 'Guest' && (
          <p className="user-greeting">👤 {user.username}</p>
        )}
      </header>

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
      
      {(progress.total_known > 0 || progress.total_unknown > 0) && (
        <button className="reset-btn" onClick={resetProgress}>
          🗑️ Сбросить прогресс
        </button>
      )}
    </div>
  );
}

function StudyView({ 
  mode, card, currentIndex, totalCards, swipeDirection, 
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
        <div className={`flashcard swipe-${swipeDirection || ''}`}>
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
