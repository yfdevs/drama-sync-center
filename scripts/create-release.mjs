import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const tag = `v${packageJson.version}`

const worktreeStatus = execFileSync('git', ['status', '--porcelain'], {
  encoding: 'utf8',
}).trim()

if (worktreeStatus) {
  throw new Error('工作区还有未提交改动，请提交后再发版。')
}

const currentBranch = execFileSync('git', ['branch', '--show-current'], {
  encoding: 'utf8',
}).trim()

if (!currentBranch) {
  throw new Error('当前不在 Git 分支上，无法创建发版标签。')
}

execFileSync('git', ['tag', '-a', tag, '-m', `Release ${tag}`], { stdio: 'inherit' })
execFileSync('git', ['push', 'origin', currentBranch], { stdio: 'inherit' })
execFileSync('git', ['push', 'origin', tag], { stdio: 'inherit' })

console.log(`已推送 ${tag}，GitHub Actions 将自动构建并发布安装包。`)
