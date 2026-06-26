// Brute Force Protection Module
// Tracks failed login attempts and implements progressive delays and account lockout

import { blockKey, resetRateLimit } from './rate-limit';
import { db } from './db';
import { systemLog } from './logger';
import { LogSeverity, LogComponent } from './types';

interface FailedAttempt {
  count: number;
  lastAttemptAt: number;
  lockedUntil: number;
}

const failedAttempts = new Map<string, FailedAttempt>();

// Progressive lockout durations (in minutes)
const LOCKOUT_SCHEDULE = [5, 15, 30, 60, 120, 1440]; // 5min → 24hr

const MAX_FAILED_BEFORE_LOCKOUT = 5;
const CLEANUP_INTERVAL = 10 * 60 * 1000;

// Cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of failedAttempts) {
    if (entry.lockedUntil < now && entry.lastAttemptAt < now - 60 * 60 * 1000) {
      failedAttempts.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

export interface BruteForceCheckResult {
  allowed: boolean;
  failedCount: number;
  lockedUntil?: number;
  retryAfter?: number; // seconds
  message?: string;
}

/**
 * Check if a login attempt should be allowed
 * @param email - The email being attempted
 * @param ip - The IP address of the request
 */
export function checkBruteForce(email: string, ip: string): BruteForceCheckResult {
  const now = Date.now();
  
  // Check IP-based lockout
  const ipKey = `bf:ip:${ip}`;
  const ipEntry = failedAttempts.get(ipKey);
  if (ipEntry?.lockedUntil && ipEntry.lockedUntil > now) {
    const retryAfter = Math.ceil((ipEntry.lockedUntil - now) / 1000);
    return {
      allowed: false,
      failedCount: ipEntry.count,
      lockedUntil: ipEntry.lockedUntil,
      retryAfter,
      message: `Too many failed attempts from this IP. Try again in ${Math.ceil(retryAfter / 60)} minutes.`,
    };
  }
  
  // Check email-based lockout
  const emailKey = `bf:email:${email.toLowerCase()}`;
  const emailEntry = failedAttempts.get(emailKey);
  if (emailEntry?.lockedUntil && emailEntry.lockedUntil > now) {
    const retryAfter = Math.ceil((emailEntry.lockedUntil - now) / 1000);
    return {
      allowed: false,
      failedCount: emailEntry.count,
      lockedUntil: emailEntry.lockedUntil,
      retryAfter,
      message: `Account temporarily locked. Try again in ${Math.ceil(retryAfter / 60)} minutes.`,
    };
  }
  
  return { allowed: true, failedCount: emailEntry?.count || 0 };
}

/**
 * Record a failed login attempt
 */
export async function recordFailedAttempt(email: string, ip: string): Promise<BruteForceCheckResult> {
  const now = Date.now();
  const emailKey = `bf:email:${email.toLowerCase()}`;
  const ipKey = `bf:ip:${ip}`;
  
  // Update email entry
  const emailEntry = failedAttempts.get(emailKey) || { count: 0, lastAttemptAt: now, lockedUntil: 0 };
  emailEntry.count++;
  emailEntry.lastAttemptAt = now;
  
  // Update IP entry
  const ipEntry = failedAttempts.get(ipKey) || { count: 0, lastAttemptAt: now, lockedUntil: 0 };
  ipEntry.count++;
  ipEntry.lastAttemptAt = now;
  
  // Check if lockout should be applied
  if (emailEntry.count >= MAX_FAILED_BEFORE_LOCKOUT) {
    const lockoutIndex = Math.min(
      Math.floor(emailEntry.count / MAX_FAILED_BEFORE_LOCKOUT) - 1,
      LOCKOUT_SCHEDULE.length - 1
    );
    const lockoutMinutes = LOCKOUT_SCHEDULE[lockoutIndex];
    const lockedUntil = now + lockoutMinutes * 60 * 1000;
    
    emailEntry.lockedUntil = lockedUntil;
    
    // Block the rate limit key too
    blockKey(`login:${ip}`, lockoutMinutes * 60 * 1000);
    
    // Log the lockout
    try {
      await systemLog({
        action: 'ACCOUNT_LOCKED',
        component: LogComponent.AUTH,
        severity: LogSeverity.WARN,
        message: `Account ${email} locked for ${lockoutMinutes} minutes after ${emailEntry.count} failed attempts from IP ${ip}`,
        metadata: { email, ip, failedCount: emailEntry.count, lockoutMinutes },
      });
    } catch { /* ignore logging errors */ }
    
    // Also lock the user in DB if they exist
    try {
      await db.user.updateMany({
        where: { email: email.toLowerCase() },
        data: { 
          isActive: false,
          // We'll set a custom field to track lockout vs manual deactivation
        },
      });
    } catch { /* user may not exist */ }
  }
  
  // Check if IP should be blocked (10+ failures from same IP)
  if (ipEntry.count >= 10) {
    const ipLockoutMinutes = 60;
    ipEntry.lockedUntil = now + ipLockoutMinutes * 60 * 1000;
    blockKey(`login:${ip}`, ipLockoutMinutes * 60 * 1000);
    
    try {
      await systemLog({
        action: 'IP_BLOCKED',
        component: LogComponent.AUTH,
        severity: LogSeverity.CRITICAL,
        message: `IP ${ip} blocked for ${ipLockoutMinutes} minutes after ${ipEntry.count} failed attempts`,
        metadata: { ip, failedCount: ipEntry.count, lockoutMinutes: ipLockoutMinutes },
      });
    } catch { /* ignore */ }
  }
  
  failedAttempts.set(emailKey, emailEntry);
  failedAttempts.set(ipKey, ipEntry);
  
  const remaining = MAX_FAILED_BEFORE_LOCKOUT - (emailEntry.count % MAX_FAILED_BEFORE_LOCKOUT);
  return {
    allowed: true,
    failedCount: emailEntry.count,
    message: remaining <= 3 ? `Warning: ${remaining} attempt(s) remaining before account lockout.` : undefined,
  };
}

/**
 * Record a successful login (reset counters)
 */
export function recordSuccessfulLogin(email: string, ip: string): void {
  const emailKey = `bf:email:${email.toLowerCase()}`;
  const ipKey = `bf:ip:${ip}`;
  
  failedAttempts.delete(emailKey);
  // Don't delete IP entry entirely - keep it for monitoring
  const ipEntry = failedAttempts.get(ipKey);
  if (ipEntry) {
    ipEntry.count = 0; // Reset count but keep entry for tracking
  }
  
  // Reset rate limit
  resetRateLimit(`login:${ip}`);
}
