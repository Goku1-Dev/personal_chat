# Private chat

A private, two-person messaging app. One link, one password, one conversation.

Built with React, Vite, TypeScript, SCSS, React Router, Supabase (Auth,
Postgres, Realtime) and Lucide icons. It runs comfortably inside the free tier
of both Supabase and Vercel.

The flow is deliberately short:

```
Instagram story link  →  password screen  →  chat
```

No landing page, no signup, no navigation to get lost in.

---

## What it does

- A password gate that checks the password **on the server**, never in the browser
- Realtime messages, edits and deletions in both directions
- Edit and delete your own messages — and only your own, enforced by the database
- Multi-select with a selection toolbar, plus "delete all my messages"
- "Clear chat" that hides history **for you only** and deletes nothing
- Typing indicator and read receipts (✓ sent, ✓✓ read)
- Date dividers, friendly timestamps, grouped message runs
- Auto-scroll that yields when you are reading back, with a "new message" pill
- Reconnection status that never blocks the interface
- Built for a phone first: safe-area padding, keyboard-aware layout, touch menus

Admin and user have **the same chat permissions**. Admin gets one extra
read-only screen at `/admin`, and no power at all over the other person's
messages.

---

## Setup

You will do this once, in about fifteen minutes.

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project

At [supabase.com](https://supabase.com), create a free project. From
**Project Settings → API**, copy the **Project URL** and the **anon public**
key.

### 3. Configure Auth

Go to **Authentication → Providers** and make sure **Email** is enabled.
Turn **off** "Enable email signups" — the only two accounts that should ever
exist are the ones you create by hand in the next steps.

### 4. Run `schema.sql`

Open **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, and
run it. This creates the tables, indexes, constraints, triggers, RLS policies
and realtime configuration in one pass. It is safe to run again later.

### 5. Create the two participant accounts

**Authentication → Users → Add user**, twice. Tick **Auto Confirm User** both
times so neither account needs to click a confirmation email.

| Account | Email | Password |
| --- | --- | --- |
| Admin | your real email | one you will actually type |
| User | anything, e.g. `chat-user@yourdomain.com` | long and random — nobody ever types this |

The user account's password is never typed by anyone. It lives only in a
Supabase secret and is used by the Edge Function on your behalf. Generate
something like:

```bash
openssl rand -base64 32
```

Copy the **User UID** of each account from the users list.

### 6. Configure roles

Back in the SQL editor, with the two UUIDs you just copied:

```sql
select public.setup_participants(
  'ADMIN-UUID-HERE'::uuid, 'Your name',
  'USER-UUID-HERE'::uuid,  'Their name',
  'Our Chat'
);
```

This writes both `profiles` rows, creates the conversation, and links both
people to it. It returns the conversation id. Run it again any time to change
the display names.

### 7. Enable Realtime

`schema.sql` already added `messages` to the `supabase_realtime` publication.
Confirm it under **Database → Replication → supabase_realtime**; `messages`
should be listed.

### 8. Check RLS

Under **Authentication → Policies**, every one of `profiles`, `conversations`,
`conversation_participants`, `messages` and `chat_clears` should show **RLS
enabled**. If any table shows otherwise, re-run `schema.sql`.

### 9. Set the password secret

Install the Supabase CLI and link the project:

```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR-PROJECT-REF
```

Then set the secrets. **None of these are ever sent to the browser.**

```bash
supabase secrets set \
  SITE_PASSWORD='the password you put in your story' \
  CHAT_USER_EMAIL='chat-user@yourdomain.com' \
  CHAT_USER_PASSWORD='the long random password from step 5' \
  ALLOWED_ORIGIN='https://your-domain.vercel.app'
```

`ALLOWED_ORIGIN` is optional but worth setting once you know your domain; it
stops other sites calling the function from a browser.

### 10. Deploy the Edge Function

```bash
supabase functions deploy verify-password
```

### 11. Add environment variables

Locally, copy the example file and fill in the two public values:

```bash
cp .env.example .env
```

```env
VITE_SUPABASE_URL=https://yourproject.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

In Vercel, add the same two variables under **Settings → Environment
Variables**, for Production, Preview and Development.

Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` belong here. The anon key
is public by design — RLS is what protects the data. The site password and the
service-role key must never appear in a `VITE_` variable.

Two optional variables:

| Variable | Default | Effect |
| --- | --- | --- |
| `VITE_CHAT_TITLE` | `Our Chat` | The name in the chat header |
| `VITE_SESSION_PERSISTENCE` | `local` | `session` drops the login when the tab closes |

### 12. Deploy to Vercel

```bash
npm run build     # verify it builds locally first
```

Then import the repository at [vercel.com](https://vercel.com). It detects Vite
automatically; `vercel.json` handles SPA routing, `noindex` headers and asset
caching. Deploy, and put the resulting URL in your story.

---

## Testing it

### 13. Test the user flow

Open the deployed URL on a phone. You should see the password screen. A wrong
password is rejected with an inline message; the right one opens the chat.

### 14. Test the admin flow

Open the same URL, tap **Sign in as admin**, and use the admin email and
password from step 5. You land in the same chat, with an extra shield icon in
the header leading to `/admin`.

### 15. Test realtime

Open the chat as admin in one browser and as the user in another (a private
window works). Send from each side. Messages should appear on the other screen
with no refresh, on the correct side, with a typing indicator while the other
person writes.

### 16. Test edit and delete

Tap your own message: **Edit**, **Copy text**, **Select**, **Delete**. Tap the
other person's message: only **Copy text** and **Select**. Edit something and
confirm the `edited` marker appears on both screens. Delete something and
confirm it disappears from both.

### 17. Test multi-select delete

Open the header menu → **Select messages**. Tap several bubbles, including one
of theirs. The toolbar counts what you picked and tells you how many you can
actually delete. Delete, confirm, and check their message survived.

Also worth checking:

- Direct access to `/chat` while logged out redirects to the password screen
- `/admin` as the non-admin participant redirects to `/chat`
- Log out from the menu, then confirm `/` shows the password screen again
- At 360px width there is no horizontal scrolling and the keyboard never covers
  the input

---

## Running locally

```bash
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build
npm run preview    # serve the build
```

The password gate calls your deployed Edge Function even in development, so
step 10 needs to be done before the gate will let you in.

---

## How the security works

The short version: **the browser is never trusted with anything.**

- The site password exists only as a Supabase secret. The Edge Function
  compares it in constant time and returns a session, so a wrong guess learns
  nothing and the right one never reveals the value.
- `sender_id` defaults to `auth.uid()` in the database and is rejected by the
  insert policy if it is anything else. A hand-written request cannot send a
  message as the other person.
- A trigger makes `id`, `conversation_id`, `sender_id` and `created_at`
  immutable, so an update cannot move a message to another owner or another
  conversation.
- Update and delete policies both require `sender_id = auth.uid()`. The UI
  hides Edit and Delete on the other person's messages; the database would
  refuse them anyway.
- `read_at` cannot be set by the sender. Receipts go through one narrow
  `security definer` function that only ever marks the *other* person's
  messages.
- Every table denies `anon` entirely. Nothing is readable without a session.
- The service-role key is not used anywhere — not in the app, not in the Edge
  Function.

"Clear chat" is per-person by design. It writes a timestamp to `chat_clears`
and hides everything before it for you alone. There is no operation in this app
that destroys the conversation for both people at once.

---

## Project structure

```
src/
├── components/
│   ├── Chat/        ChatHeader, MessageList, MessageBubble, MessageInput,
│   │                MessageMenu, SelectionToolbar, DeleteDialog, TypingIndicator
│   ├── Auth/        PasswordGate, ProtectedRoute
│   └── UI/          Modal, Sheet, Spinner, Toast
├── context/         AuthContext, ToastContext
├── hooks/           useAuth, useMessages, useRealtimeChat, useToast, useViewportHeight
├── lib/             supabase, format, errors
├── pages/           Password, Chat, Admin
├── styles/          variables.scss, mixins.scss, global.scss
├── types/           chat.ts
├── App.tsx
└── main.tsx

supabase/
├── schema.sql
└── functions/verify-password/index.ts
```

---

## Notes

There is no attachment button. Image and file uploads were out of scope, and a
button that does nothing is worse than no button — if you want them later,
Supabase Storage plus a `message_type` of `'image'` is the natural extension;
the column is already there.

Messages load 40 at a time, newest first, and older ones arrive as you scroll
up. The indexes in `schema.sql` cover that query, the per-sender deletes and the
unread count.
