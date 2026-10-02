# Profile maintenance

The profile retains the existing English description, projects, technologies and engineering principles. Original SVGs add a cyberpunk contribution skyline and a restrained name banner. The exact primary blue is `#3858E9` in both themes. Tall towers, illuminated facade windows, roof details and a deeper isometric projection bring the city closer to the original concept. Each active day remains one building; zero-activity days are empty plots. Contribution totals and dates appear once as readable text below the city rather than being duplicated inside the scaled image. Both images use GitHub's documented `<picture>` theme switching. The existing technology icons now select their light or dark variant, too.

The city represents only the publicly visible contribution calendar at `https://github.com/users/brianvarskonst/contributions`. Dates and counts may include private contributions that the account owner has chosen to show anonymously on their public profile. No repository names, code, credentials or private API data are requested. Activity is an illustration, not a measure of engineering quality.

## Generate and check

Node.js 22 or newer is sufficient; production generation has no package dependencies and requires no additional token or secret.

```sh
node --test tests/*.test.mjs scripts/*.test.mjs
node tools/profile/generate.mjs
node scripts/update-caption.mjs
node tools/profile/generate.mjs --check
node scripts/update-caption.mjs --check
```

For an offline render from the saved dataset:

```sh
node tools/profile/generate.mjs --from-file data/contributions.json
```

The workflow refreshes the assets daily at 04:17 UTC and supports manual dispatch. GitHub schedules can be delayed. A failed fetch or invalid calendar fails the job and leaves the previous committed images intact. The assets display the actual calendar date range, including boundary weeks, rather than promising exactly 365 days. The workflow commits generated assets, public aggregate data and the marked contribution summary below the city; it never edits the existing description. That summary keeps the date range and counts readable on small screens.

## Local preview

For the preview only, install the pinned official Primer stylesheet. GitHub CLI must be authenticated to use GitHub's Markdown rendering endpoint. Rendering does not modify the GitHub account.

```sh
npm ci
npm run preview
```

Open `http://127.0.0.1:4173`. Change your browser's preferred color scheme to inspect both palettes. This preview uses GitHub's real Markdown renderer and sanitizer plus official Primer CSS. GitHub's surrounding profile navigation is outside the preview. Files, rendered HTML and screenshots under `.local/` are ignored by Git.

With the preview server running, `npm run test:browser` checks both themes at desktop, mobile and 320px widths, image loading, overflow, original description preservation and SVG bounds. It writes screenshots and a JSON report under `.local/`. Playwright needs Chromium; if it is not already installed, use `npx playwright install chromium` once. These development packages are not needed by the scheduled generator.

## Sources

- Concept inspiration: [George Kobaidze's contribution console](https://dev.to/georgekobaidze/i-turned-my-github-profile-into-a-cyberpunk-console-with-a-city-built-from-my-contributions-h4c). This implementation was written independently; no reference code, illustrations or fonts were copied.
- Theme-aware images: [GitHub's README formatting guide](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/quickstart-for-writing-on-github).
- Preview styling: [GitHub Primer CSS](https://github.com/primer/css).
- Existing technology icons: [Skill Icons](https://github.com/tandpfun/skill-icons).
