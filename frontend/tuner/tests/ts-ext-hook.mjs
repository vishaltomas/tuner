/**
 * Let Node resolve the extensionless relative imports Vite allows.
 *
 * The app's sources import `./widgets`, which the bundler resolves and Node's
 * ESM loader does not. Rather than write bundler-specific extensions into the
 * app code, the tests teach the loader the same rule.
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (error) {
    if (!specifier.startsWith('.')) throw error
    for (const suffix of ['.ts', '.tsx', '/index.ts']) {
      try {
        return await next(specifier + suffix, context)
      } catch {
        // try the next candidate
      }
    }
    throw error
  }
}
