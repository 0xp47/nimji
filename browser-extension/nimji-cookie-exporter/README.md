# Nimji Cookie Exporter (Browser Extension)

Small Chrome/Chromium extension that extracts the values this project requires:

- `COOKIES`
- `AT_TOKEN`
- `F_SID`

It listens to Gemini web requests and builds a ready-to-paste env block.

## Load Extension (Developer Mode)

1. Open `chrome://extensions` (or Edge equivalent).
2. Enable Developer Mode.
3. Click **Load unpacked**.
4. Select the `nimji-cookie-exporter` folder from this repository.

## Capture Values

1. Open `https://gemini.google.com` while signed in.
2. Send one prompt (this creates a StreamGenerate request containing `at` and `f.sid`).
3. Open the extension popup.
4. Click **Refresh**.
5. Click **Copy Export** and paste into `.env` or `config.jsonc`.

## Notes

- `COOKIES` is generated from current cookies available to `https://gemini.google.com/`.
- `AT_TOKEN` and `F_SID` are captured from request payload/query.
- If popup shows missing values, send another prompt in Gemini and refresh.
