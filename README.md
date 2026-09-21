# n3xn Virtual FileSystem v2

**Encrypted, local-first virtual filesystem** with Monaco Editor, terminal, multi-account support, encrypted browser storage, GitHub integration, WebAssembly/Python tooling, `.n3-site` support, React/JSX execution, debugging tools, and optional end-to-end encrypted real-time collaboration over WSS.

n3xn VFS is designed around a browser-local filesystem. Network functionality is optional and is only used by features that require it.

## Features

### 🔐 Local encrypted filesystem

* AES-GCM authenticated encryption
* PBKDF2-SHA256 password-derived keys
* 310,000 PBKDF2 iterations
* 256-bit encryption keys
* Password-protected accounts
* Multiple accounts on the same device
* IndexedDB-backed filesystem
* Encrypted file contents at rest
* Recursive files and directories
* Virtual current working directory
* File undo/redo
* Persistent shell aliases
* Persistent custom terminal commands

### 📁 Import / Export

* Import individual files
* Import folders
* Import ZIP archives
* Export directories/files as ZIP
* Export the complete encrypted filesystem
* `.n3xn.json` encrypted backups
* Chromebook Downloads integration through the File System Access API
* Browser fallback file pickers where supported

### 📝 Monaco Editor

* Monaco Editor integration
* Multiple editor themes
* n3xn custom dark theme
* Syntax highlighting
* Active-file integration with the terminal
* Live editing support during collaboration sessions

### 💻 Terminal

n3xn includes a built-in bash-like terminal with filesystem commands, file editing tools, project inspection, debugging, networking, GitHub, collaboration, Python, React, storage, and package tooling.

Run:

```text
help
```

for the built-in command list.

#### Filesystem commands

```text
pwd
cd <path>
ls [-l]
dir
cat [-n] <file>
type <file>
mkdir [-p] <directory>
touch <file>
rm [-r] <path>
mv <src> <dest>
rename <src> <dest>
cp <src> <dest>
find <pattern>
tree [path]
stat <path>
```

#### File information and search

```text
grep [-ri] <pattern> [path]
head [-n N] <file>
tail [-n N] <file>
wc <file>
du
file <path>
basename <path>
dirname <path>
which <command>
sort
uniq
```

`grep` supports options including recursive search, case-insensitive search, inverted matches, filename-only output, line numbers, and context.

#### File editing

```text
append <file> <text>
prepend <file> <text>
replace <file> <search> <replacement>
insert <file> <line> <text>
delete <file> <line>
delline <file> <line>
undo [file]
redo [file]
diff <fileA> <fileB>
patch <pattern> <search> <replace> [--dry]
```

The terminal maintains per-file undo/redo history for supported terminal editing operations.

#### Shell utilities

```text
echo <text>
clear
cls
history
alias
unalias <name>
whoami
```

Command history is available with the terminal's arrow keys.

Additional keyboard shortcuts:

```text
Ctrl+R
```

Reverse-search command history.

```text
Ctrl+Shift+F
```

Toggle terminal fullscreen.

### 🧩 Custom commands

Create persistent JavaScript terminal commands:

```text
cmd list
cmd add <name> [description]
cmd rm <name>
```

Custom commands receive access to:

```text
fs
db
print
args
cwd
resolve
```

Example:

```text
cmd add hello
```

The command code is stored in the current n3xn account's metadata.

## ▶️ File execution and previews

The `run` command can execute or preview supported VFS files.

```text
run <file>
run <mode> <file>
open <file>
preview <file>
```

Supported modes include:

```text
auto
html
html-window
js
image
markdown
md
json
css
text
dataurl
blob-open
```

The active editor file can be used without specifying a path.

### Blob management

```text
blob list
blob make <file>
blob create <file>
blob gen <file>
blob open <index>
blob watch <file>
blob clear
```

`blob` and `blobs` are aliases.

Blob URLs are generated for previewing VFS content in the browser.

## 🌐 Web files

The `webfile` command provides browser-based URL fetching and upload functionality.

```text
webfile get <url> [vfs-path]
webfile sync <vfs-path> <url>
webfile headers <url>
webfile put <vfs-path> <url>
```

Aliases:

```text
wf
curl
fetch
```

Examples:

```text
webfile get https://example.com/file.txt
webfile sync /data/file.txt https://example.com/file.txt
webfile headers https://example.com
webfile put /data/file.txt https://example.com/upload
```

Network requests are subject to browser CORS and the permissions of the destination server.

## 🌍 Web preview

The `web` command provides a simple project/file preview workflow.

```text
web run [path]
web preview [path]
web open [path]
web stop
```

If no path is supplied, n3xn attempts to locate common entry files such as:

```text
index.html
index.n3-site
main.jsx
App.jsx
src/main.jsx
```

## 🐍 Python

n3xn includes a Python execution interface.

```text
python <file.py>
python -c <code>
python canvas
python hide
```

Alias:

```text
py
```

Python execution is provided through the browser's Python runtime integration rather than a server-side Python process.

## ⚛️ React / JSX

React/JSX files can be executed directly from the VFS.

```text
react run <entry.jsx>
```

Alias:

```text
jsx
```

The React runner supports:

* JSX/TSX transformation
* VFS-relative imports
* React 18
* VFS CSS imports
* Multi-file React projects
* React dependencies resolved through browser modules

This is **not a full Vite environment**. There is no Node-based Vite server or HMR system.

## 🔗 `.n3-site`

n3xn includes support for its `.n3-site` multi-file HTML format.

Commands:

```text
n3site help
n3site list [prefix]
n3site expand <file.n3-site>
n3site run <file.n3-site>
```

Aliases:

```text
n3-site
n3site
n3link
```

Create links to VFS files with:

```text
n3link <path> [blob|data] [mime]
```

`.n3-site` directives can reference VFS assets such as:

* Scripts
* Module scripts
* Stylesheets
* CSS
* Links

## 🐛 Debugging

### Static debugger

```text
debug <file>
```

The debugger performs lightweight checks for supported file types including:

* JSON parsing
* JavaScript/TypeScript brace mismatches
* JSX/TSX transformation
* Python indentation issues
* HTML closing-tag issues

### Advanced debugger

```text
xdebug <path>
xdebug <path> --live
xdebug live <file>
xdebug last
xdebug open
xdebug copy
xdebug fix
xdebug tryfix <file>
```

`xdebug` can perform static analysis and optional runtime iframe probing.

It includes checks such as:

* Equality issues
* Dangerous/eval-like patterns
* Empty catches
* Unused variables
* React key issues
* Floating promises
* Python bare exceptions
* Mutable defaults
* Image decoding issues
* `.n3-site` asset problems

`xdebug tryfix` can apply selected safe automatic fixes after confirmation.

## 📊 Project inspection

```text
project stats
project info
project files
project tree
```

A project report can show:

* File count
* Directory count
* Total size
* File extensions
* Project tree

## 💾 Storage backends

n3xn supports a storage abstraction with multiple backends.

```text
storage list
storage use <backend>
storage info
storage ls
storage meta
storage cat <path>
storage put <path> <text>
storage rm <path>
storage experimental-patch on
storage experimental-patch off
```

Aliases:

```text
idb
opfs
```

Available backends depend on browser support and the currently implemented storage modules.

System storage paths are identified and protected by confirmation prompts for destructive operations.

## 📈 Performance

```text
perf
performance
```

The performance report can inspect information such as:

* Memory
* Storage quota
* Device information
* Browser performance-related metrics

JSON output is also available through the performance module.

## 📦 NEXC packages

n3xn includes `.nexc` package/module support.

```text
nexc help
nexc list <file.nexc>
nexc modules <file.nexc>
nexc run <file.nexc> [module]
nexc remote <url> [module]
```

Shorthand:

```text
nexc --r <file.nexc> [module]
```

`.nexc` packages can declare permissions and modules. Permissions are presented for confirmation before execution.

Example structure:

```text
[nexc]
name = demo
default = build

[permissions]
terminal
vfs.write

[module build]
echo hello
parallel
  echo a
  echo b
wait 100ms
echo done
```

## 🤝 Real-time collaboration

n3xn supports optional collaboration through a WebSocket/WSS relay.

The collaboration layer supports:

* Shared rooms
* Room passwords
* End-to-end encrypted application messages
* Encrypted chat
* File sharing
* Chunked file transfers
* Live text collaboration
* Cursor/presence information
* Filesystem push/pull
* Peer presence
* Ping/pong handling

### WSS commands

```text
wss connect <wss-url> [roomPassword]
wss disconnect
wss status
wss chat <message>
wss share <vfs-path>
wss pull <vfs-path>
wss collab <text-file-path>
wss leave
wss ping
```

Aliases:

```text
collab
room
```

Shortcuts:

```text
share <path>
chat <message>
```

Example:

```text
wss connect wss://your-relay.example/room
```

The room password is used for application-level encryption. The relay is intended to operate as an opaque broadcaster rather than as the VFS itself.

Live text collaboration can be started with:

```text
wss collab /projects/index.html
```

## 🐙 GitHub integration

n3xn can optionally connect directly to GitHub using a personal access token.

GitHub functionality includes:

* Authentication
* Repository listing
* Repository creation
* Branch listing
* Branch creation
* Selecting a repository/branch
* Pulling files
* Pulling repository trees
* Local GitHub VFS caching
* Single-file commits
* Multi-file commits
* Pull requests
* Issues
* Gists
* Repository search
* Repository starring
* Remote file deletion
* API rate-limit information

### GitHub commands

```text
gh help
gh auth <token>
gh whoami
gh logout
gh rate
gh repos
gh create-repo <name> [--private]
gh use <owner/repo> [branch]
gh branches
gh pull [path]
gh pull-tree
gh clone
gh commit <path> [message]
gh push-paths <file1> <file2> -m <message>
gh branch <name>
gh prs
gh pr <title> <head-branch> [base]
gh issues
gh issue <title>
gh gist <local-path>
gh search <query>
gh star <owner/repo>
gh rm <path>
```

Alias:

```text
github
```

GitHub repository files cached inside the VFS use paths such as:

```text
gh:/owner/repo/path
```

### GitHub authentication

The GitHub integration uses a personal access token supplied by the user.

Tokens are treated as sensitive credentials and are stored using the n3xn account's encrypted storage mechanism when available.

Never share GitHub tokens through collaboration rooms, public logs, screenshots, or source files.

## 🖥️ Console logging

Browser console output can optionally be mirrored into the terminal.

```text
logs on
logs off
logs copy
logs clear
```

Alias:

```text
console
```

The terminal starts with console bridging enabled.

## 🔒 Privacy and network behavior

n3xn VFS is **local-first**, not strictly offline-only.

Normal VFS files are stored in the browser and encrypted at rest.

Optional network features may communicate externally:

### GitHub

When GitHub functionality is used, the application communicates with the GitHub API.

### WSS collaboration

When collaboration is enabled, the application communicates with the configured WebSocket/WSS relay.

Application messages are encrypted before being sent through the collaboration layer.

### Web files

Commands such as:

```text
webfile get
webfile sync
webfile headers
webfile put
```

make browser network requests to user-specified URLs.

These requests are subject to normal browser security policies such as CORS.

### Browser resources

The deployed application may also load external browser resources such as fonts, CDNs, or JavaScript modules depending on the selected feature.

## 🔐 Security notes

* AES-GCM provides authenticated encryption for stored VFS data.
* PBKDF2-SHA256 is used for password-derived keys.
* Passwords are not stored in plaintext.
* Encrypted filesystem exports require the appropriate password to decrypt.
* GitHub credentials are stored encrypted when supported by the current account/storage configuration.
* GitHub personal access tokens should be treated as sensitive credentials.
* Collaboration traffic is encrypted at the application layer using the room password.
* The WSS relay should not be treated as trusted storage.
* Do not place secrets into shared collaboration rooms.
* Do not expose GitHub tokens through terminal output or shared sessions.
* There is no password/account recovery mechanism for the local VFS.

Encryption protects stored data and collaboration traffic, but it does not make the browser, operating system, device, GitHub account, third-party relay, or remote websites inherently trusted.

## 🌐 Browser support

### Chrome / Edge / Chromium

Best overall support, particularly for:

* File System Access API
* Directory access
* Modern Web Crypto APIs
* Browser storage APIs
* WebAssembly-based features

### Firefox / Safari

Core VFS functionality is supported, but some browser-specific features such as directory picking may be more limited.

## 🚀 Deployment

n3xn VFS is a browser-based application and can be deployed as static files.

### Cloudflare Pages

1. Push the repository to GitHub.
2. Open Cloudflare Pages.
3. Create a project from the Git repository.
4. Use:

```text
Framework preset: None
Build command: leave empty
Build output directory: /
```

Or deploy with Wrangler:

```bash
npx wrangler pages deploy . --project-name n3xn-vfs
```

The application does not require a Node/Express server for its core local VFS functionality.

## 🗂️ Project structure

Important components include:

```text
index.html
sw.js

js/
├── app.js
├── db.js
├── crypto.js
├── fs.js
├── editor.js
├── terminal.js
├── runner.js
├── python.js
├── react-runner.js
├── github.js
├── collab.js
├── n3-site.js
├── nexc.js
├── xdebug.js
├── storage-backends.js
└── performance.js
```

### Core modules

| File                  | Purpose                                     |
| --------------------- | ------------------------------------------- |
| `app.js`              | Main application controller and UI          |
| `db.js`               | IndexedDB, accounts, encrypted file storage |
| `crypto.js`           | Encryption and password derivation          |
| `fs.js`               | Virtual filesystem                          |
| `editor.js`           | Monaco editor                               |
| `terminal.js`         | Terminal and command registry               |
| `runner.js`           | File execution and preview                  |
| `collab.js`           | WSS collaboration                           |
| `github.js`           | GitHub API integration                      |
| `n3-site.js`          | `.n3-site` processing                       |
| `python.js`           | Python runtime integration                  |
| `react-runner.js`     | React/JSX execution                         |
| `nexc.js`             | `.nexc` package execution                   |
| `xdebug.js`           | Advanced debugging                          |
| `storage-backends.js` | Storage backend abstraction                 |
| `performance.js`      | Performance reporting                       |

## ⚠️ Important

n3xn VFS executes code in the browser through several different mechanisms, including custom terminal commands, JavaScript execution, React/JSX execution, Python execution, and `.nexc` packages.

Only run code you understand and trust.

Features that access external URLs, GitHub, WebSockets, or remote packages can cause network requests outside the local VFS.

---

**n3xn VFS v2 — local-first, encrypted, extensible.**
