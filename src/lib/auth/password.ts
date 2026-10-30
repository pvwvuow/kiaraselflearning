/**
 * Password hashing — bcryptjs (pure JS: same behavior in bun, node and vitest).
 * Cost 10: ~100ms — fine for a single-user-per-request MVP login path.
 */
import bcrypt from 'bcryptjs'

const BCRYPT_COST = 10

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
