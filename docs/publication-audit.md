# Pre-publication audit

Completed September 26, 2026. This is an audit for accidental disclosure, not a penetration test or a guarantee that every possible secret pattern can be detected.

## Scope and result

No credentials or private user data were found in the reviewed Git history, release attachments, or CI output. No history rewrite or key rotation was indicated by these checks.

The audit covered the repository through `5d8c357185cf58dc0fd09d8e5ff049809b112a00`:

| Material | Coverage | Result |
| --- | --- | --- |
| Git history | All fetched branches and tags: three commits, 183 unique historical file blobs | No secret-scanner findings; no personal filesystem paths or private email addresses found |
| Commit metadata | All three commits' author and committer identities | Public GitHub noreply address and a local placeholder address |
| Local credential check | Exact comparison of the configured local secret against every historical file blob, without printing the value | No matches |
| GitHub release `v0.5.6` | Both downloadable attachments, extracted ZIP contents, and release description | No secret-scanner findings; 32 packaged files match `src/` |
| GitHub Actions | The sole run, `36224157577`, including its logs and `unsigned-firefox-package` artifact | No secret-scanner findings; 32 packaged files match `src/` |
| Images and other assets | Original icon sources and synthetic Japanese benchmark fixtures; metadata chunks in 22 historical PNG blobs | No PNG text or EXIF chunks; no private reading screenshots identified |
| Ignore rules | Credential files and local outputs | `.env` is ignored and has never been tracked; `.env.example` contains an empty placeholder |

The release ZIP's SHA-256 is `e5806508efd73758e6d3e8add625a7b074fe657b4d4350393c002e3ffc68963f`. The CI ZIP has a different archive hash, but every extracted source file matches. Both checksums were checked against their respective sidecar files.

## Method

- Fetched remote branches and tags and inventoried GitHub releases, Actions runs, and artifacts.
- Used [Gitleaks 8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1), with its downloaded archive verified against the official release checksum. Scanned all reachable Git history with the default rules and full output redaction, plus extracted release/CI files and CI logs.
- Inspected historical filenames, commit identities, filesystem-path/email patterns, current network/storage boundaries, and asset provenance. Compared the local credential in memory; no credential value was written to the report or terminal.
- Compared every extracted package file against source, checked archive checksums, and inspected PNG chunk types for embedded metadata.

Raw downloads and redacted scan results are in ignored `work/publication-audit/`; they are not committed. The audit does not cover unreachable/deleted remote objects, private browser profiles, or external services' retained data. Future commits and attachments need their own check before publication.
