import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, ChevronLeft, ChevronRight, Edit2, BookOpen, X } from 'lucide-react';
import './FlashcardDeck.css';
import MathHelper from './components/MathHelperNew';
import { renderMathToHtml } from './utils/mathRenderer';

export default function FlashcardDeck({ file, onUpdate, theme = 'light', onClose }) {
  const effectiveTheme = theme || 'light';
  // Parse initial cards from file.content
  const parseCards = useCallback(() => {
    if (!file?.content) return [];
    try {
      return JSON.parse(file.content);
    } catch {
      return [];
    }
  }, [file?.content]);

  const [cards, setCards] = useState(() => parseCards());
  const [mode, setMode] = useState(() => cards.length === 0 ? 'EDIT' : 'STUDY');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const debounceTimer = useRef(null);
  const focusedInputRef = useRef(null);

  // Auto-save on card changes (debounced)
  const saveCards = useCallback((updatedCards) => {
    setCards(updatedCards);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      onUpdate(JSON.stringify(updatedCards));
    }, 500);
  }, [onUpdate]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (mode === 'STUDY') {
        if (e.code === 'Space') {
          e.preventDefault();
          setIsFlipped(!isFlipped);
        }
        if (e.code === 'ArrowLeft') {
          e.preventDefault();
          handlePrevious();
        }
        if (e.code === 'ArrowRight') {
          e.preventDefault();
          handleNext();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, isFlipped, currentIndex, cards.length]);

  // Navigation handlers
  const handleNext = () => {
    setCurrentIndex((prev) => (prev + 1) % cards.length);
    setIsFlipped(false);
  };

  const handlePrevious = () => {
    setCurrentIndex((prev) => (prev - 1 + cards.length) % cards.length);
    setIsFlipped(false);
  };

  // Add new card
  const addCard = () => {
    const newCards = [
      ...cards,
      { id: Date.now(), front: '', back: '' }
    ];
    saveCards(newCards);
  };

  // Delete card
  const deleteCard = (id) => {
    const newCards = cards.filter(card => card.id !== id);
    saveCards(newCards);
  };

  // Update card front/back
  const updateCard = (id, field, value) => {
    const newCards = cards.map(card =>
      card.id === id ? { ...card, [field]: value } : card
    );
    saveCards(newCards);
  };

  // Switch to Study Mode
  const enterStudyMode = () => {
    if (cards.length > 0) {
      setMode('STUDY');
      setCurrentIndex(0);
      setIsFlipped(false);
    }
  };

  // Switch to Edit Mode
  const enterEditMode = () => {
    setMode('EDIT');
    setIsFlipped(false);
  };

  // Render Edit Mode
  if (mode === 'EDIT') {
    return (
      <div className={`flashcard-deck flashcard-edit-mode theme-${effectiveTheme}`}>
        <div className="edit-header">
          <h2>Edit Flashcard Deck</h2>
          <div style={{display:'flex', gap:'8px', alignItems:'center'}}>
            {cards.length > 0 && (
              <button className="btn-study-mode" onClick={enterStudyMode}>
                <BookOpen size={18} />
                Study Mode
              </button>
            )}
            {onClose && (
              <button className="close-file-btn" onClick={onClose} title="Close deck">
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        <div className="edit-cards-container">
          {cards.length === 0 ? (
            <div className="empty-state">
              <BookOpen size={48} />
              <p>No flashcards yet. Add one to get started!</p>
            </div>
          ) : (
            <div className="cards-list">
              <div style={{marginBottom:8}}>
                <MathHelper theme={effectiveTheme} onInsert={(tpl) => {
                  const el = focusedInputRef.current;
                  if (el) {
                    const start = el.selectionStart || el.value.length;
                    const before = el.value.slice(0, start);
                    const after = el.value.slice(start);
                    const newVal = before + tpl + after;
                    // try to find card id by data attribute
                    const idAttr = el.getAttribute('data-card-id');
                    if (idAttr) {
                      updateCard(Number(idAttr), el.classList.contains('front') ? 'front' : 'back', newVal);
                    } else {
                      // fallback: find by value match
                      const idx = cards.findIndex(c => c.front === el.value || c.back === el.value);
                      if (idx >= 0) {
                        // assume front if values match
                        const field = cards[idx].front === el.value ? 'front' : 'back';
                        updateCard(cards[idx].id, field, newVal);
                      }
                    }
                    // restore focus
                    el.focus();
                  }
                }} />
              </div>
              {cards.map((card) => (
                <div key={card.id} className="card-row">
                  <div className="card-input-group">
                    <input
                      type="text"
                      placeholder="Front (question)"
                      value={card.front}
                      onFocus={(e) => { focusedInputRef.current = e.target; e.target.setAttribute('data-card-id', String(card.id)); }}
                      onChange={(e) => updateCard(card.id, 'front', e.target.value)}
                      className="card-input front"
                    />
                    <input
                      type="text"
                      placeholder="Back (answer)"
                      value={card.back}
                      onFocus={(e) => { focusedInputRef.current = e.target; e.target.setAttribute('data-card-id', String(card.id)); }}
                      onChange={(e) => updateCard(card.id, 'back', e.target.value)}
                      className="card-input back"
                    />
                  </div>
                  <button
                    className="btn-delete"
                    onClick={() => deleteCard(card.id)}
                    title="Delete card"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button className="btn-add-card" onClick={addCard}>
          <Plus size={20} />
          Add Card
        </button>
      </div>
    );
  }

  // Render Study Mode
  if (mode === 'STUDY' && cards.length > 0) {
    const currentCard = cards[currentIndex];

    return (
      <div className={`flashcard-deck flashcard-study-mode theme-${effectiveTheme}`}>
        <div className="study-header">
          <button className="btn-edit-mode" onClick={enterEditMode}>
            <Edit2 size={18} />
            Edit Deck
          </button>
          <span className="card-counter">
            Card {currentIndex + 1} / {cards.length}
          </span>
          {onClose && (
            <button className="close-file-btn" onClick={onClose} title="Close deck">
              <X size={18} />
            </button>
          )}
        </div>

        <div className="study-card-container">
          <div
            className={`flip-card ${isFlipped ? 'flipped' : ''}`}
            onClick={() => setIsFlipped(!isFlipped)}
          >
            <div className="flip-card-inner">
              <div className="flip-card-front">
                <div dangerouslySetInnerHTML={{ __html: renderMathToHtml(currentCard.front || '') }} />
              </div>
              <div className="flip-card-back">
                <div dangerouslySetInnerHTML={{ __html: renderMathToHtml(currentCard.back || '') }} />
              </div>
            </div>
          </div>
          <p className="flip-hint">Click card or press SPACE to flip</p>
        </div>

        <div className="study-controls">
            {/* Math helper removed from study view (only available in edit mode) */}
          <button
            className="btn-nav"
            onClick={handlePrevious}
            disabled={cards.length <= 1}
          >
            <ChevronLeft size={20} />
            Previous
          </button>
          <button
            className="btn-nav"
            onClick={handleNext}
            disabled={cards.length <= 1}
          >
            Next
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="study-hints">
          <span>← Arrow Left / Right →</span>
          <span>Press SPACE to flip</span>
        </div>
      </div>
    );
  }

  return null;
}
