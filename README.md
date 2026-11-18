# Photo Sorter

A small phone app for clearing out a photo library one picture at a time.

- **Swipe left** – next photo in the timeline (newest first); **swipe right** – go back
- **Flick up**, or **pinch two fingers together** – move the photo to the trash bin
- **Album spots** – empty dotted spots, four to a row, one row to begin with. Tap a **+**
  to pick one of the albums already on the phone (biggest first), or make a new one. In
  Options you choose how many rows you want, from one to four. A new album is created on
  the phone the first time you put a photo in it
- **Drag onto an album** – the photo is put in that album straight away (tap an album to
  do the same). There's no Save step. **Undo** takes the latest one back out (on iPhone;
  Android doesn't let an app take a photo out of an album)
- **Hold an album for one second** – opens it: you see what's in it, and can **Remove it from
  Photo Sorter** (it only stops showing in the app) or **Delete the album** from the phone,
  which asks first. On iPhone deleting an album keeps its photos in your library; on Android
  the photos in it are deleted too, and the confirmation says so
- **Options** (the gear at the top) – **Choose album types to create** (Family, Friends,
  Travel, Keepers, Kids, Pets, Food, Funny: tap one to put it in the next empty spot, tap
  again to take it out), **Fill empty spots with my albums** (uses the albums with the
  most photos first), and switch between Version 1 (albums along the top and
  bottom) and Version 2 (all the album rows across the bottom); also shows which
  build of the app is running
- **Chess timer** (a button in Options) – a two-player clock. Set either a total time per
  player (with ready-made game types such as Blitz 3+2 or Rapid 15+10, and extra time: increment,
  delay or Bronstein) or a time limit per turn (your clock resets the moment your turn ends; optionally carrying your unused time into your next turn, up to 15
  seconds extra, so going faster gives you longer turns). Two big sides (the top one is upside down for the person
  across from you), and in the middle Options, Start, Pause and Reset (Reset asks first).
  Tap a side before starting to choose who goes first; during play tap your own side when
  you've moved. The side slowly turns red from 10 seconds left down to 5, and the screen
  stays on while it's showing
- **Chess game** (a button in Options) – a full two-player game of chess on one phone laid
  between you: black's pieces are turned to face the player across the table, and each player
  gets a panel with their clock, status and the pieces they've taken. Tap a piece to see where it
  can go, tap a square to move. All the rules are there (castling, en passant, promotion, check,
  checkmate, stalemate and the draw rules). Moves pass the clock automatically, using the same
  time settings as the chess timer, and running out of time ends the game. White moves first
  and sits at the bottom; the rules come from the `chess.js` library
- **Double-tap** – favorite (the phone's real Favorites)
- **Undo** steps back the latest choice, whether it was a trash or an album drop

Photos you swipe past are remembered, so next time the app opens where you left off.

The trash bin is the one safety net for deleting photos:

- **Bin** is the trash bin. Photos wait there for 7 days (or 3, 14 or 30) and can
  be put back with a tap. When their days run out they are deleted from the phone
  the next time the app is opened; the phone asks once to confirm, as it does for
  any app that deletes photos. "Delete all now" empties the bin early. On iPhone,
  deleted photos then sit in Recently Deleted for another 30 days.

Photos only for now; videos are left alone.

## Running it

It's an [Expo](https://expo.dev) app (iOS and Android from one codebase).

```bash
npm install
npx expo start --web   # browser preview with sample pictures, to try the gestures
```

To put it on a phone you need a real build, because it uses the photo library:

```bash
npx eas-cli@latest build --profile preview --platform android   # installable .apk
npx eas-cli@latest build --profile preview --platform ios       # needs an Apple Developer account
```

or, with the phone plugged into a computer that has Xcode / Android Studio:

```bash
npx expo run:ios --device
npx expo run:android --device
```

## Sending updates to the phone (over the air)

Once, from this folder on any computer (needs a free [expo.dev](https://expo.dev) account):

```bash
npx eas-cli@latest login
npx eas-cli@latest init                # creates the project on your Expo account
npx eas-cli@latest update:configure    # adds the update address to app.json; commit that change
npx expo run:ios --device --configuration Release   # install a build that can receive updates
```

After that, to ship a change to the phone:

```bash
git pull
npx eas-cli@latest update --channel production --message "what changed"
```

The app downloads it the next time it's opened (close it fully and reopen; if the
download takes longer than a few seconds it applies on the open after that).

Updates only carry JavaScript and images. If a change adds a package, a permission or
edits `app.json`, bump `version` in `app.json` and install a fresh build with the cable
instead; an old build ignores updates made for a newer `version`.

## Code

| File | What it does |
| --- | --- |
| `App.tsx` | Asks for photo access, then shows the sorter |
| `src/Sorter.tsx` | The main screen: album tiles, timeline, save flow |
| `src/PhotoCard.tsx` | A photo card and its gestures (drag, flick, swipe) |
| `src/Sheets.tsx` | Rename and save-review sheets |
| `src/library.ts` | Photo library calls (`library.web.ts` is the sample-photo stand-in) |
| `src/store.ts` | Album names and unsaved choices, kept between launches |
