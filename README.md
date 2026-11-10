# Smart Whiteboard

## Run the HTML app

Open `index.html` in a current desktop or mobile browser. The app is self-contained, uses no build step or runtime dependencies, and works offline. Notes and the current draft are stored in that browser's local storage. For the best native share-sheet support on mobile, serve the folder from HTTPS or localhost; otherwise PNG, PDF, and editable exports download as files.

The HTML version includes drawing and color/size controls, selective stroke and text erasing, a segment-preserving duster, editable/movable text, multi-page notebooks, undo/redo, zoom and pan, lined/graph backgrounds, light/dark themes, local notes, automatic draft recovery, import/export, and PNG/PDF/text sharing.

## Run the Android app

The project also includes a native Android implementation.

1. Install Android Studio (with Android SDK Platform 35), JDK 17, and Gradle 8.7.
2. Open this folder in Android Studio and select the local Gradle 8.7 installation if prompted.
3. Run the `app` configuration on an Android 6.0+ device or emulator.
4. To build an APK, use **Build > Build Bundle(s) / APK(s) > Build APK(s)**, or run `gradle assembleDebug` from the project directory after installing Gradle.

Native app features:

- Finger/stylus freehand drawing with color and thickness controls.
- Selective stroke/text erasing and a size-adjustable duster that removes only touched stroke segments.
- Typed text elements with editing, deletion, and drag-to-move.
- Undo/redo, blank/lined/graph backgrounds, and clear-all confirmation.
- Pinch-to-zoom, pan with the Select tool, and light/dark toolbar themes.
- Local notes library with save, reopen, rename, and delete.
- Automatic draft recovery and exports to PNG, PDF, and editable `.swhiteboard` JSON.
- Android Sharesheet integration for installed share targets.

The `.swhiteboard` format is JSON containing normalized stroke coordinates, colors, widths, text, and background settings.
