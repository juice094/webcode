// S3 配对审批桥·mock 集成验证（不碰在役进程，全部用独立端口与临时目录）。
//
// 三路径：
//   A. mock dsh 端点批准 → /v1/session/request 得 bridgeCode → redeem 全流程通
//   B. mock dsh 端点拒绝 → /v1/session/request 403 declined
//   C. 桥不可达（mock 已关）→ 超时后 403 declined，不挂起
//
// 运行：node scripts/s3-pairing-bridge-mock.mjs   （需先 pnpm run compile 出 out/headless.js）
// 退出码：0 = 三路径全过；1 = 任一路径失败。

import { spawn } from 'node:child_process'
import http from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const HEADLESS = join(HERE, '..', 'out', 'headless.js')
/** 在役网关占 34567；集成用 34575（仍在扩展扫描段 34567–34576 内，但本机无常驻占用）。 */
const GATEWAY_PORT = 34575
const SITE_ORIGIN = 'https://chatgpt.com'
const SITE_ID = 'chatgpt'
const EXTENSION_ORIGIN = 'chrome-extension://kghhldphcmpiimophipabdhldfipgiio'
const BRIDGE_TIMEOUT_MS = 3000

const results = []
function record(name, pass, evidence) {
  results.push({ name, pass })
  console.log(`${pass ? '✅' : '❌'} ${name}\n   ${evidence}`)
}

/** mock dsh 审批端点：mode = approve | reject；记录每次询问体。 */
function startMockDsh(mode) {
  const seen = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      seen.push(JSON.parse(body))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ approved: mode === 'approve' }))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      seen,
      port: server.address().port,
      close: () => new Promise((done) => server.close(done)),
    }))
  })
}

function startGateway(bridgeUrl, workDir) {
  const env = { ...process.env }
  // env 卫生：Claude Code 工具链变量不进子进程。
  delete env.DEEPSEEK_BASE_URL
  delete env.DEEPSEEK_API_KEY
  Object.assign(env, {
    WEBCODE_PORT: String(GATEWAY_PORT),
    WEBCODE_WORKSPACE_ROOTS: workDir,
    WEBCODE_SESSION_STORE: join(workDir, 'bridge-sessions.json'),
    WEBCODE_IDLE_TIMEOUT_MINUTES: '10',
    WEBCODE_PAIRING_BRIDGE: bridgeUrl,
    WEBCODE_PAIRING_BRIDGE_TIMEOUT_MS: String(BRIDGE_TIMEOUT_MS),
  })
  const child = spawn(process.execPath, [HEADLESS], { env, stdio: ['ignore', 'ignore', 'pipe'] })
  child.stderr.setEncoding('utf8')
  let stderrTail = ''
  child.stderr.on('data', (chunk) => { stderrTail = (stderrTail + chunk).slice(-4000) })
  return { child, stderrTail: () => stderrTail }
}

async function waitReady(timeoutMs = 15000) {
  const started = Date.now()
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/ping`)
      if (res.ok) {return await res.json()}
    } catch { /* 未就绪 */ }
    if (Date.now() - started > timeoutMs) {throw new Error('网关就绪超时')}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

async function requestPairing() {
  const started = Date.now()
  const res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/session/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE_ORIGIN },
    body: JSON.stringify({ siteId: SITE_ID, requestOrigin: SITE_ORIGIN }),
  })
  return { status: res.status, body: await res.json(), elapsedMs: Date.now() - started }
}

/** 拒绝 mock：桥 URL 是网关启动时注入的，换 mock 必须在同一端口重启。 */
function startRejectMock(port) {
  const seen = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      seen.push(JSON.parse(body))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ approved: false, reason: '用户在 dsh UI 拒绝' }))
    })
  })
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({
      seen,
      close: () => new Promise((done) => server.close(done)),
    }))
  })
}

function recordApprovalPath(approved, seen) {
  const nonceA = seen[0]?.nonce
  record(
    'A1 批准路径：/v1/session/request 200 + bridgeCode',
    approved.status === 200 && typeof approved.body.bridgeCode === 'string',
    `status=${approved.status} bridgeCode=${String(approved.body.bridgeCode).slice(0, 8)}… nonce=${nonceA}`,
  )
  record(
    'A2 询问体四字段齐全（siteName/requestOrigin/workspaceName/nonce）',
    seen.length === 1
      && seen[0].siteName === 'ChatGPT'
      && seen[0].requestOrigin === SITE_ORIGIN
      && typeof seen[0].workspaceName === 'string'
      && typeof nonceA === 'string',
    JSON.stringify(seen[0]),
  )
}

async function recordRedeemPath(approved) {
  const redeem = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/bridge/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: EXTENSION_ORIGIN },
    body: JSON.stringify({
      bridgeCode: approved.body.bridgeCode,
      browserExtensionVersion: '1.9.1',
      bridgeProtocolVersion: 2,
    }),
  })
  const redeemBody = await redeem.json()
  record(
    'A3 redeem 全流程通：200 + token + idleTimeoutMs>0',
    redeem.status === 200 && redeemBody.success === true
      && typeof redeemBody.token === 'string' && redeemBody.idleTimeoutMs > 0,
    `status=${redeem.status} success=${redeemBody.success} token=${String(redeemBody.token).slice(0, 8)}… idleTimeoutMs=${redeemBody.idleTimeoutMs}`,
  )
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), 'webcode-s3-it-'))
  console.log(`工作目录（临时）：${workDir}`)

  // ── 路径 A：批准 → 配对全流程（request → bridgeCode → redeem）
  const mockApprove = await startMockDsh('approve')
  const gateway = startGateway(`http://127.0.0.1:${mockApprove.port}/v1/pairing/confirm`, workDir)
  try {
    const ping = await waitReady()
    console.log(`网关就绪：port=${ping.port} workspaceId=${ping.workspaceId}`)

    const approved = await requestPairing()
    recordApprovalPath(approved, mockApprove.seen)
    await recordRedeemPath(approved)

    // ── 路径 B：拒绝 → 403 declined
    await mockApprove.close()
    const mockRejectSamePort = await startRejectMock(mockApprove.port)

    const declined = await requestPairing()
    record(
      'B 拒绝路径：/v1/session/request 403 {error:declined}',
      declined.status === 403 && declined.body.error === 'declined',
      `status=${declined.status} body=${JSON.stringify(declined.body)}`,
    )

    // ── 路径 C：桥不可达 → 超时拒绝，不挂起
    await mockRejectSamePort.close()
    const unreachable = await requestPairing()
    record(
      'C 桥不可达：超时后 403 declined，耗时有界不挂起',
      unreachable.status === 403
        && unreachable.body.error === 'declined'
        && unreachable.elapsedMs < BRIDGE_TIMEOUT_MS + 5000,
      `status=${unreachable.status} body=${JSON.stringify(unreachable.body)} elapsed=${unreachable.elapsedMs}ms（桥超时=${BRIDGE_TIMEOUT_MS}ms）`,
    )
  } finally {
    gateway.child.kill('SIGTERM')
    await new Promise((resolve) => gateway.child.once('exit', resolve))
    const tail = gateway.stderrTail()
    console.log('—— 网关 stderr 尾部（配对决策日志）——')
    console.log(tail.split('\n').filter((line) => line.includes('🤝') || line.includes('⛔') || line.includes('🔐')).join('\n'))
  }

  const failed = results.filter((r) => !r.pass)
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
  // Windows 上 child.kill + 管道关闭与 process.exit 存在 teardown 竞态（libuv
  // UV_HANDLE_CLOSING 断言，实测 exit=-1073740791）：设 exitCode 让事件循环自然
  // 排空，1s unref 兜底定时器防 stray handle 挂起。
  process.exitCode = failed.length === 0 ? 0 : 1
  setTimeout(() => process.exit(process.exitCode), 1000).unref()
}

main().catch((error) => {
  console.error(`❌ 集成验证异常：${error instanceof Error ? error.stack : String(error)}`)
  process.exitCode = 1
  setTimeout(() => process.exit(1), 1000).unref()
})
