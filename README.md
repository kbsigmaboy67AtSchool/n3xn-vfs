# n3xn Virtual FileSystem v2

**Encrypted virtual filesystem** with Monaco editor, terminal, multi-account support, encrypted local storage, GitHub integration, and optional real-time collaboration over WSS.

n3xn VFS is designed to keep the core filesystem local to the browser while providing optional network features when you choose to use them.

## Features

### Local filesystem

* **Real AES-GCM encryption** using the Web Crypto API + PBKDF2 (310k iterations)
* **Password-protected accounts** with multiple users on the same device
* **IndexedDB** for encrypted file data
* **localStorage** for account metadata
* Full virtual filesystem with files, folders, and recursive operations
* Monaco Editor with custom n3xn theme + standard themes
* Terminal with bash-like commands and user-defined custom commands

### Import / Export

* Import files, folders, and ZIP archives
* Export the entire filesystem as an encrypted `.n3xn.json` backup
* Import encrypted filesystem backups
* Chromebook Downloads integration through the File System Access API, with a fallback picker

### GitHub integration

n3xn VFS can optionally connect directly to GitHub using a personal access token.

The GitHub integration supports:

* Sign in to GitHub
* List and select repositories and branches
* Read remote files
* Pull individual files or repository trees
* Cache repositories in the VFS under `gh:/owner/repo/path`
* Commit single files
* Create multi-file commits
* Create branches
* Create and list pull requests
* Create and list issues
* Create and list gists
* Search GitHub
* Check API rate limits

GitHub data is only accessed when you use the GitHub integration.

### Real-time collaboration

n3xn VFS also includes optional collaboration through a WebSocket/WSS relay.

Collaboration features include:

* Shared rooms
* Room passwords
* Encrypted collaboration messages
* Encrypted chat
* File sharing
* Chunked file transfers
* Live editor collaboration
* Cursor/presence updates
* Filesystem push/pull
* Peer presence
* Ping/pong connection handling

The collaboration client connects to a WSS endpoint and uses encrypted application messages. The relay is intended to broadcast opaque collaboration data rather than act as the filesystem itself.

## Privacy and network behavior

The **core VFS is local-first**. Your normal files and filesystem data are stored in the browser and encrypted at rest.

However, n3xn VFS is **not strictly offline-only**. Optional features communicate with external services:

* **GitHub integration** communicates with the GitHub API when enabled and used.
* **Collaboration** communicates with the configured WebSocket/WSS relay when you join or create a collaboration session.
* Browser APIs such as fonts, CDNs, or other externally hosted resources may also make network requests depending on the deployment/configuration.

Do not put secrets into collaboration rooms or other shared sessions unless you understand who can receive the data.

## Deploy to Cloudflare Pages

1. Push this folder to a GitHub repository.
2. In Cloudflare Dashboard → Pages → Create project → Connect to Git.
3. Build settings:

   * Framework preset: None
   * Build command: leave empty
   * Build output directory: `/` (or the folder containing `index.html`)
4. Deploy.

Or use Wrangler:

```bash
npx wrangler pages deploy . --project-name n3xn-vfs
```

## Usage

1. Open the site.
2. Create an account with a username and strong password.
3. Sign in.
4. Use the sidebar to create/import files and folders.
5. Click files to open them in Monaco.
6. Use the terminal (`help` for commands).
7. Export encrypted backups anytime.
8. Optionally configure GitHub or collaboration when you need network features.

### Terminal highlights

```text
ls -l
cat /path/to/file
mkdir /projects
find *.js
patch "*.js" "old" "new"
export fs
cmd add mycmd
```

Custom commands have access to `fs`, `db`, `print`, `args`, `cwd`, and `resolve`.

### GitHub VFS examples

```text
gh auth <token>
gh whoami
gh repos
gh use owner/repo [branch]
gh pull [path]
gh pull-tree
gh commit <path> [message]
gh push-paths a b c -m "message"
gh branch <name>
gh prs
gh pr <title> <head> <base>
gh issues
gh issue <title>
gh gist <file>
gh search <query>
gh rate
```

GitHub repository files cached by the integration use paths such as:

```text
gh:/owner/repo/path
```

## Security Notes

* AES-GCM provides authenticated encryption for stored file data.
* Password-derived keys are generated with PBKDF2-SHA256.
* Passwords are not stored in plaintext.
* Encrypted filesystem exports require the export password to decrypt.
* GitHub credentials are stored encrypted when a logged-in n3xn account password is available.
* Treat GitHub personal access tokens as sensitive credentials.
* Do not paste GitHub tokens into public collaboration rooms or shared screens.
* Revoke compromised GitHub tokens through GitHub.
* There is no account/password recovery mechanism in the local VFS.

Security features protect data at rest in the browser, but they do not make the browser, GitHub account, collaboration relay, or user's device inherently trusted.

## Browser Support

* Chrome / Edge / Chromium — best support, especially for the File System Access API
* Firefox / Safari — core features supported; directory picking may be more limited depending on browser support

---

**n3xn VFS v2 — local-first, encrypted, extensible.**
