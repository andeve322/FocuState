import React, { useState } from 'react';

export default function MathHelper({ onInsert, theme = 'light' }) {
  const [open, setOpen] = useState(false);
  const insert = (tpl) => {
    if (onInsert) onInsert(tpl);
  };
  const btnStyle = {
    padding: '6px 8px',
    borderRadius: 6,
    border: theme === 'dark' ? '1px solid #23303b' : '1px solid #e6edf8',
    background: theme === 'dark' ? '#071826' : '#ffffff',
    color: theme === 'dark' ? '#e6eef8' : '#0f172a',
    minWidth: 44,
    height: 36,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: theme === 'dark' ? '0 2px 6px rgba(2,6,23,0.6)' : '0 2px 6px rgba(15,23,42,0.04)',
    cursor: 'pointer',
    fontWeight: 600,
  };

  return (
    <div style={{display:'flex', alignItems:'center', gap:8}}>
      <button
        className="btn-icon-sm"
        onClick={() => setOpen(o => !o)}
        title="Math helper"
        style={{padding:'6px', width:36, height:36, display:'inline-flex', alignItems:'center', justifyContent:'center'}}
      >
        <span style={{fontSize:16, fontWeight:700, lineHeight:1}}>Σ</span>
      </button>

      {open && (
        <div style={{display:'flex', gap:6, padding:8, borderRadius:8, background: theme === 'dark' ? '#071026' : '#f8fafc', border: theme === 'dark' ? '1px solid #0f172a' : '1px solid #e6edf8', boxShadow: theme === 'dark' ? '0 6px 18px rgba(2,6,23,0.6)' : '0 6px 18px rgba(15,23,42,0.06)'}}>
          <button style={btnStyle} onClick={() => insert('$a^2$')} title="Superscript">x^</button>
          <button style={btnStyle} onClick={() => insert('$x_{i}$')} title="Subscript">x_</button>
          <button style={btnStyle} onClick={() => insert('$$\\frac{a}{b}$$')} title="Fraction">a/b</button>
          <button style={btnStyle} onClick={() => insert('$$\\sqrt{x}$$')} title="Sqrt">√</button>
          <button style={btnStyle} onClick={() => insert('$$\\int_{a}^{b} f(x) \\\,dx$$')} title="Integral">∫</button>
          <button style={btnStyle} onClick={() => insert('$$\\frac{d}{dx} f(x)$$')} title="Derivative">d/dx</button>
          <button style={btnStyle} onClick={() => insert('$\\pi$')} title="Pi">π</button>
          <button style={btnStyle} onClick={() => insert('$\\theta$')} title="Theta">θ</button>
          <button style={btnStyle} onClick={() => insert('$$\\sum_{n=1}^{N} n$$')} title="Summation">Σ</button>
        </div>
      )}

      
    </div>
  );
}
