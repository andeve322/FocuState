import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { syncSnakeHighScore, loadSnakeHighScore, updateSnakeLeaderboardEntry } from './firebase';
import './SnakeGame.css';

export default function SnakeGame({ theme, user, username, flowTier, leaderboardOptIn }) {
  const canvasRef = useRef(null);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [highScore, setHighScore] = useState(0);
  
  const gameStateRef = useRef({
    snake: [{ x: 10, y: 10 }],
    direction: { x: 0, y: 0 },
    food: { x: 15, y: 15 },
    score: 0,
    gameOver: false,
    gridSize: 20,
    tileSize: 0,
    gameLoop: null
  });

  // Initialize game
  const initGame = () => {
    const state = gameStateRef.current;
    state.snake = [{ x: 10, y: 10 }];
    state.direction = { x: 0, y: 0 };
    state.score = 0;
    state.gameOver = false;
    
    setScore(0);
    setGameOver(false);
    
    placeFood();
    
    if (state.gameLoop) clearInterval(state.gameLoop);
    state.gameLoop = setInterval(update, 150);
  };

  // Place food randomly
  const placeFood = () => {
    const state = gameStateRef.current;
    let foodPosition;
    do {
      foodPosition = {
        x: Math.floor(Math.random() * state.gridSize),
        y: Math.floor(Math.random() * state.gridSize)
      };
    } while (isFoodOnSnake(foodPosition));
    state.food = foodPosition;
  };

  const isFoodOnSnake = (position) => {
    const state = gameStateRef.current;
    return state.snake.some(segment => segment.x === position.x && segment.y === position.y);
  };

  const checkSelfCollision = () => {
    const state = gameStateRef.current;
    const head = state.snake[0];
    for (let i = 1; i < state.snake.length; i++) {
      if (head.x === state.snake[i].x && head.y === state.snake[i].y) {
        return true;
      }
    }
    return false;
  };

  // Game update loop
  const update = () => {
    const state = gameStateRef.current;
    if (state.gameOver) return;

    const head = { 
      x: state.snake[0].x + state.direction.x, 
      y: state.snake[0].y + state.direction.y 
    };
    
    if (state.direction.x === 0 && state.direction.y === 0) {
      draw();
      return;
    }

    state.snake.unshift(head);

    // Check for food collision
    if (head.x === state.food.x && head.y === state.food.y) {
      state.score++;
      setScore(state.score);
      placeFood();
    } else {
      state.snake.pop();
    }

    // Check for wall and self collision
    if (
      head.x < 0 || head.x >= state.gridSize ||
      head.y < 0 || head.y >= state.gridSize ||
      checkSelfCollision()
    ) {
      endGame();
      return;
    }

    draw();
  };

  // Draw game
  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const state = gameStateRef.current;

    // Clear canvas
    const bg = theme === 'dark' ? '#0a0a0f' : theme === 'sepia' ? '#f4ecdd' : '#f8fafc';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw snake
    ctx.fillStyle = '#818cf8';
    state.snake.forEach(segment => {
      ctx.fillRect(
        segment.x * state.tileSize, 
        segment.y * state.tileSize, 
        state.tileSize - 1, 
        state.tileSize - 1
      );
    });

    // Draw food
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(
      state.food.x * state.tileSize, 
      state.food.y * state.tileSize, 
      state.tileSize, 
      state.tileSize
    );
    
    // Food shine
    ctx.fillStyle = '#ff9999';
    ctx.fillRect(
      state.food.x * state.tileSize + state.tileSize * 0.1,
      state.food.y * state.tileSize + state.tileSize * 0.1,
      state.tileSize * 0.3,
      state.tileSize * 0.3
    );
  };

  const endGame = async () => {
    const state = gameStateRef.current;
    state.gameOver = true;
    setGameOver(true);
    clearInterval(state.gameLoop);
    
    if (state.score > highScore) {
      const newHighScore = state.score;
      setHighScore(newHighScore);
      localStorage.setItem('snakeHighScore', newHighScore.toString());
      
      // Sync to cloud if user is logged in
      if (user) {
        await syncSnakeHighScore(user.uid, newHighScore);
        // Update leaderboard for users who opted in
        if (leaderboardOptIn) {
          const name = username || (user.email ? user.email.split('@')[0] : 'user');
          try {
            await updateSnakeLeaderboardEntry(user.uid, name, newHighScore);
            try {
              window.dispatchEvent(new CustomEvent('uniFocus_snakeLeaderboardUpdated', { detail: { userId: user.uid, score: newHighScore } }));
            } catch (e) { /* ignore dispatch errors */ }
          } catch (err) {
            // ignore update failures
          }
        }
      }
    }
  };

  // Load high score from cloud on mount
  useEffect(() => {
    const loadHighScore = async () => {
      if (user) {
        const result = await loadSnakeHighScore(user.uid);
        if (result.success && result.highScore) {
          // Use cloud high score if it's higher than local
          const localHighScore = parseInt(localStorage.getItem('snakeHighScore') || '0');
          const cloudHighScore = result.highScore;
          const maxHighScore = Math.max(localHighScore, cloudHighScore);
          
          setHighScore(maxHighScore);
          localStorage.setItem('snakeHighScore', maxHighScore.toString());
          
          // Sync back to cloud if local was higher
          if (localHighScore > cloudHighScore) {
            await syncSnakeHighScore(user.uid, localHighScore);
            // Update leaderboard for users who opted in
            if (leaderboardOptIn) {
              const name = username || (user.email ? user.email.split('@')[0] : 'user');
              try {
                await updateSnakeLeaderboardEntry(user.uid, name, localHighScore);
                try {
                  window.dispatchEvent(new CustomEvent('uniFocus_snakeLeaderboardUpdated', { detail: { userId: user.uid, score: localHighScore } }));
                } catch (e) { /* ignore */ }
              } catch (err) {
                // ignore
              }
            }
          }
        } else {
          // Fall back to localStorage if cloud load fails
          const localHighScore = parseInt(localStorage.getItem('snakeHighScore') || '0');
          setHighScore(localHighScore);
        }
      } else {
        // Not logged in, use localStorage only
        const localHighScore = parseInt(localStorage.getItem('snakeHighScore') || '0');
        setHighScore(localHighScore);
      }
    };
    
    loadHighScore();
  }, [user, flowTier, leaderboardOptIn, username]);

  // Handle keyboard input
  useEffect(() => {
    const handleKeyPress = (e) => {
      const state = gameStateRef.current;
      const key = e.key;
      
      if ((key === 'ArrowUp' || key === 'w' || key === 'W') && state.direction.y === 0) {
        state.direction = { x: 0, y: -1 };
      } else if ((key === 'ArrowDown' || key === 's' || key === 'S') && state.direction.y === 0) {
        state.direction = { x: 0, y: 1 };
      } else if ((key === 'ArrowLeft' || key === 'a' || key === 'A') && state.direction.x === 0) {
        state.direction = { x: -1, y: 0 };
      } else if ((key === 'ArrowRight' || key === 'd' || key === 'D') && state.direction.x === 0) {
        state.direction = { x: 1, y: 0 };
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, []);

  // Initialize canvas and game
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const container = canvas.parentElement;
      const canvasSize = Math.min(container.clientWidth * 0.95, 400);
      canvas.width = canvasSize;
      canvas.height = canvasSize;
      gameStateRef.current.tileSize = canvas.width / gameStateRef.current.gridSize;
      draw();
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    initGame();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (gameStateRef.current.gameLoop) {
        clearInterval(gameStateRef.current.gameLoop);
      }
    };
  }, []);

  // Redraw when theme changes so background adapts instantly
  useEffect(() => {
    draw();
  }, [theme]);

  const handleDirection = (dir) => {
    const state = gameStateRef.current;
    if (dir === 'up' && state.direction.y === 0) {
      state.direction = { x: 0, y: -1 };
    } else if (dir === 'down' && state.direction.y === 0) {
      state.direction = { x: 0, y: 1 };
    } else if (dir === 'left' && state.direction.x === 0) {
      state.direction = { x: -1, y: 0 };
    } else if (dir === 'right' && state.direction.x === 0) {
      state.direction = { x: 1, y: 0 };
    }
  };

  return (
    <div className={`snake-game-container theme-${theme}`}>
      <div className="snake-ui-header">
        <span className="snake-score">SCORE: {score}</span>
        <span className="snake-high-score">HIGH: {highScore}</span>
      </div>
      
      <div className="snake-board-wrapper">
        <canvas ref={canvasRef} className="snake-canvas" />

        <AnimatePresence>
          {gameOver && (
            <motion.div
              className="snake-game-over"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.25 }}
            >
              <div className="snake-game-over-card">
                <h2>GAME OVER</h2>
                <p>Score: {score}</p>
                {score === highScore && score > 0 && <p className="new-record">NEW RECORD!</p>}
                <button className="snake-restart-btn" onClick={initGame}>
                  RESTART
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
