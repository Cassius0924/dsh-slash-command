import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  composeAlias, composePrompt, execArgs, expandNames, formatExecResult, redactSecrets, scrubEnv, secretValues, validateConfig, OUTPUT_LIMIT,
} from '../lib/core.js'

const prompt = { name: 'review', aliases: ['rv'], description: 'd', type: 'prompt', prompt: 'p $ARGUMENTS' }
const exec = { name: 'branch', description: 'd', type: 'exec', command: 'git rev-parse --abbrev-ref HEAD' }

test('valid config: defaults filled for exec, aliases default to []', () => {
  const { commands, errors } = validateConfig({ commands: [prompt, exec] })
  assert.deepEqual(errors, [])
  assert.deepEqual(commands[1].aliases, [])
  assert.equal(commands[1].cwd, 'workspace')
  assert.equal(commands[1].timeoutMs, 30000)
})

test('invalid name is rejected with a field error and dropped', () => {
  const { commands, errors } = validateConfig({ commands: [{ ...prompt, name: 'Bad Name' }, exec] })
  assert.equal(commands.length, 1)
  assert.equal(errors[0].index, 0)
  assert.equal(errors[0].field, 'name')
  assert.equal(errors[0].code, 'pattern')
})

test('missing required fields per type', () => {
  const { errors } = validateConfig({ commands: [
    { name: 'a', description: 'd', type: 'prompt' },
    { name: 'b', description: 'd', type: 'exec' },
    { name: 'c', type: 'prompt', prompt: 'x' },
    { name: 'd', description: 'd', type: 'nope' },
  ] })
  assert.deepEqual(errors.map(e => [e.index, e.field, e.code]), [
    [0, 'prompt', 'required'], [1, 'command', 'required'], [2, 'description', 'required'], [3, 'type', 'enum'],
  ])
})

test('alias collisions: with another command, with a name, and within one command', () => {
  const { commands, errors } = validateConfig({ commands: [
    prompt,
    { ...exec, name: 'other', aliases: ['rv'] },
    { ...exec, name: 'review' },
    { ...exec, name: 'x', aliases: ['x'] },
    { ...exec, name: 'y', aliases: ['z', 'z'] },
  ] })
  assert.deepEqual(commands.map(c => c.name), ['review'])
  assert.deepEqual(errors.map(e => [e.index, e.code]), [[1, 'duplicate'], [2, 'duplicate'], [3, 'duplicate'], [4, 'duplicate']])
})

test('cwd and timeoutMs bounds', () => {
  const { errors } = validateConfig({ commands: [
    { ...exec, name: 'a', cwd: 'relative/dir' },
    { ...exec, name: 'b', timeoutMs: 600001 },
    { ...exec, name: 'c', timeoutMs: 600000, cwd: '/tmp' },
  ] })
  assert.deepEqual(errors.map(e => [e.index, e.field]), [[0, 'cwd'], [1, 'timeoutMs']])
})

test('top-level shape errors', () => {
  assert.equal(validateConfig(null).errors[0].code, 'type')
  assert.equal(validateConfig({ commands: 1 }).errors[0].code, 'type')
  assert.equal(validateConfig({ commands: [3] }).errors[0].index, 0)
})

test('$ARGUMENTS replaces in place (all occurrences, no $-pattern surprises)', () => {
  assert.equal(composePrompt('a $ARGUMENTS b $ARGUMENTS', ' x '), 'a x b x')
  assert.equal(composePrompt('a $ARGUMENTS', "$& $1"), 'a $& $1')
  assert.equal(composePrompt('a $ARGUMENTS', ''), 'a ')
})

test('without placeholder: args appended after a blank line, empty args leave prompt untouched', () => {
  assert.equal(composePrompt('do it', '  foo bar'), 'do it\n\nfoo bar')
  assert.equal(composePrompt('do it', '   '), 'do it')
})

test('alias expansion: name first, then aliases', () => {
  assert.deepEqual(expandNames({ ...prompt, aliases: ['rv', 'r'] }), ['review', 'rv', 'r'])
  assert.deepEqual(expandNames({ ...exec, aliases: [] }), ['branch'])
})

test('exec result: output echoed as-is, exit appended only on failure, capped at 16KB', () => {
  assert.equal(formatExecResult({ exit: '0', stdout: 'main\n', stderr: '' }), 'main')
  assert.equal(formatExecResult({ exit: '0', stdout: '', stderr: '' }), 'exit=0')
  assert.equal(formatExecResult({ exit: '2', stdout: '1\n2\n', stderr: 'boom\n' }), '1\n2\nboom\nexit=2')
  assert.equal(formatExecResult({ exit: 'timeout(SIGTERM)', stdout: '', stderr: '' }), 'exit=timeout(SIGTERM)')
  const big = formatExecResult({ exit: '1', stdout: '好'.repeat(20000), stderr: 'E' })
  assert.ok(Buffer.byteLength(big) <= OUTPUT_LIMIT + 32)
  assert.match(big, /\[truncated\]\nexit=1$/)
})

test('alias: validation normalizes target and rejects bad/self targets', () => {
  const ok = validateConfig({ commands: [{ name: 'c', description: 'd', type: 'alias', target: 'compact' }] })
  assert.deepEqual(ok.errors, [])
  assert.equal(ok.commands[0].target, '/compact')
  const bad = validateConfig({ commands: [
    { name: 'a', description: 'd', type: 'alias' },
    { name: 'b', description: 'd', type: 'alias', target: '/Bad' },
    { name: 'c', aliases: ['cc'], description: 'd', type: 'alias', target: '/cc x' },
  ] })
  assert.deepEqual(bad.errors.map(e => [e.index, e.field, e.code]), [[0, 'target', 'required'], [1, 'target', 'pattern'], [2, 'target', 'duplicate']])
})

test('alias: $ARGUMENTS in place, otherwise appended with a space', () => {
  assert.equal(composeAlias('/compact', ''), '/compact')
  assert.equal(composeAlias('/review 只看', ' src '), '/review 只看 src')
  assert.equal(composeAlias('/review $ARGUMENTS 严格', 'src'), '/review src 严格')
})

test('exec args: passed as variables, never spliced into the script', () => {
  assert.deepEqual(execArgs(''), { env: { ARGUMENTS: '' }, argv: [] })
  assert.deepEqual(execArgs('  -n  5 ; rm x '), { env: { ARGUMENTS: '-n  5 ; rm x' }, argv: ['-n', '5', ';', 'rm', 'x'] })
})

test('env scrub: secret-looking names dropped unless passEnv, benign look-alikes kept', () => {
  const env = {
    PATH: '/bin', HOME: '/root', SSH_AUTH_SOCK: '/tmp/s', KEYBOARD: 'us', XDG_SESSION_ID: '3',
    DEEPSEEK_API_KEY: 'sk-aaaaaaaaaaaaaaaaaaaa', LANGFUSE_SECRET_KEY: 'x', GH_TOKEN: 'ghp_x', DB_PASSWORD: 'p', AWS_ACCESS_KEY_ID: 'AKIA',
  }
  assert.deepEqual(Object.keys(scrubEnv(env)).sort(), ['HOME', 'KEYBOARD', 'PATH', 'SSH_AUTH_SOCK', 'XDG_SESSION_ID'])
  assert.ok('GH_TOKEN' in scrubEnv(env, ['GH_TOKEN']))
  assert.deepEqual(secretValues(env), ['sk-aaaaaaaaaaaaaaaaaaaa'])
})

test('redaction: known values and common secret formats are masked, ordinary text is not', () => {
  const known = ['s3cr3t-value-123']
  const out = redactSecrets([
    'v=s3cr3t-value-123',
    'DEEPSEEK_API_KEY=sk-abcdefghijklmnop1234',
    'token: ghp_abcdefghijklmnopqrstuvwxyz0123',
    'Authorization: Bearer abc.def.ghi',
    '"apiKey": "live_123456"',
    'postgres://admin:hunter22@db:5432/x',
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----',
    'main 3f2a1b9 fix: keyboard layout; token count 42',
  ].join('\n'), known)
  for (const leak of ['s3cr3t-value-123', 'abcdefghijklmnop1234', 'abcdefghijklmnopqrstuvwxyz0123', 'abc.def.ghi', 'live_123456', 'hunter22', 'eyJzdWIiOiIxIn0', 'MIIE']) {
    assert.ok(!out.includes(leak), `leaked ${leak}\n${out}`)
  }
  assert.equal(redactSecrets('using sk-abcdefghijklmnop1234 now'), 'using sk-*** now')
  assert.match(out, /main 3f2a1b9 fix: keyboard layout; token count 42/)
})

test('passEnv: validated as env var names', () => {
  const base = { name: 'x', description: 'd', type: 'exec', command: 'gh pr list' }
  assert.deepEqual(validateConfig({ commands: [{ ...base, passEnv: ['GH_TOKEN'] }] }).commands[0].passEnv, ['GH_TOKEN'])
  assert.equal(validateConfig({ commands: [{ ...base, passEnv: ['bad-name'] }] }).errors[0].field, 'passEnv')
})
