import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { signToken } from '../middleware/auth.js';
import { HttpError } from '../utils/errors.js';
import * as users from '../services/userService.js';

// A fixed hash used when the e-mail is unknown, so a failed login always costs
// one bcrypt comparison and response time does not reveal which e-mails exist.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', 10);

export const publicUser = (u) => ({
  userId: u.userId,
  fullName: u.fullName,
  email: u.email,
  regNo: u.regNo,
  phone: u.phone,
  role: { id: u.roleId, code: u.roleCode, name: u.roleName },
  canApprove: u.canApprove === 'Y',
  canAdminister: u.canAdminister === 'Y',
  department: { id: u.deptId, code: u.deptCode, name: u.deptName },
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt,
});

export async function register(req, res) {
  const { password, ...data } = req.valid.body;
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  // Self-registration always creates a STUDENT; staff roles are granted by an admin.
  const userId = await users.createUser({ ...data, passwordHash, roleId: 1 });
  const user = await users.findActiveUserById(userId);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}

export async function login(req, res) {
  const { email, password } = req.valid.body;
  const user = await users.findForLogin(email);
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || user.isActive !== 'Y') {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect e-mail or password.');
  }
  await users.recordLogin(user.userId);
  const { passwordHash, ...safe } = user;
  res.json({ token: signToken(safe), user: publicUser(safe) });
}

export function me(req, res) {
  res.json({ user: publicUser(req.user) });
}

export async function updateMe(req, res) {
  await users.updateProfile(req.user.userId, req.valid.body);
  const fresh = await users.findActiveUserById(req.user.userId);
  res.json({ user: publicUser(fresh) });
}

export async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.valid.body;
  const hash = await users.getPasswordHash(req.user.userId);
  if (!hash || !(await bcrypt.compare(currentPassword, hash))) {
    throw new HttpError(400, 'WRONG_PASSWORD', 'Current password is incorrect.');
  }
  await users.setPasswordHash(req.user.userId, await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS));
  res.status(204).end();
}
