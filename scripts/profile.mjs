import { randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { isMap, isSeq, parseDocument } from 'yaml'

export const PLUGIN_ID = 'dsh-usage-panel'
export const LEGACY_PLUGIN_ID = '@dsh-usage-panel'
export const PATCH_FILE = 'cordis.patch.yml'

const KNOWN_PLUGIN_NAMES = new Set([PLUGIN_ID, LEGACY_PLUGIN_ID])

/** Resolve the target web profile without embedding a platform-specific home path. */
export function resolveProfileDir(explicitPath) {
  return resolve(explicitPath ?? process.env.DSH_USAGE_PANEL_PROFILE ?? join(homedir(), '.dsh', 'profiles', 'web'))
}

/** Require a composed DSH web profile before any file is changed. */
export async function assertWebProfile(profileDir) {
  const dir = resolveProfileDir(profileDir)
  try {
    if (!(await stat(dir)).isDirectory()) throw new Error('not a directory')
    if (!(await stat(join(dir, 'cordis.yml'))).isFile()) throw new Error('cordis.yml is not a file')
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    const bundles = manifest?.dsh?.profile?.bundles
    if (!Array.isArray(bundles) || !bundles.includes('@deepseek-ai/dsh-web-app')) {
      throw new Error('missing dsh web profile marker')
    }
  } catch (cause) {
    throw new Error(`未找到可用的 DeepSeek Harness web profile：${dir}`, { cause })
  }
  return dir
}

/** Read the package installed in this profile, not a development junction in an ancestor. */
export async function readInstalledPackage(profileDir) {
  const packagePath = join(profileDir, 'node_modules', PLUGIN_ID, 'package.json')
  let manifest
  try {
    manifest = JSON.parse(await readFile(packagePath, 'utf8'))
  } catch (cause) {
    throw new Error(
      `当前 profile 尚未安装 ${PLUGIN_ID}。请先在 ${profileDir} 执行 pnpm add <package-spec>。`,
      { cause },
    )
  }
  if (manifest?.name !== PLUGIN_ID) {
    throw new Error(`已安装包的 name 必须是 ${PLUGIN_ID}，实际为 ${JSON.stringify(manifest?.name)}`)
  }
  return { manifest, packageDir: dirname(packagePath), packagePath }
}

function pluginEntries(document) {
  if (!isSeq(document.contents)) return []
  const found = []
  document.contents.items.forEach((patch, patchIndex) => {
    if (!isMap(patch)) return
    const insert = patch.get('insert', true)
    if (!isSeq(insert)) return
    insert.items.forEach((entry, entryIndex) => {
      if (!isMap(entry)) return
      const name = entry.get('name')
      const id = entry.get('id')
      if (KNOWN_PLUGIN_NAMES.has(name) || KNOWN_PLUGIN_NAMES.has(id)) {
        found.push({ patch, patchIndex, insert, entry, entryIndex, name, id })
      }
    })
  })
  return found
}

function parsePatch(source, patchPath = PATCH_FILE) {
  const document = parseDocument(source.trim().length === 0 ? '[]\n' : source, {
    keepSourceTokens: true,
    prettyErrors: true,
  })
  if (document.errors.length > 0) {
    const position = document.errors[0].linePos?.[0]
    const location = position ? `（第 ${position.line} 行，第 ${position.col} 列）` : ''
    throw new Error(`${patchPath} 不是有效 YAML${location}；安装器未做任何修改`)
  }
  if (document.contents === null) document.contents = document.createNode([])
  if (!isSeq(document.contents)) {
    throw new Error(`${patchPath} 顶层必须是 YAML 数组，安装器未做任何修改`)
  }
  return document
}

function removeMatches(document, matches, keepFirst) {
  const removals = keepFirst ? matches.slice(1) : matches
  const byInsert = new Map()
  for (const match of removals) {
    const indexes = byInsert.get(match.insert) ?? []
    indexes.push(match.entryIndex)
    byInsert.set(match.insert, indexes)
  }
  for (const [insert, indexes] of byInsert) {
    indexes.sort((a, b) => b - a).forEach(index => insert.items.splice(index, 1))
  }

  if (!isSeq(document.contents)) return
  for (let index = document.contents.items.length - 1; index >= 0; index -= 1) {
    const patch = document.contents.items[index]
    if (!isMap(patch) || patch.items.length !== 1) continue
    const insert = patch.get('insert', true)
    if (isSeq(insert) && insert.items.length === 0) document.contents.items.splice(index, 1)
  }
}

/** Install or migrate exactly one loader roster entry while preserving unrelated YAML nodes and comments. */
export function installRoster(source, patchPath = PATCH_FILE) {
  const document = parsePatch(source, patchPath)
  const matches = pluginEntries(document)
  let changed = false
  let migratedLegacy = false

  if (matches.length === 0) {
    document.contents.items.push(document.createNode({
      insert: [{ id: PLUGIN_ID, name: PLUGIN_ID, config: {} }],
    }))
    changed = true
  } else {
    const first = matches[0]
    if (first.id !== PLUGIN_ID) {
      first.entry.set('id', PLUGIN_ID)
      changed = true
    }
    if (first.name !== PLUGIN_ID) {
      migratedLegacy ||= first.name === LEGACY_PLUGIN_ID
      first.entry.set('name', PLUGIN_ID)
      changed = true
    }
    if (matches.length > 1) {
      migratedLegacy ||= matches.some(match => match.name === LEGACY_PLUGIN_ID || match.id === LEGACY_PLUGIN_ID)
      removeMatches(document, matches, true)
      changed = true
    }
  }

  return {
    changed,
    migratedLegacy,
    count: pluginEntries(document).length,
    output: changed ? document.toString({ lineWidth: 0 }) : source,
  }
}

/** Remove every current or legacy roster entry and leave all other patch entries untouched. */
export function uninstallRoster(source, patchPath = PATCH_FILE) {
  const document = parsePatch(source, patchPath)
  const matches = pluginEntries(document)
  if (matches.length === 0) return { changed: false, removed: 0, output: source }
  removeMatches(document, matches, false)
  return {
    changed: true,
    removed: matches.length,
    output: document.toString({ lineWidth: 0 }),
  }
}

/** Inspect current and legacy loader entries without exposing any config values. */
export function inspectRoster(source, patchPath = PATCH_FILE) {
  const document = parsePatch(source, patchPath)
  const matches = pluginEntries(document)
  return {
    current: matches.filter(match => match.name === PLUGIN_ID && match.id === PLUGIN_ID).length,
    legacy: matches.filter(match => match.name === LEGACY_PLUGIN_ID || match.id === LEGACY_PLUGIN_ID).length,
    total: matches.length,
  }
}

export async function readPatch(profileDir) {
  const patchPath = join(profileDir, PATCH_FILE)
  try {
    return { patchPath, source: await readFile(patchPath, 'utf8'), exists: true }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return { patchPath, source: '[]\n', exists: false }
  }
}

/** Back up and write one changed patch. Unchanged runs perform no filesystem write. */
export async function writePatch({ patchPath, source, output, exists }) {
  await mkdir(dirname(patchPath), { recursive: true })
  let backupPath
  let targetMode = 0o600
  if (exists) {
    targetMode = (await stat(patchPath)).mode & 0o777
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    backupPath = `${patchPath}.backup-${stamp}`
    await copyFile(patchPath, backupPath)
  }
  const temporaryPath = `${patchPath}.tmp-${process.pid}-${randomUUID()}`
  try {
    const handle = await open(temporaryPath, 'wx', targetMode)
    try {
      await handle.writeFile(output, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporaryPath, patchPath)
  } catch (error) {
    await unlink(temporaryPath).catch(() => {})
    throw error
  }
  return { backupPath, previousBytes: Buffer.byteLength(source), writtenBytes: Buffer.byteLength(output) }
}

/** Detect ancestor-level development links without following or deleting them. */
export async function inspectLegacyLinks(profileDir) {
  const profilesDir = dirname(profileDir)
  const candidates = [
    join(profilesDir, 'node_modules', LEGACY_PLUGIN_ID),
    join(profilesDir, 'node_modules', PLUGIN_ID),
  ]
  const found = []
  for (const path of candidates) {
    try {
      const info = await lstat(path)
      found.push({ path, link: info.isSymbolicLink() })
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return found
}
