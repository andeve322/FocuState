# 🎯 Quick Feature-Gating Reference

## How to Test (30 seconds)

```
1. Click User Profile Button (top-right)
2. Click "Tier: Light (Free)" button
3. Try any gated feature
4. See upgrade modal
```

---

## 6 Gated Features

| Feature | Free | Paid | How to Test |
|---------|------|------|-------------|
| **Documents** | 3 max | ∞ | Create 4th doc |
| **Edit Docs** | Read-only | Full | Open doc, try type |
| **Flashcards** | ❌ Blocked | ✅ Full | Click "New Deck" |
| **To-Do Lists** | ❌ Blocked | ✅ Full | Click todo icon |
| **Sounds** | 2 sounds | 5 sounds | Check mixer |
| **Analytics** | ❌ Blocked | ✅ Full | Click chart icon |

---

## Feature Locations

### In UI
- **Tier Toggle**: User menu dropdown
- **Document Gate**: File creation button
- **Edit Gate**: Text editor area (lock banner)
- **Flashcard Gate**: Deck creation button
- **To-Do Gate**: To-do button (right side)
- **Sound Gate**: Soundscape mixer section
- **Analytics Gate**: Stats bar (chart icon)

### In Code
- **Main gates**: `App.jsx` (~1650+ lines)
- **Modal component**: `UpgradeModal.jsx`
- **Tier source**: `flowTier` (derived into a local `subscriptionTier` when needed)
- **Tier button**: `UserArea.jsx`

---

## Gate Implementation Pattern

```javascript
// 1. Check feature availability
if (!canUseFeature('featureName')) {
  // 2. Show upgrade prompt
  showUpgradePrompt('featureName');
  return; // Don't proceed
}

// 3. Continue with normal action
// ...
```

---

## Adding New Upgrade Modal Feature

1. **In UpgradeModal.jsx**, add to `featureData`:
```javascript
myFeature: {
  title: 'Unlock My Feature',
  description: 'Description of what this feature does...',
  icon: MyIcon
}
```

2. **In your component**, call:
```javascript
showUpgradePrompt('myFeature');
```

That's it! Modal handles the rest.

---

## Tier Values

The app no longer stores a separate `subscriptionTier` field. Instead, derive a subscription-like value from the user's `flowTier`:

```javascript
const subscriptionTier = flowTier === 'flow' ? 'paid' : 'free';
// flowTier === 'flow' => paid (FocuState Flow)
// otherwise => free (FocuState Light)
```

---

## Testing Checklist

- [ ] Can create 3 docs as free
- [ ] 4th doc shows modal as free
- [ ] Can edit docs as paid
- [ ] Can't type in editor as free
- [ ] Can't create flashcards as free
- [ ] Can't access to-dos as free
- [ ] Only 2 sounds available as free
- [ ] Can't see analytics as free
- [ ] Tier toggle works
- [ ] Tier persists on refresh

---

## Common Issues

**Modal not showing?**
→ Check `showUpgradePrompt()` is called before return

**Gates not working after toggle?**
→ Hard refresh page (Cmd+Shift+R on Mac)

**Tier not saving?**
→ Check user is logged in before toggling

---

## Pricing Info (For Modal)

```
FocuState Flow: $3.50/month
```
(Update in UpgradeModal.jsx if price changes)

---

## Documentation Files

- `TESTING_FEATURE_GATES.md` - Full testing guide
- `FEATURE_GATES_IMPLEMENTED.md` - Technical details
- `FEATURE_GATING_COMPLETE.md` - Summary & next steps
- `FEATURE_GATING.md` - Original architecture docs
- `FEATURE_GATING_EXAMPLES.md` - Code pattern examples

---

## Status

✅ All 6 gates implemented
✅ No JavaScript errors
✅ Multi-device sync works
✅ Ready for testing or production

**To test:** Toggle tier in user menu! 🚀

