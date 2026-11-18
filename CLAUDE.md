# Working with the owner of Dr Pocket

Read `HANDOFF.md` first: it says where the project stands, how it fits together and what is still open.

## How the owner wants to work

The owner gives an instruction and walks away. When they come back, it should be **finished and live**.

- **Finish the whole job in one go.** Build it, test it (Playwright at iPhone size, light and dark), fix what the
  tests show, update `HANDOFF.md`, commit and push to the work branch, all in the same turn.
- **Going live:** when the owner's instruction says to push it live ("push to main", "push it live"), push to
  `main` in that same turn (it deploys to https://dr-pocket-two.vercel.app) and check the Vercel deployment is
  READY. Otherwise, end by saying it is ready on the preview branch and that "push to main" will put it live.
- **Don't wait on questions you can answer yourself.** Pick the sensible default, say which one you picked, and
  carry on. Ask only when a choice really is the owner's and cannot be undone (spending money, deleting their data,
  changing the brand).
- **Avoid steps that need the owner to approve something.** The Supabase connection asks the owner to confirm
  any SQL that deletes data, so don't create throwaway test accounts unless a screenshot truly needs one, and if
  you do, delete everything in a single statement at the end. Never put secrets in chat.
- **Show visual changes as screenshots** in the final message, because the owner is particular about look and
  feel (see the brand guide notes in `HANDOFF.md`).
- **Write the final message for someone who wasn't watching:** what changed, that it is live, anything they need
  to do on their phone, and anything that could not be done (with the reason). Plain words, short.

## Project notes

- Branch for work: `claude/exciting-shannon-bia9g9` (fast-forward `main` to it when done), or work on `main`
  directly if the session's branch rules allow it.
- My health (the journal) is the main product: `health/index.html`, `src/health/`, `api/progress.js`,
  `api/evening.js`, migrations in `supabase/migrations/`. The 3D body and scan explainer live at `/`.
- Database: Supabase project `lpdvppqtpatbzvrrgdnr`. Hosting: Vercel project `prj_o7cwssWLQt53fCWMZcvzEJ8cFOTw`
  in team `team_NqhNnG5PYU2gClsXdgoQMbOE`.
- The cloud sandbox needs `lpdvppqtpatbzvrrgdnr.supabase.co` allowed and `NODE_USE_ENV_PROXY=1` for Node to reach it.
