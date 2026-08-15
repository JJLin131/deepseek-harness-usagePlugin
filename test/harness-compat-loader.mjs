import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let nodeModules

export function initialize(data) {
  nodeModules = data.nodeModules
}

export async function resolve(specifier, context, nextResolve) {
  const packages = {
    '@deepseek-ai/cordis': ['@deepseek-ai', 'cordis', 'lib', 'index.js'],
    '@deepseek-ai/dsh-typert-protocol': ['@deepseek-ai', 'dsh-typert-protocol', 'lib', 'index.js'],
  }
  const relative = packages[specifier]
  if (relative !== undefined) {
    return { url: pathToFileURL(join(nodeModules, ...relative)).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
