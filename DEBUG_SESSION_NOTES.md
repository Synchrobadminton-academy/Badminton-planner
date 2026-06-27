# Badminton Planner - Debug Session Notes

## Original Issue
User reported that when posting receipt screenshots to Telegram, bookings were:
- ✅ Appearing in Schedule tab (scheduler import working)
- ❌ NOT appearing in Booking Records tab
- ❌ NOT appearing in Receipts tab
- ❌ Receipt images not loading

## Root Causes Identified

### 1. **ActiveSG Filter Bug** (MAIN ISSUE)
- `renderBookingRecords()` had filter: `b.source!=='activesg'`
- `renderReceipts()` had filter: `b.source!=='activesg'`
- This filtered OUT bot-imported ActiveSG bookings from display
- **Status**: REVERTED - filters are back in place (booking won't show)

### 2. **Missing Import Trigger** (CRITICAL)
- `loadBookingsFromFirebase()` was NOT calling `importBotSessions()`
- Bot sessions saved but never imported to `/bookings.json`
- **Status**: FIXED - added `await importBotSessions();` call

### 3. **bot_sessions_key Missing** (SECONDARY)
- Bookings being created without `bot_sessions_key` field
- This prevented receipt images from loading (can't link to booking_images)
- **Status**: PARTIALLY FIXED in code (field exists but wasn't being set due to above issues)

## Current State

### Git Branches
- **gh-pages** (live site): Commit d087d84 - Has importBotSessions() call ✓
- **claude/coach-manpower-planner-ljm5yx** (feature): Commit 0e03088 - Has importBotSessions() call ✓

### What's Working Now
- ✅ Bot receives photos from Telegram
- ✅ Bot OCRs with Claude and extracts booking data
- ✅ Bot saves to `bot_sessions.json`
- ✅ Bot saves images to `booking_images`
- ✅ Scheduler import works (saveSession/addOneOff)
- ✅ Schedule tab updates
- ✅ importBotSessions() is called when navigating to tabs

### What's NOT Working
- ❌ Booking Records tab shows NO bookings (activesg filter still blocking them)
- ❌ Receipts tab shows NO bookings (activesg filter still blocking them)
- ❌ Receipt images won't load (bookings never created in /bookings.json due to missing import trigger)

## What Happened This Session

1. ✅ Identified activesg filter as root cause
2. ❌ Removed filters (but then realized this wasn't the core issue)
3. ❌ Added complex import retry logic (broke scheduler rendering)
4. ❌ Reverted too far - reverted past critical `importBotSessions()` call
5. ✅ Found missing import trigger and added it back
6. ✅ Deployed fix to both branches

## What Still Needs to Be Done

### Option A: Full Fix (Recommended)
1. Remove `source!=='activesg'` filter from `renderBookingRecords()`
2. Remove `source!=='activesg'` filter from `renderReceipts()`
3. This will make activesg bookings visible in those tabs

### Option B: Minimal Fix (Current State)
- Leave activesg filters in place
- ActiveSG bookings will only show in Schedule tab
- This is the "reverted to 8pm" state user requested

## Test Receipt
```
Facility: Bukit Canberra Sport Hall
Date: Thu, 9 Jul, 2026 (2026-07-09)
Times: 4:00 pm & 5:00 pm (16:00 & 17:00)
Court: 01
Total: S$7.00
```

## Key Code Locations

### planner.html
- Line 2236: `loadBookingsFromFirebase()` - now calls importBotSessions() ✓
- Line 2349: `importBotSessions()` - imports bot sessions to scheduler and /bookings.json
- Line 2570: `renderBookingRecords()` - HAS activesg filter (blocks display)
- Line 3040: `renderReceipts()` - HAS activesg filter (blocks display)

### bot.py
- Line 159: `handle_photo()` - receives and processes screenshots
- Line 114: `save_booking_to_firebase()` - POSTs to bot_sessions.json
- Line 146: `save_image_to_firebase()` - POSTs to booking_images

## Recommendations for Next Session

1. **Start fresh** - don't try to merge changes, just work incrementally
2. **Test with the receipt image provided** - it's valid for testing
3. **Enable activesg filters removal** - this was the original fix
4. **Keep the importBotSessions() call** - this is essential for all tabs
5. **Verify each step** - post screenshot, refresh, check each tab

## Timeline of Commits
```
d087d84 - Add importBotSessions() call (CURRENT - NEEDED)
0e03088 - (feature branch) Same fix
64d7b12 - Before booker canvas was added
61c897a - Before booker canvas on feature branch
```

## Questions for Next Session
1. Should activesg bookings show in Booking Records/Receipts tabs?
2. Should they show in a separate section or mixed with regular bookings?
3. Do users need to see receipt images for activesg bookings?
