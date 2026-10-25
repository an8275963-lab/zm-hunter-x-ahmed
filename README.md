# ZM HUNTER X AHMED — WhatsApp Anti-Link MD Bot

This project contains a small dashboard plus a Baileys-based WhatsApp bot. It provides both QR login and pairing-code login, basic group link deletion, and admin commands.

## Requirements
- Node.js 20 or newer
- A supported host or a computer/Android Termux that can keep Node.js running
- The WhatsApp account you are linking
- The bot account must be made a group admin for deleting other members' messages

## Run locally
1. Install Node.js 20+.
2. Extract this ZIP.
3. In the project folder, run:
   ```bash
   npm install
   ```
4. (Recommended) copy `.env.example` to `.env` and set a strong `DASHBOARD_PASSWORD`.
5. Start:
   ```bash
   npm start
   ```
6. Open `http://localhost:3000`.

## QR login
Open the dashboard and scan the QR using WhatsApp → Linked devices → Link a device. The QR is short-lived and refreshes as the library provides a new one.

## Pairing-code login
Enter your full phone number with country code, digits only (no plus sign), then press Generate pairing code. In WhatsApp, open Linked devices → Link with phone number and enter the code.

Use QR or pairing code for the same account/session; do not try to link two separate numbers into the same session folder. If you need to change accounts, stop the app and remove `auth_info_baileys` before starting again. This deletes the saved login session.

## Group setup
1. Add the linked WhatsApp account to the target group.
2. Promote it to group admin.
3. Keep `.antilink on` enabled.
4. Test with a non-admin account. Admin links are intentionally exempt.
5. Commands: `.menu`, `.ping`, `.alive`, `.antilink on`, `.antilink off`, `.welcome on`, `.welcome off`, `.rules`.

## Important limitations
- This uses an unofficial WhatsApp Web library, not the official WhatsApp Business API. WhatsApp may change behavior or restrict accounts; use at your own risk and comply with WhatsApp's terms.
- Link detection is pattern-based. It catches common URLs/domains but cannot reliably identify every obfuscated link, every new domain, or the final destination of every short link.
- Deletion requires the bot account to be a group admin and WhatsApp to permit the action.
- The welcome toggle is included as a setting, but automatic new-member welcome handling is not implemented in this starter version.
- The dashboard password is optional in development. Set `DASHBOARD_PASSWORD` in production, and use HTTPS. Do not expose an unprotected dashboard publicly.
- Keep `auth_info_baileys` private. Anyone who gets the session credentials may gain access to the linked WhatsApp account. Never share QR codes or pairing codes.
- For reliable 24/7 hosting, use a host with persistent storage. Free hosts may sleep or erase sessions; check the provider's current limits. Do not assume a free deployment will stay online.

## Deploy
Use a Node.js host that supports persistent disk storage. `render.yaml` is an example configuration, but plan/disk availability depends on the provider's current offering. Configure `DASHBOARD_PASSWORD` in the host's environment settings before exposing the dashboard.
