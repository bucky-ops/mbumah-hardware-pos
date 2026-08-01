'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '@/lib/stores';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Wrench, Hammer, Package, Store, ShieldCheck, Smartphone,
  LogOut, Loader2, Eye, EyeOff, Mail, Sparkles,
} from 'lucide-react';

/** Generate floating particle positions (deterministic via useMemo) */
function FloatingParticles() {
  const particles = useMemo(() =>
    Array.from({ length: 20 }, (_, i) => ({
      id: i,
      x: (i * 37 + 13) % 100,
      y: (i * 53 + 7) % 100,
      size: 2 + (i % 4),
      delay: (i * 0.4) % 8,
      duration: 6 + (i % 5) * 2,
    })),
  []);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-full bg-white/[0.04] animate-float"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            '--float-duration': `${p.duration}s`,
            '--float-delay': `${p.delay}s`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const login = useAuthStore((s) => s.login);
  const isLoading = useAuthStore((s) => s.isLoading);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password);
      toast.success('Welcome to MBUMAH HARDWARE POS!');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed';
      toast.error(message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Animated gradient background — multi-layer for depth */}
      <div className="absolute inset-0 bg-gradient-to-br from-[oklch(0.22_0.07_260)] via-[oklch(0.295_0.1_260)] to-[oklch(0.22_0.06_260)]" />
      <div className="absolute inset-0 bg-gradient-to-tr from-[oklch(0.22_0.08_30)] via-transparent to-[oklch(0.25_0.09_150)] animate-gradient-shift" />
      {/* Subtle animated mesh gradient overlay */}
      <div className="absolute inset-0 opacity-30 animate-gradient-shift" style={{ animationDelay: '3s', background: 'radial-gradient(ellipse at 30% 50%, oklch(0.68 0.18 55 / 0.08) 0%, transparent 60%), radial-gradient(ellipse at 70% 30%, oklch(0.295 0.1 260 / 0.06) 0%, transparent 50%)' }} />

      {/* Floating particle pattern */}
      <FloatingParticles />

      {/* Dot grid pattern overlay */}
      <div className="absolute inset-0 dot-grid-pattern pointer-events-none" />

      {/* Decorative hardware pattern — very subtle */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none">
        <div className="absolute top-10 left-10"><Wrench className="h-24 w-24 text-white" /></div>
        <div className="absolute top-32 right-20"><Hammer className="h-16 w-16 text-white" /></div>
        <div className="absolute bottom-20 left-1/4"><Package className="h-20 w-20 text-white" /></div>
        <div className="absolute bottom-32 right-1/3"><Store className="h-28 w-28 text-white" /></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"><Wrench className="h-40 w-40 text-white" /></div>
        <div className="absolute top-60 left-1/2"><Hammer className="h-12 w-12 text-white rotate-45" /></div>
        <div className="absolute bottom-60 right-10"><Package className="h-14 w-14 text-white -rotate-12" /></div>
      </div>

      <motion.div
        className="w-full max-w-md relative z-10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Welcome tagline above card — animated entrance */}
        <motion.div
          className="text-center mb-5 text-white"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60 mb-1.5">
            Kenya&apos;s Hardware Trade · Powered by Mbumah
          </p>
          <h2 className="text-xl font-semibold text-white/90 flex items-center justify-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-300" />
            Run your store with confidence
          </h2>
        </motion.div>

        {/* Login card — glassmorphism + border shimmer */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        >
          <Card className="shadow-2xl border border-white/10 glass-card animate-border-shimmer">
            <CardHeader className="text-center pb-2">
              {/* Animated logo — scale-in entrance */}
              <motion.div
                className="mx-auto w-20 h-20 rounded-2xl overflow-hidden bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center mb-4 shadow-lg ring-4 ring-white/20 animate-glow-pulse"
                initial={{ scale: 0.3, rotate: -10 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ duration: 0.7, delay: 0.3, type: 'spring', stiffness: 200, damping: 15 }}
              >
                <img src="/logo.png" alt="Mbumah Hardware" className="w-full h-full object-cover" />
              </motion.div>
              <CardTitle className="text-2xl font-bold tracking-tight">MBUMAH HARDWARE</CardTitle>
              <CardDescription className="text-base font-medium text-foreground/70">
                Point of Sale &amp; ERP System
              </CardDescription>

              {/* Trust badges row — subtle hover effects */}
              <motion.div
                className="flex flex-wrap items-center justify-center gap-1.5 mt-3"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.5 }}
              >
                <span className="inline-flex items-center gap-1 rounded-full border border-green-200 dark:border-green-900/50 bg-green-50 dark:bg-green-950/30 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400 transition-all duration-200 hover:scale-105 hover:shadow-sm hover:bg-green-100 dark:hover:bg-green-950/50 cursor-default">
                  <ShieldCheck className="h-3 w-3" /> Bank-grade security
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400 transition-all duration-200 hover:scale-105 hover:shadow-sm hover:bg-amber-100 dark:hover:bg-amber-950/50 cursor-default">
                  <Smartphone className="h-3 w-3" /> M-Pesa Daraja ready
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 transition-all duration-200 hover:scale-105 hover:shadow-sm hover:bg-emerald-100 dark:hover:bg-emerald-950/50 cursor-default">
                  <Store className="h-3 w-3" /> Multi-branch
                </span>
              </motion.div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="email" className="text-sm font-medium">Email Address</Label>
                  </div>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10 h-11 login-input transition-all duration-200"
                      required
                      disabled={isLoading}
                      autoComplete="email"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-sm font-medium">Password</Label>
                    <button
                      type="button"
                      onClick={() => toast.info('Contact your branch manager on 0795 191 909 to reset your password.')}
                      className="text-[11px] font-medium text-primary/80 hover:text-primary underline-offset-2 hover:underline transition-colors"
                      tabIndex={-1}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10 pr-10 h-11 login-input transition-all duration-200"
                      required
                      disabled={isLoading}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                {/* Submit button — animated gradient + loading state */}
                <Button
                  type="submit"
                  className="w-full bg-gradient-to-r from-accent-orange via-amber-500 to-accent-orange hover:from-accent-orange/90 hover:via-amber-600 hover:to-accent-orange/90 text-accent-orange-foreground font-semibold h-11 shadow-md shadow-accent-orange/20 animate-gradient-button micro-click"
                  disabled={isLoading}
                  size="lg"
                >
                  <AnimatePresence mode="wait">
                    {isLoading ? (
                      <motion.span
                        key="loading"
                        className="flex items-center"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.2 }}
                      >
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing In...
                      </motion.span>
                    ) : (
                      <motion.span
                        key="idle"
                        className="flex items-center"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.2 }}
                      >
                        <LogOut className="mr-2 h-4 w-4 rotate-180" />
                        Sign In to Dashboard
                      </motion.span>
                    )}
                  </AnimatePresence>
                </Button>
              </form>
            </CardContent>
            <CardFooter className="flex flex-col gap-3 text-sm text-muted-foreground">
              <div className="flex items-center justify-center gap-3 w-full text-[11px] text-muted-foreground/70">
                <a
                  href="tel:+254795191909"
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  <Smartphone className="h-3 w-3" /> 0795 191 909
                </a>
                <span className="text-muted-foreground/30">·</span>
                <a
                  href="mailto:info@mbumahhardware.co.ke"
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  <Mail className="h-3 w-3" /> Support
                </a>
                <span className="text-muted-foreground/30">·</span>
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3" /> Privacy
                </span>
              </div>
            </CardFooter>
            {/* Subtle Kenyan flag accent at bottom */}
            <div className="flex h-1 rounded-b-xl overflow-hidden">
              <div className="flex-1 bg-black" />
              <div className="flex-1 bg-red-600" />
              <div className="flex-1 bg-green-600" />
              <div className="flex-1 bg-white" />
            </div>
          </Card>
        </motion.div>
        {/* Branding text — fade-in from below */}
        <motion.p
          className="text-center mt-4 text-xs text-white/40 font-medium tracking-wider"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.7 }}
        >
          Powered by MBUMAH HARDWARE · Made in Kenya 🇰🇪
        </motion.p>
      </motion.div>
    </div>
  );
}
