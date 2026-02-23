import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { env } from './env.js';
const SALT_ROUNDS = 10;
export async function hashPassword(password) {
    return bcrypt.hash(password, SALT_ROUNDS);
}
export async function verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
}
export function signToken(user) {
    return jwt.sign({
        sub: user.id,
        org_id: user.org_id,
        email: user.email,
        role: user.role
    }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}
export function verifyToken(token) {
    try {
        const decoded = jwt.verify(token, env.JWT_SECRET);
        return {
            id: decoded.sub,
            org_id: decoded.org_id,
            email: decoded.email,
            role: decoded.role
        };
    }
    catch {
        return null;
    }
}
export function requireAuth(req, res, next) {
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
    if (!token) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const user = verifyToken(token);
    if (!user) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
    }
    req.user = user;
    next();
}
export function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        if (!roles.includes(req.user.role)) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }
        next();
    };
}
/** Legacy admin token check (for backward compatibility with ADMIN_TOKEN). */
export function requireAdmin(req, res, next) {
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
    if (token && token === env.ADMIN_TOKEN) {
        return next();
    }
    requireAuth(req, res, () => {
        requireRole('OWNER', 'ADMIN')(req, res, next);
    });
}
