> **NEW:** See `MISE_A_JOUR_FR_AR.md` for the YouTube downloader, MP3/MP4 selection, mobile logout, daily quotas, and update instructions.

# ClipStudio Free V2

A responsive public website with English (default), French, Arabic (RTL) and Spanish, automatic light/dark theme, Supabase authentication, per-user projects, history and preferences, and **local browser-based vertical MP4 trimming**.

## What works

- Authenticated YouTube Downloader: thumbnail and title preview, MP4 (430p/720p/1080p/4K/8K maximum requested), MP3 (192 kbps), download progress, temporary download link. Requires the separate Python backend and permission to download the material.
- Always-visible mobile sign out and per-user daily quota feedback (failed processing jobs are refunded).

- Public landing page; Try for Free → sign-up/login
- Supabase Google OAuth, email/password sign-up and login, email recovery
- Personal dashboard, project library, project creation/edit/delete and activity history in Supabase
- Language and appearance saved in each account; initial defaults English / system
- Upload **local** video; trim by start/end time and export 720×1280 MP4 using FFmpeg.wasm in browser. Export may be slow, especially on mobile. FFmpeg core is fetched from unpkg at runtime; an internet connection is required. Video data is not uploaded to Supabase.

## Not yet implemented

- Universal YouTube download support (access can fail due to permissions, formats, or service restrictions)
- Automatic AI subtitles, smart highlight detection, automatic face tracking
- Persistent cloud storage of exported MP4 files; only project metadata/history are saved
- Public multi-user compute backend or admin console

## Install (Windows 11)

1. Install Node.js LTS from https://nodejs.org/
2. Unzip the project and open PowerShell in the folder with `package.json`.
3. Run `npm.cmd install`.
4. Copy `.env.example` to `.env.local`. Paste the exact **Project URL** from Supabase → Project Settings → Data API and **Publishable Key** from Project Settings → API Keys. Do not put any secret key in this file. **Never guess or transcribe keys from screenshots.**
5. In Supabase → SQL Editor, paste and run `supabase/schema.sql` once. It enables RLS and restricts every user's data to their account.
6. In Supabase → Authentication → URL Configuration, set Site URL `http://localhost:5173` and add redirect URL `http://localhost:5173/**` for local testing.
7. In Supabase → Authentication → Sign In / Providers → Google, enable Google. In Google Cloud OAuth Web Client, the **authorized redirect URI** must be the exact Supabase callback URL displayed in the Google provider settings (not `localhost`). Keep the Google client secret **only** in Supabase. If a client secret was ever exposed in a screenshot, rotate it in Google Cloud.
8. Run `npm.cmd run dev` and open the address shown (usually `http://localhost:5173`).
9. Test sign-up, email confirmation, login, Google login, forgot password, project creation, history, settings, and sign-out.

## Publish the website

1. Push the project to a **private or public GitHub repo without `.env.local`**.
2. Cloudflare Pages → Connect to Git → framework Vite, build command `npm run build`, output directory `dist`.
3. Set environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the Pages build settings.
4. After deployment, update Supabase Auth Site URL to the actual `https://your-project.pages.dev` and add `https://your-project.pages.dev/**` to Redirect URLs. Test Google OAuth and password recovery.
5. Public auth emails can have rate limits on the default Supabase email service; configure a suitable SMTP service before a broad public launch.

**Security:** Supabase Publishable Keys are intended for client use; RLS is mandatory and enabled in the SQL. Never commit a Google OAuth Client Secret, Supabase secret/service_role key, database password, or `.env.local`.

**Troubleshooting `Invalid API key`:** verify the project URL and publishable key from the **same** Supabase project, check spelling via copy button, ensure `.env.local` is next to `package.json`, stop/restart Vite (`Ctrl+C`, `npm.cmd run dev`), then hard refresh. If still failing, inspect Network → failing Supabase request response; do not repeatedly rewrite `main.js`.
