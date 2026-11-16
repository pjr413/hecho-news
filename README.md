# Photo Sorter

A small phone app for clearing out a photo library one picture at a time.

- **Flick up** – throw the photo in the trash
- **Drag onto a tile** – four albums along the top, four along the bottom
- **Double-tap** – favorite (the phone's real Favorites)
- **Swipe sideways** – keep it and move on
- **Tap a tile** to file the current photo there; **hold a tile** to rename its album
- **Undo** steps back through anything not yet saved

Nothing touches the photo library until **Save**. Save shows what's about to
happen (tap a trashed photo to rescue it), then files the keepers into albums and
deletes the rest in one go, so the phone only asks for confirmation once. On
iPhone, deleted photos go to Recently Deleted for 30 days.

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

## Code

| File | What it does |
| --- | --- |
| `App.tsx` | Asks for photo access, then shows the sorter |
| `src/Sorter.tsx` | The main screen: album tiles, card stack, save flow |
| `src/PhotoCard.tsx` | The draggable card and its gestures |
| `src/Sheets.tsx` | Rename and save-review sheets |
| `src/library.ts` | Photo library calls (`library.web.ts` is the sample-photo stand-in) |
| `src/store.ts` | Album names and unsaved choices, kept between launches |
