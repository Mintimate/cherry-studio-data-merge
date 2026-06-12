import path from 'node:path'

import { formatMergeSummary, mergeDirectBackups } from './directMerge'

interface CliArgs {
  inputs: string[]
  output: string
  conflict: 'newer' | 'primary'
  primaryIndex: number
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const normalizedInputs = args.inputs.map((input) => path.resolve(input))
  const outputPath = path.resolve(args.output)

  const result = await mergeDirectBackups({
    inputPaths: normalizedInputs,
    outputPath,
    mergeOptions: {
      conflictResolution: args.conflict,
      primaryBackupIndex: args.primaryIndex,
      settingsSource: args.primaryIndex,
    },
  })

  console.log(`已写入: ${result.writtenTo}`)
  console.log(formatMergeSummary(result.result))
  if (result.result.warnings.length > 0) {
    console.log('警告:')
    for (const warning of result.result.warnings) {
      console.log(`- ${warning}`)
    }
  }
}

function parseArgs(argv: string[]): CliArgs {
  const inputs: string[] = []
  let output = `cherry-studio-merged-${new Date().toISOString().slice(0, 10)}.zip`
  let conflict: 'newer' | 'primary' = 'newer'
  let primaryIndex = 0

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '-o' || arg === '--output') {
      output = argv[i + 1] ?? output
      i += 1
      continue
    }
    if (arg === '--conflict') {
      const value = argv[i + 1]
      if (value === 'newer' || value === 'primary') {
        conflict = value
      }
      i += 1
      continue
    }
    if (arg === '--primary') {
      primaryIndex = Number(argv[i + 1] ?? '0') || 0
      i += 1
      continue
    }
    if (arg === '-h' || arg === '--help') {
      printHelpAndExit(0)
    }
    inputs.push(arg)
  }

  if (inputs.length < 2) {
    printHelpAndExit(1)
  }

  return { inputs, output, conflict, primaryIndex }
}

function printHelpAndExit(code: number): never {
  const usage = [
    '用法:',
    '  yarn merge:direct <backup1.zip> <backup2.zip> [...more.zip] -o merged.zip',
    '',
    '可选参数:',
    '  -o, --output <path>       输出文件路径',
    '  --conflict <newer|primary> 冲突处理策略，默认 newer',
    '  --primary <index>        主备份索引，默认 0',
  ].join('\n')
  console.log(usage)
  process.exit(code)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})