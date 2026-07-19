# Nightjar — anonymous secrets from strangers

Post a secret anonymously, read random secrets from other people, see how
many strangers have seen yours, and react with emoji only (no comments).

## What's inside

- **Next.js** app (App Router) for the frontend
- **Supabase** (hosted Postgres) for storage — free tier is plenty to start
- No login system: secrets are anonymous by design, and "seen"/"reacted"
  tracking happens in the visitor's own browser (localStorage), not tied to
  any identity

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free account + new project.
2. Once it's ready, open **SQL Editor** in the left sidebar.
3. Paste the entire contents of `supabase/schema.sql` from this project and click **Run**.
   This creates the `secrets` table and the three functions the app calls
   (`get_random_secret`, `increment_view`, `add_reaction`), with row-level
   security so visitors can only read secrets, insert new ones, and call
   those specific functions — nothing else.
4. Go to **Project Settings -> API**. Copy the **Project URL** and the
   **anon public** key.

## 2. Configure the app locally

```bash
cp .env.local.example .env.local
```

Paste your Project URL and anon key into `.env.local`.

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`.

## 3. Deploy it for real

The easiest path is **Vercel** (made by the creators of Next.js, free tier available):

1. Push this project to a GitHub repo.
2. Go to [vercel.com](https://vercel.com), click **New Project**, and import that repo.
3. In the project's **Environment Variables** settings, add the same two
   variables from your `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Click **Deploy**. You'll get a live URL in about a minute.

You can also deploy to Netlify, Render, or your own server — any host that
runs Next.js will work, as long as those two environment variables are set.

## How the anonymity/abuse tradeoffs work

- Anyone can post — there's no moderation built in. If you plan to make this
  public, consider adding a profanity filter or a manual review step before
  secrets go live (this would mean inserting into a `pending_secrets` table
  first, then approving into `secrets`).
- View counts and reactions are incremented through Postgres functions, not
  direct table updates, so visitors can't edit other fields.
- "Already seen" and "already reacted" tracking lives in each visitor's
  browser storage. It resets if they clear their browser data or switch
  devices — that's a reasonable tradeoff for staying anonymous and login-free.

## Customizing

- Reaction emoji set: change the `EMOJIS` array in `app/page.js` and the
  matching check inside `add_reaction` in `supabase/schema.sql`.
- Secret length limit: change `500` in `MAX_LEN` (`app/post/page.js`) and in
  the `check` constraint + `add_reaction`/insert policy in `schema.sql`.
- Visual design lives in `app/globals.css`.
