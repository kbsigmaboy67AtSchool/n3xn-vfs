# n3xn Virtual FileSystem v2

**Encrypted, local-only virtual filesystem** with Monaco editor, terminal, multi-account support, ZIP/folder import-export, and Chromebook Downloads integration.

## Features

- **Real AES-GCM encryption** (Web Crypto API + PBKDF2 310k iterations)
- **Password-protected accounts** — multiple users on the same device
- **IndexedDB** for all file data (encrypted at rest)
- **localStorage** for account metadata only
- **Full virtual FS**: files, folders, recursive operations
- **Monaco Editor** with custom n3xn-dark theme + all standard themes
- **Terminal** with bash-like commands + user-defined custom commands
- **Import / Export**:
  - Files, folders, ZIPs
  - Entire encrypted filesystem as `.n3xn.json`
  - Chromebook Downloads folder (File System Access API + fallback)
- **Local only** — nothing is sent to any server
- **Seraph-inspired theme**: pure black + true white glows, Sixtyfour + JetBrains Mono fonts

## Deploy to Cloudflare Pages

1. Push this folder to a GitHub repository
2. In Cloudflare Dashboard → Pages → Create project → Connect to Git
3. Build settings:
   - Framework preset: None
   - Build command: (leave empty)
   - Build output directory: `/` (or the folder containing `index.html`)
4. Deploy

Or use Wrangler:

```bash
npx wrangler pages deploy . --project-name n3xn-vfs
```

## Usage

1. Open the site
2. Create an account (username + strong password)
3. Sign in
4. Use the sidebar to create/import files & folders
5. Click files to open in Monaco
6. Use the terminal (`help` for commands)
7. Export encrypted backups anytime

### Terminal highlights

```
ls -l
cat /path/to/file
mkdir /projects
find *.js
patch "*.js" "old" "new"
export fs          # full encrypted backup
cmd add mycmd      # create custom JS command
```

Custom commands have access to `fs`, `db`, `print`, `args`, `cwd`, `resolve`.

## Security Notes

- Encryption is real (AES-GCM). Without the password the data is unreadable.
- Accounts and all file contents never leave the browser.
- Exports are encrypted with the same password.
- Use a strong password. There is no recovery if you forget it.

## Browser Support

- Chrome / Edge / Chromium (best — File System Access API)
- Firefox / Safari (full core features, limited directory picker)

---

n3xn VFS v2 — local, encrypted, powerful.
