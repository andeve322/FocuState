// Tag data structure and helpers for Flow users
// Tag: { id, name, color, icon }
// Storage: IndexedDB (idb-keyval) for all

import { set as idbSet, get as idbGet, del as idbDel } from 'idb-keyval';

const TAGS_KEY = 'uniFocus_tags';

export async function getTags() {
  // Fallback to local
  return (await idbGet(TAGS_KEY)) || [];
}

export async function saveTags(tags) {
  await idbSet(TAGS_KEY, tags);
}

export async function addTag(tag) {
  const tags = await getTags();
  const newTags = [...tags, tag];
  await saveTags(newTags);
  return newTags;
}

export async function updateTag(updatedTag) {
  const tags = await getTags();
  const newTags = tags.map(t => t.id === updatedTag.id ? updatedTag : t);
  await saveTags(newTags);
  return newTags;
}

export async function deleteTag(tagId) {
  const tags = await getTags();
  const newTags = tags.filter(t => t.id !== tagId);
  await saveTags(newTags);

  // Migration: move any historical minutes recorded under the deleted tag into 'untagged'
  try {
    if (!tagId) return newTags;
    if (tagId === 'untagged') return newTags;

    // Load prefs from IndexedDB where dailyFocusRecords are persisted
    const prefs = (await idbGet('uniFocus_prefs')) || {};
    const daily = prefs.dailyFocusRecords || {};
    let changed = false;

    for (const [dateKey, val] of Object.entries(daily)) {
      if (!val || typeof val !== 'object') continue; // legacy numeric entry - nothing to migrate
      const byTag = val.byTag || {};
      if (!Object.prototype.hasOwnProperty.call(byTag, tagId)) continue;

      const mins = Number(byTag[tagId]) || 0;
      if (mins <= 0) {
        // remove empty entries
        delete byTag[tagId];
        continue;
      }

      // Add to untagged
      byTag['untagged'] = (Number(byTag['untagged']) || 0) + mins;
      // Remove the deleted tag entry
      delete byTag[tagId];

      // Ensure total remains correct: total should equal sum of byTag or be preserved
      const sumByTag = Object.values(byTag).reduce((s, v) => s + (Number(v) || 0), 0);
      // If total exists, keep it (assume it was correct). Otherwise set to sumByTag.
      if (typeof val.total === 'number') {
        // nothing - keep existing total
      } else {
        val.total = sumByTag;
      }

      // Write back
      daily[dateKey] = { ...val, byTag };
      changed = true;
    }

    if (changed) {
      prefs.dailyFocusRecords = daily;
      await idbSet('uniFocus_prefs', prefs);
    }
  } catch (err) {
    console.warn('Error migrating daily records on tag delete:', err);
  }

  return newTags;
}

// Helper to generate a random color
export function randomColor() {
  const colors = ['#6366f1','#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#64748b'];
  return colors[Math.floor(Math.random()*colors.length)];
}

// Helper to generate a unique id
export function tagId() {
  return 'tag_' + Math.random().toString(36).slice(2,10);
}
