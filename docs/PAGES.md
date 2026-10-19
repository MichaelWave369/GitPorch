# Publishing the GitPorch public showcase to GitHub Pages

This is a **static public demonstration**, not a remotely accessible GitPorch host. The real app and its bare repositories remain local.

## Deploy after merging the Pages PR

1. Open **GitPorch → Settings → Pages**: https://github.com/MichaelWave369/GitPorch/settings/pages
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch **main**, folder **/docs**, then **Save**.
4. Wait for Pages to finish publishing. Its expected project-site URL is:
   https://michaelwave369.github.io/GitPorch/
5. Open the URL and confirm the page labels repository data **FICTIONAL / DEMO**, that search works, and that no local machine services are contacted.

The normal GitHub Pages branch publishing pipeline may be delayed when GitHub Pages is degraded. There is **no project-specific GitHub Actions workflow** to compile this site and no npm or third-party CDN dependency.

## Isolation guarantees

- `docs/index.html`, `docs/styles.css` and `docs/app.js` contain only static assets and deliberately fictional demo fixtures.
- No fetches, websockets, forms posting data, authentication tokens or connections to your local GitPorch on ports 3690/9418.
- `public/` remains the actual localhost dashboard; `docs/` is the isolated marketing/showcase front end. The two are deliberately not wired together.
- Leave `data/` and all real bare Git repositories excluded from Git.
- `docs/.nojekyll` prevents Jekyll transformations and serves the page as plain static files.

## Verifying locally

Run `npm test` (includes checks for the public showcase contract), or open `docs/index.html` directly in a browser. No server is required for the demo.

For actual Git hosting, run `npm start` and use http://127.0.0.1:3690 on the same PC.

Publishing must remain an explicit repository-owner action. No visibility or deployment setting is automatically modified by this change.
