# Cross-posting setup — TikTok · Instagram Reels · Facebook Reels

Your pipeline already renders one 1080×1920 mp4 per video. Cross-posting sends
that **same file** to every platform in `PLATFORMS`, so you triple+ your reach for
zero extra render cost. This doc covers the one-time account/API setup — the code
is already wired.

```bash
npx tsx src/cli.ts platforms      # see what's configured vs missing
npx tsx src/cli.ts crosspost      # fan already-rendered videos to all platforms
npx tsx src/cli.ts cycle          # produce + cross-post one video per lane
```

Each platform self-skips if its keys are missing, so you can turn them on one at
a time. Start with TikTok (highest reach, no hosting needed), then Meta.

---

## 1. TikTok  (`tiktok-token.json`)

TikTok's **Content Posting API** posts your video. Two modes:

- **Inbox / draft (default, works immediately):** the video lands in your TikTok
  app inbox and you tap "Post". Near-passive — one tap per video.
- **Direct post (full auto):** requires your app to pass TikTok's Content Posting
  API **audit**. Once approved, set `TIKTOK_DIRECT_POST=1`.

**Setup:**
1. Go to [developers.tiktok.com](https://developers.tiktok.com) → **Manage apps** →
   create an app.
2. Add the **Content Posting API** product. Request scopes **`video.upload`** and
   **`video.publish`**.
3. Under **Login Kit**, add the redirect URI **exactly**: `http://localhost:4712/`
   (if TikTok rejects a non-HTTPS URI, see the note below).
4. Copy the **Client key** and **Client secret** into `.env`:
   ```
   TIKTOK_CLIENT_KEY=...
   TIKTOK_CLIENT_SECRET=...
   ```
5. Authorize once:
   ```bash
   npx tsx src/cli.ts tiktok-auth
   ```
   This opens a browser, catches the redirect, and saves `tiktok-token.json`
   (auto-refreshed thereafter).

> **If TikTok won't accept `http://localhost`:** some apps require HTTPS redirects.
> In that case, generate a token manually from the developer portal's token tool,
> and paste it into `tiktok-token.json` as
> `{"access_token":"…","refresh_token":"…","expires_at":<epoch-seconds>}`.

---

## 2. Cloudflare R2  (required for Instagram + Facebook)

Meta doesn't accept a file upload for Reels — it **fetches the video from a public
URL**. R2 is the cheapest host (no egress fees).

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **R2** → **Create bucket**
   (e.g. `shorts-reels`).
2. Bucket → **Settings** → **Public access** → enable the **r2.dev** subdomain
   (or attach a custom domain). Copy that public URL.
3. **R2 → Manage API Tokens → Create token** (Object Read & Write). Copy the
   Access Key ID + Secret.
4. Fill `.env`:
   ```
   R2_ACCOUNT_ID=...            # the hex id in your R2 endpoint / dashboard URL
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET=shorts-reels
   R2_PUBLIC_BASE_URL=https://pub-xxxxxxxx.r2.dev   # the public origin from step 2
   ```

---

## 3. Instagram Reels + Facebook Reels  (`META_ACCESS_TOKEN`)

One Meta app + one token covers both. Prerequisites:

- A **Facebook Page**.
- An **Instagram Business/Creator** account, **linked to that Page**.

**Setup:**
1. [developers.facebook.com](https://developers.facebook.com) → **My Apps** →
   **Create App** → type **Business**.
2. Add products: **Instagram Graph API** and **Facebook Login**.
3. In the **Graph API Explorer** (Tools menu), select your app and generate a
   **User token** with these permissions:
   `instagram_basic`, `instagram_content_publish`,
   `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
   `business_management`.
4. **Exchange for a long-lived token** (~60 days) so it doesn't expire daily:
   ```
   GET https://graph.facebook.com/v21.0/oauth/access_token
       ?grant_type=fb_exchange_token
       &client_id=<APP_ID>&client_secret=<APP_SECRET>
       &fb_exchange_token=<SHORT_TOKEN>
   ```
   (For a token that never expires, exchange it once more for a **Page** token via
   `GET /me/accounts` — recommended for a cron.)
5. Get your ids:
   - **Page id:** `GET /me/accounts` → your Page's `id`.
   - **IG Business user id:** `GET /<PAGE_ID>?fields=instagram_business_account`.
6. Fill `.env`:
   ```
   META_ACCESS_TOKEN=<long-lived token>
   IG_USER_ID=<instagram_business_account id>
   FB_PAGE_ID=<page id>
   ```

---

## 4. Go

```bash
npx tsx src/cli.ts platforms     # everything should read "✓ ready"
npx tsx src/cli.ts crosspost     # post what you've already rendered
```

Then the daily `cycle` command (and the GitHub Action) fans every new video out to
all four platforms automatically. Each platform is separately monetized — this is
the highest-ROI change you can make to the channel.

## Reminder: capture the audience before you sell to it

`NEWSLETTER_URL` in `.env` auto-becomes the CTA on every description across all
platforms. Point it at a free newsletter now; swap in affiliate links (via `CTA`)
once you have traffic. That owned audience is worth far more than raw Shorts RPM.
