# Chicken Counter — Mobile

Two pieces:
- `proxy/` — a Cloudflare Worker that holds your Roboflow key and returns
  only a count. Deploy this first.
- `app/` — the Expo (React Native) phone app. It never sees the Roboflow key.

## 1. Deploy the proxy

```bash
cd proxy
npm install -g wrangler        # one-time
wrangler login                 # opens a browser to link your Cloudflare account (free tier is fine)

# Secrets (never go in wrangler.toml or git):
wrangler secret put ROBOFLOW_API_KEY
# paste a FRESH Roboflow key here — generate a new one in your dashboard,
# don't reuse a key that's been pasted anywhere insecure before

wrangler secret put APP_TOKEN
# paste any long random string, e.g. output of: openssl rand -hex 32
# this is what the app sends to prove it's allowed to call the proxy

wrangler deploy
```

Wrangler prints a URL like `https://chicken-count-proxy.YOURNAME.workers.dev`
— copy it.

## 2. Set up the Expo app

```bash
npx create-expo-app chicken-counter --template blank-typescript
```

Then, from inside the new `chicken-counter` folder it creates:
1. Delete the placeholder `App.tsx` it generated.
2. Copy this project's `app/App.tsx` and `app/src/` folder in, replacing
   what's there.
3. Install the packages the app actually uses (this resolves the right
   versions for your Expo SDK automatically):

```bash
npx expo install expo-image-picker expo-image-manipulator expo-linear-gradient react-native-safe-area-context @expo/vector-icons expo-font expo-camera
```

- `react-native-safe-area-context` replaces the deprecated `SafeAreaView`
  from plain `react-native`.
- `expo-linear-gradient` and `@expo/vector-icons` are used by the current
  (green) design — icons, badges, and the header gradient. `expo-font`
  is a peer dependency of `@expo/vector-icons` — Expo Go includes it
  automatically so this can work in testing without it, but an EAS
  build will fail at the "Run expo doctor" step if it's missing from
  the project directly.
- `expo-camera` powers **Auto-capture**: a live camera view that fires 3
  photos automatically, separate from the one-at-a-time native camera
  used for manual photos.

### Required: camera permission config (for Auto-capture)

`expo-camera` needs a permission description registered in `app.json`, or
the Auto-capture screen will fail to open. Open `app.json` in your
project root and merge in a `plugins` entry (don't replace anything else
already in the file):

```json
{
  "expo": {
    "plugins": [
      [
        "expo-camera",
        {
          "cameraPermission": "Allow Chicken Counter to access your camera to count chickens."
        }
      ]
    ]
  }
}
```

After editing `app.json`, stop and restart `npx expo start` — a plugin
change isn't picked up by Fast Refresh, it needs a full restart.

4. Open `src/config.ts` and fill in the two values from step 1:

```ts
export const API_URL = "https://chicken-count-proxy.YOURNAME.workers.dev";
export const APP_TOKEN = "the-same-random-string-you-set-as-APP_TOKEN";
```

## 3. Run it

```bash
npx expo start
```

Scan the QR code with the **Expo Go** app on your phone (install it from
the Play Store first). The app should open with a "Take Photo" / "From
Gallery" screen. Grant camera and gallery permissions when asked.

Test flow:
1. Tap **Take Photo** three times (or mix in **From Gallery**) → a
   completed set appears below.
2. Repeat for a second set.
3. Tap **Count Chickens** → progress ticks through each image → a total
   appears at the bottom.
4. Try **Edit** and **Delete** on a set before counting, to confirm those
   work too.

## 4. Build the installable APK (once it works in Expo Go)

```bash
npm install -g eas-cli
eas login                  # free Expo account — sign up at expo.dev if you don't have one
eas build:configure        # generates eas.json with development/preview/production profiles
```

`eas build:configure` will also ask to set `android.package` in
`app.json` if it isn't already there (something like
`com.yourname.chickencounter`) — accept that, it's required for Android
builds.

**Important:** EAS defaults to building a Play Store `.aab` file even
on the `preview` profile — that's not directly installable on a phone.
Open the `eas.json` it just generated and add `"buildType": "apk"` to
the `preview` profile:

```json
{
  "build": {
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    }
  }
}
```

(Keep the rest of the generated file as-is — just add the `"android"`
block into the existing `"preview"` section.)

Then kick off the actual build:

```bash
eas build --platform android --profile preview
```

The first time, EAS will ask about Android signing credentials — let it
generate and manage a new keystore for you (the default/easy option).
This takes several minutes in EAS's build queue; the terminal shows a
link to watch progress live. When it finishes, you get a QR code and a
download link — that link is what you use to install on each of the 3
phones (direct link, USB/ADB, or Firebase App Distribution, per our
earlier planning).

### Back up your signing keystore

Since EAS is managing your keystore, pull a backup now while it's fresh:

```bash
eas credentials
```

Select Android → your build profile → "Download credentials" (wording
varies slightly by CLI version). Store that file somewhere safe outside
this project folder — losing it means any future build can't update the
same app installation; phones would need a full uninstall/reinstall
instead of a clean update.

## Notes

- Photos are resized to ~1600px JPEG before upload (`src/imagePrep.ts`) —
  keeps uploads fast on mobile data.
- Failed uploads retry automatically up to 3 times with backoff
  (`src/api.ts`) — a flaky connection won't kill a whole run.
- `CONFIDENCE` (detection threshold) lives in `proxy/wrangler.toml`, not
  in the app — so you can retune it without rebuilding/reinstalling the
  APK. Change it and run `wrangler deploy` again.
- If you lose a phone, rotate `APP_TOKEN` (`wrangler secret put APP_TOKEN`
  with a new value, then `wrangler deploy`) and rebuild the app with the
  new token in `config.ts` — the old APK will stop working immediately.

## App name, icon, and splash screen

A fresh Expo project ships with the generic Expo logo and the name
"chicken-counter-mobile" (or whatever you typed when creating it) — here's
how to replace both.

### 1. Copy in the icon files

Copy the 4 files from this project's `app/assets/images/` folder into
your actual project's `assets/images/` folder, **overwriting** the
default ones Expo generated (same filenames: `icon.png`,
`adaptive-icon.png`, `splash-icon.png`, `favicon.png`) so your existing
`app.json` paths keep working with no further edits needed there.

If your project's assets happen to live directly under `assets/` instead
of `assets/images/` (older template layout), copy them there instead —
check which one your `app.json` already points at.

### 2. Set the app name

Open `app.json` and find the `"name"` field near the top of the `"expo"`
object. Change it to:

```json
"name": "Chicken Counter",
```

This is the name shown under the icon on the phone's home screen — not
the same as `"slug"` (used internally for build URLs), which you can
leave alone.

### 3. Confirm the splash screen plugin

Current Expo projects already wire up `expo-splash-screen` in the
`plugins` array of `app.json`, pointing at `splash-icon.png` — since
you're overwriting that exact file in step 1, the splash screen updates
automatically with no config changes needed. Just double check an entry
like this already exists:

```json
"plugins": [
  [
    "expo-splash-screen",
    {
      "image": "./assets/images/splash-icon.png",
      "resizeMode": "contain",
      "backgroundColor": "#15402E"
    }
  ]
]
```

If `backgroundColor` is set to something else (often `#ffffff` by
default), changing it to `#15402E` (the app's deep green) makes the
splash background match the app icon instead of flashing white first.

### 4. Restart to see the changes

Icon and splash changes aren't picked up by Fast Refresh. Stop
`npx expo start`, restart it, and reload the app on your phone (close
Expo Go and reopen, or shake for the dev menu → Reload).

Note: Expo Go always shows your app icon in place of the real splash
screen while developing — to see the actual splash screen behavior,
you'll need an EAS build (the `.apk` from Part 4), not the Expo Go
preview.
#   c h i c k e n - c o u n t e r  
 