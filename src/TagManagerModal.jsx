import React, { useState, useEffect } from 'react';
import { randomColor, tagId, getTags, addTag, updateTag, deleteTag } from './tags';
import { Tag, Edit2, Trash2, Plus, Check, X } from 'lucide-react';

import { motion, AnimatePresence } from 'framer-motion';

export default function TagManagerModal({ user, flowTier, onClose, onSelectTag, selectedTag }) {
  const [tags, setTags] = useState([]);
  const [editing, setEditing] = useState(null); // tag or null
  const [name, setName] = useState('');
  const [color, setColor] = useState(randomColor());
  const [error, setError] = useState('');

  useEffect(() => {
    // Load tags when the modal is mounted. Access is controlled where the modal is shown.
    getTags(user, flowTier).then(setTags);
  }, [user, flowTier]);

  const startEdit = (tag) => {
    setEditing(tag.id);
    setName(tag.name);
    setColor(tag.color);
    setError('');
  };

  const resetForm = () => {
    setEditing(null);
    setName('');
    setColor(randomColor());
    setError('');
  };

  // Use the same compact palette used elsewhere in the app
  const COLORS = ['#6366f1', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'];

  const handleSave = async () => {
    if (!name.trim()) return setError('Name required');
    const tag = { id: editing || tagId(), name, color };
    try {
      const newTags = editing ? await updateTag(tag, user, flowTier) : await addTag(tag, user, flowTier);
      // Ensure UI updates with returned list
      if (Array.isArray(newTags)) setTags(newTags);
      resetForm();
    } catch (err) {
      console.error('Saving tag failed', err);
      setError('Failed to save tag');
    }
  };

  const handleDelete = async (id) => {
    setTags(await deleteTag(id, user, flowTier));
    if (editing === id) resetForm();
  };

  return (
    <AnimatePresence>
      <motion.div
        className="modal-overlay"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="aesthetic-modal tag-manager-modal"
          onClick={e => e.stopPropagation()}
          initial={{ scale: 0.94, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 10 }}
          transition={{ duration: 0.2 }}
          style={{ maxWidth: 480, width: '92%' }}
        >
            <div className="modal-header" style={{ background: 'transparent', borderRadius: 16, margin: '-30px -30px 20px -30px', padding: '18px 30px', color: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700, fontSize: '1.1rem', letterSpacing: 0.2 }}>Tag & Manage Study Subjects</span>
            <motion.button
              className="close-modal-btn"
              onClick={onClose}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
            >
              <X size={20} />
            </motion.button>
          </div>
          <div className="modal-body" style={{ padding: 0 }}>
            <div style={{ marginBottom: 16, fontWeight: 500, fontSize: '1rem', textAlign: 'left' }}>Select a tag for this session:</div>
            <div className="tag-list" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
              <div
                className={`tag-row untagged${!selectedTag ? ' selected' : ''}`}
                style={{ background: '#e5e7eb', cursor: 'pointer', border: !selectedTag ? '2px solid #6366f1' : '2px solid transparent', borderRadius: 8, padding: '7px 16px', display: 'flex', alignItems: 'center', fontWeight: 600, fontSize: '0.98rem', boxShadow: !selectedTag ? '0 2px 8px #6366f122' : 'none', transition: 'all 0.2s' }}
                onClick={() => onSelectTag && onSelectTag(null)}
              >
                <Tag size={18} style={{ marginRight: 8 }} /> Untagged
              </div>
              {tags.map(tag => (
                <div
                  key={tag.id}
                  className={`tag-row${selectedTag && selectedTag.id === tag.id ? ' selected' : ''}`}
                  style={{ background: tag.color + '22', cursor: 'pointer', border: selectedTag && selectedTag.id === tag.id ? `2px solid ${tag.color}` : '2px solid transparent', borderRadius: 8, padding: '7px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600, fontSize: '0.98rem', boxShadow: selectedTag && selectedTag.id === tag.id ? `0 2px 8px ${tag.color}33` : 'none', transition: 'all 0.2s' }}
                  onClick={() => onSelectTag && onSelectTag(tag)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 4, background: tag.color }} />
                    <div>{tag.name}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn-icon-xs" title="Edit tag" onClick={e => { e.stopPropagation(); startEdit(tag); }}><Edit2 size={16}/></button>
                    <button className="btn-icon-xs btn-delete" title="Delete tag" onClick={e => { e.stopPropagation(); handleDelete(tag.id); }}><Trash2 size={16}/></button>
                  </div>
                </div>
              ))}
            </div>
            <div className="tag-form">
              <div className="tag-form-title">{editing ? 'Edit Tag' : 'Add New Tag'}</div>

              <div className="tag-form-row">
                <input className="modal-input tag-name-input" value={name} onChange={e => setName(e.target.value)} placeholder="Subject" />

                <div className="color-palette" role="list">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`color-dot ${color === c ? 'selected' : ''}`}
                      aria-label={`Select color ${c}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="modal-btn-row">
                <button className="modal-btn btn-primary btn-full" onClick={handleSave}>
                  {editing ? <><Check/> Update</> : <><Plus/> Add</>}
                </button>
                {editing && <button className="modal-btn btn-secondary" onClick={resetForm}><X/> Cancel</button>}
              </div>

              {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
