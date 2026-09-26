# Releases

The extension version is `major.minor.patch`, shared by `package.json` and `src/manifest.json`. While below 1.0, use a minor increment for substantial features and a patch increment for fixes and maintenance. Keep the Firefox add-on ID unchanged so signed releases update the existing installation.

## Prepare a version

1. Write the changes under **Unreleased** in [CHANGELOG.md](../CHANGELOG.md).
2. Run `pnpm release:version 0.5.7`, substituting the next version. This checks that the version increases, updates both version files, and moves the pending notes into a dated changelog section. It does not commit or publish.
3. Run `pnpm check` and complete any live acceptance checks relevant to the changes. Automated tests and the browser fixture do not establish installed Firefox/BookWalker compatibility.
4. Run `pnpm package`. The output is `dist/manga-reading-assistant-<version>.zip` and a `.zip.sha256` checksum. Only `src/` is packaged. The ZIP is unsigned.

`pnpm check` runs tests, formatting, version/changelog consistency and Mozilla's official linter. A packaged-file reachability test catches unused assets and modules. The current linter reports one Android compatibility warning: the data-collection declaration needs Android Firefox 142 while the desktop minimum is 140. This extension targets desktop Firefox; select desktop compatibility in the Mozilla submission. Android has not been validated.

GitHub Actions runs the same checks and packaging on pushes to main and pull requests, and retains the unsigned ZIP and checksum as build artifacts. It does not sign or submit to Mozilla.

## Update GitHub

Commit the reviewed source, tests, lockfile, documentation and changelog. Tag that commit `v<version>`, then push the commit and tag. Attach the versioned ZIP and checksum to its GitHub release, clearly identifying the ZIP as an unsigned Mozilla upload package. Never commit `.env`, local caches, benchmark request logs, credentials or generated test output.

## Update the existing Mozilla add-on

1. Open [My Add-ons](https://addons.mozilla.org/developers/addons/) and choose Manga Reading Assistant.
2. Use its **Upload New Version** action and upload the versioned ZIP. Update the existing add-on, rather than creating a new listing.
3. Keep the existing self-distributed/unlisted channel unless deliberately changing distribution. The extension source is already readable JavaScript, HTML and CSS; it is not bundled or minified and needs no runtime build step.
4. Complete Mozilla's validation/signing process and download the signed `.xpi` from the version page. A GitHub tag or local ZIP does not mean Mozilla has signed or approved it.
5. Install the signed update through Firefox's **Add-ons → gear → Install Add-on From File**. Refresh existing reader tabs so they use the new content scripts. Editing this checkout does not update a signed installation.

Record actual validation and any limitations in [validation.md](validation.md). Only mark a release signed or published once Mozilla confirms it.

References: [Mozilla packaging](https://extensionworkshop.com/documentation/publish/package-your-extension/), [submission and self-distribution](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/#self-distribution), [web-ext commands](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/).
