# MiyeeUpskill (Supabase-backed)

This is the Supabase-connected version of MiyeeUpskill. It's a set of static
HTML/JS/CSS files, there is no build step and no server code, so it can be
hosted directly on GitHub Pages.

## What's in here

- `index.html` - login page (Supabase Auth)
- `dashboard.html` - founder landing page
- `admin.html` - admin/mentor landing page
- `forgot.html` / `reset.html` - password reset flow
- `config.js` - your Supabase Project URL and public key (already filled in)
- `common.js` - shared login/session helpers
- `style.css` - the MiyeeUpskill navy/gold theme
- `assets/` - logo and favicon

## Deploying to GitHub Pages

1. Create a new GitHub repository (e.g. `MiyeeUpskill`), or use an existing
   one, e.g. your `vipinnairv.github.io` repo works too, in which case you
   may want to put these files in a subfolder like `/miyeeupskill/`.
2. Upload every file in this folder to that repository, keeping the folder
   structure exactly as-is (the `assets/` folder must stay a folder, and
   `.nojekyll` must be included even though it looks empty, it's a real
   file GitHub Pages checks for).
3. In the repository, go to **Settings -> Pages**.
4. Under **Source**, choose **Deploy from a branch**, pick the `main`
   branch and the `/ (root)` folder (or `/miyeeupskill` if you used a
   subfolder), then Save.
5. GitHub will give you a URL, usually
   `https://<your-username>.github.io/<repo-name>/`
   (or `https://vipinnairv.github.io/miyeeupskill/` if using a subfolder).
   It can take a minute or two to go live the first time.

## One Supabase setting you must update after deploying

Supabase needs to know your live URL is allowed to receive auth redirects
(this matters for the password reset flow, and for security in general).

1. Go to your Supabase dashboard -> **Authentication -> URL Configuration**.
2. Under **Site URL**, enter your GitHub Pages URL, e.g.
   `https://vipinnairv.github.io/miyeeupskill/`
3. Under **Redirect URLs**, add the same URL (and optionally
   `http://localhost:8000/*` if you still want local testing to work).
4. Save.

Without this step, password reset emails will still send, but the link
inside them may not redirect back to your site correctly.

## Testing locally before you deploy

From inside this folder, run:

```
python -m http.server 8000
```

Then open `http://localhost:8000` in your browser. Do not just double-click
`index.html`, Supabase Auth can behave inconsistently on a plain `file://`
page, always test through a real `http://` address, whether local or live.

## Login credentials already set up

- Admin: audit.vipin@gmail.com
- Founder: vipinnair@icai.org

(passwords are whatever you set in Supabase Authentication -> Users)

## Developed by

Vipin Nair
