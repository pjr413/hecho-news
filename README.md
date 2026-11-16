# Photo Sorter

A small phone app for clearing out a photo library one picture at a time.

- **Swipe left** – next photo in the timeline (newest first); **swipe right** – go back
- **Flick up** – move the photo to the trash bin
- **Add album** – there are no albums at first, just an Add album button. Add up to
  eight: four along the top, then four more along the bottom
- **Drag onto an album** – file the photo there (tap an album to do the same;
  hold it to rename)
- **Double-tap** – favorite (the phone's real Favorites)
- **Undo** steps back through anything not yet saved

Photos you swipe past are remembered, so next time the app opens where you left off.

Nothing touches the photo library straight away:

- **Save** files the keepers into their albums.
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

## Code

| File | What it does |
| --- | --- |
| `App.tsx` | Asks for photo access, then shows the sorter |
| `src/Sorter.tsx` | The main screen: album tiles, timeline, save flow |
| `src/PhotoCard.tsx` | A photo card and its gestures (drag, flick, swipe) |
| `src/Sheets.tsx` | Rename and save-review sheets |
| `src/library.ts` | Photo library calls (`library.web.ts` is the sample-photo stand-in) |
| `src/store.ts` | Album names and unsaved choices, kept between launches |
