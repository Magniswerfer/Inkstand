// Packaging for macOS, Windows and Linux.
//
// macOS signing is decided by the environment:
//   - With CSC_LINK (+ CSC_KEY_PASSWORD) the app is signed with that Developer ID certificate, and
//     with APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID it is also notarized, so it opens
//     without warnings.
//   - Without them it is ad-hoc signed, which Apple Silicon requires to run at all; people then open
//     it the first time with right-click → Open.
const signed = Boolean(process.env.CSC_LINK)
const notarize = signed && Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID)

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'io.github.magniswerfer.inkstand',
  productName: 'Inkstand',
  copyright: 'Inkstand contributors · GNU AGPL v3',
  directories: { buildResources: 'build', output: 'dist' },
  files: ['out/**/*', 'package.json'],
  extraResources: [
    { from: 'resources/templates', to: 'templates' },
    { from: 'resources/app', to: 'app' },
    { from: 'node_modules/katex/dist', to: 'vendor/katex', filter: ['katex.min.css', 'fonts/**'] },
    { from: 'build/icon.png', to: 'icon.png' }
  ],
  fileAssociations: [{ ext: ['md', 'markdown', 'mdown', 'mkd', 'txt', 'text'], name: 'Markdown Document', role: 'Editor' }],
  protocols: [{ name: 'Inkstand URL', schemes: ['inkstand'] }],
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  mac: {
    category: 'public.app-category.productivity',
    icon: 'build/icon.icns',
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] }
    ],
    identity: signed ? undefined : '-',
    hardenedRuntime: signed,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize
  },
  dmg: {
    title: '${productName} ${version}',
    contents: [
      { x: 140, y: 190 },
      { x: 400, y: 190, type: 'link', path: '/Applications' }
    ]
  },
  win: {
    icon: 'build/icon.png',
    target: [{ target: 'nsis', arch: ['x64', 'arm64'] }]
  },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, perMachine: false },
  linux: {
    icon: 'build/icon.png',
    category: 'Office',
    synopsis: 'A focused writing app for Markdown',
    maintainer: 'Inkstand contributors <inkstand@users.noreply.github.com>',
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] }
    ]
  },
  publish: { provider: 'github', owner: 'Magniswerfer', repo: 'foss-write', releaseType: 'draft' }
}
