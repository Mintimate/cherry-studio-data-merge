const { spawnSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  const result = spawnSync('xattr', ['-cr', appPath], {
    encoding: 'utf8',
    stdio: 'pipe',
  })

  if (result.status !== 0) {
    throw new Error(`Failed to clear macOS extended attributes: ${result.stderr || result.stdout}`)
  }
}
