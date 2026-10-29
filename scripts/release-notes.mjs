// Prints release notes for a version: a "which file do I need?" table with direct download links,
// then that version's section of CHANGELOG.md.
// Usage: node scripts/release-notes.mjs [version]   (defaults to package.json's version)
import { readFileSync } from 'node:fs'

const version = (process.argv[2] ?? JSON.parse(readFileSync('package.json', 'utf8')).version).replace(/^v/, '')
const base = `https://github.com/Magniswerfer/Inkstand/releases/download/v${version}`
const files = [
  ['Mac with Apple silicon (M1 or later)', `Inkstand-${version}-mac-arm64.dmg`],
  ['Mac with an Intel processor', `Inkstand-${version}-mac-x64.dmg`],
  ['Windows', `Inkstand-${version}-win-x64.exe`],
  ['Linux (any distribution)', `Inkstand-${version}-linux-x86_64.AppImage`],
  ['Debian or Ubuntu', `Inkstand-${version}-linux-amd64.deb`]
]

const changelog = readFileSync('CHANGELOG.md', 'utf8')
const section = new RegExp(`^## ${version.replace(/\./g, '\\.')}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(changelog)?.[1].trim()

console.log(`## Download

| Your computer | File |
| --- | --- |
${files.map(([who, file]) => `| ${who} | [${file}](${base}/${file}) |`).join('\n')}

Not sure which Mac you have? **Apple menu → About This Mac** shows "Chip: Apple M…" or "Processor: Intel". On Windows, SmartScreen may ask you to choose **More info → Run anyway**. The \`.zip\`, \`.blockmap\` and \`latest*.yml\` files are for updates; you don't need them.

## What's new

${section ?? '_See CHANGELOG.md._'}
`)
