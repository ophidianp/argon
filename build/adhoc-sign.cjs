// Apple Silicon refuses to run code with no valid signature, and packaging invalidates Electron's own.
// Without an Apple Developer ID the app is signed ad hoc: it runs, and macOS asks the person to allow it.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async ({ appOutDir, packager }) => {
  const app = path.join(appOutDir, `${packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
