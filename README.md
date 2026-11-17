# Photo Sorter

A small phone app for clearing out a photo library one picture at a time.

- **Swipe left** – next photo in the timeline (newest first); **swipe right** – go back
- **Flick up**, or **pinch two fingers together** – move the photo to the trash bin
- **Album spots** – empty dotted spots, four to a row, one row to begin with. Tap a **+**
  to pick one of the albums already on the phone (biggest first), or make a new one. In
  Options you choose how many rows you want, from one to four
- **Drag onto an album** – file the photo there (tap an album to do the same). Hold an
  album for three seconds (a red fill shows the time) to remove it from Photo Sorter or change
  it. Removing only takes it out of the app; the album and its photos stay on the phone
- **Options** (the gear at the top) – **Choose album types to create** (Family, Friends,
  Travel, Keepers, Kids, Pets, Food, Funny: tap one to put it in the next empty spot, tap
  again to take it out), **Fill empty spots with my albums** (uses the albums with the
  most photos first), and switch between Version 1 (albums along the top and
  bottom) and Version 2 (all the album rows across the bottom); also shows which
  build of the app is running
- **Chess timer** (a button in Options) – a two-player clock. Set either a total time per
  player (with ready-made game types such as Blitz 3+2 or Rapid 15+10, and extra time: increment,
  delay or Bronstein) or a time limit per turn. Two big sides (the top one is upside down for the person
  across from you), and in the middle Options, Start, Pause and Reset (Reset asks first).
  Tap a side before starting to choose who goes first; during play tap your own side when
  you've moved. The side slowly turns red from 10 seconds left down to 5, and the screen
  stays on while it's showing
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
