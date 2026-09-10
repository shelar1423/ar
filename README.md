# Pocket Track AR

Ballistik toy racing prototype, created separately from plan-main. Uses the supplied real GLB, not a replacement model. No API key, Unity, Blender or MCP needed to play.

## Run

`npm install` then `npm run dev`. Production: `npm run build`. Type check: `npx tsc --noEmit`. Headless gameplay checks: `node scripts/smoke.mjs`.

## Play

Drag the car to orbit in the garage. Choose Race in 3D. Hold GO to accelerate, use left/right to change one of three lanes, hold boost for extra speed, and dodge the dark blocks. Gold rings add coins and boost. Finish three laps before 60 seconds. On desktop: W/up, A/D/left/right, S/down, Space, P.

Play in your space checks immersive WebXR support. On compatible phones and browsers, it requests camera-backed AR, surface hit tests and DOM overlay for touch controls. Scan a well-lit surface and press Place racetrack. The track is about 1.3 metres wide. Unsupported devices can play in 3D. HTTPS is required for phone AR; a plain local-network HTTP address is insufficient. iPhone users should use 3D if their browser does not expose immersive-ar. No camera imagery is uploaded by game code.

## iPhone modes

In Safari, View car in iPhone AR converts the supplied car to USDZ on device. After preparation, tap Place car in AR to open Apple's native viewer. This places the car in your surroundings but does not run the browser race inside Quick Look.

Camera race requests the rear camera and runs the game over its live feed. The track stays fixed on screen; it is not world-anchored AR. Hold the phone still while racing. Camera streams stop when you return to the garage or leave the page. Race in 3D does not request camera access.

## Model attribution

Hot Wheels - Unleashed 2: Ballistik by Zorg_Sinister, supplied by the user.
Source: https://sketchfab.com/3d-models/hot-wheels-unleashed-2-ballistik-3e2a310334d649ed8c89b9a60d356d12
Embedded asset metadata states CC BY 4.0: https://creativecommons.org/licenses/by/4.0/
The game normalizes scale and orientation at runtime. No affiliation with Mattel, Hot Wheels or Blinkit is implied. Original textures are embedded in public/models/ballistik.glb.

## Validation limits

Build, type checks and headless gameplay tests validate code and game rules. Actual WebXR surface tracking, camera permissions and physical phone performance require on-device testing. WebMCP is optional and feature-detected; the headless contract test is not a supported browser WebMCP integration test.
