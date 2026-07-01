'use client';

import React, { useState, useMemo } from 'react';
import { useAuthStore } from '@/lib/stores';
import { DEMO_ACCOUNTS } from '@/lib/app-config';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Wrench, Hammer, Package, Store, ShieldCheck, Smartphone,
  LogOut, Loader2, Eye, EyeOff, Mail, Sparkles, Cog, Nut,
} from 'lucide-react';

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

  const fillDemo = (acct: typeof DEMO_ACCOUNTS[number]) => {
    setEmail(acct.email);
    setPassword(acct.password);
  };

  // 7. Time-based greeting
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  // 1. Floating particle definitions — positions, sizes, durations, delays
  const particles = [
    { icon: Wrench,   top: '5%',  left: '8%',  size: 'h-10 w-10',  duration: '7s',  delay: '0s',  opacity: '0.06' },
    { icon: Hammer,   top: '12%', left: '85%', size: 'h-8 w-8',   duration: '9s',  delay: '1s',  opacity: '0.05' },
    { icon: Package,  top: '35%', left: '5%',  size: 'h-9 w-9',   duration: '8s',  delay: '2s',  opacity: '0.05' },
    { icon: Cog,      top: '55%', left: '92%', size: 'h-11 w-11', duration: '10s', delay: '0.5s', opacity: '0.04' },
    { icon: Store,    top: '75%', left: '15%', size: 'h-12 w-12', duration: '11s', delay: '3s',  opacity: '0.04' },
    { icon: Wrench,   top: '20%', left: '55%', size: 'h-7 w-7',   duration: '8s',  delay: '4s',  opacity: '0.05' },
    { icon: Nut, top: '65%', left: '75%', size: 'h-8 w-8', duration: '9s',  delay: '1.5s', opacity: '0.05' },
    { icon: Hammer,   top: '85%', left: '60%', size: 'h-10 w-10', duration: '10s', delay: '2.5s', opacity: '0.04' },
    { icon: Package,  top: '45%', left: '40%', size: 'h-6 w-6',   duration: '7s',  delay: '3.5s', opacity: '0.06' },
    { icon: Cog,      top: '8%',  left: '35%', size: 'h-8 w-8',   duration: '12s', delay: '5s',  opacity: '0.03' },
    { icon: Wrench,   top: '90%', left: '88%', size: 'h-9 w-9',   duration: '9s',  delay: '0.8s', opacity: '0.04' },
    { icon: Nut, top: '50%', left: '20%', size: 'h-7 w-7', duration: '8s',  delay: '4.5s', opacity: '0.05' },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Animated gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[oklch(0.22_0.07_260)] via-[oklch(0.295_0.1_260)] to-[oklch(0.22_0.06_260)]" />
      <div className="absolute inset-0 bg-gradient-to-tr from-[oklch(0.22_0.08_30)] via-transparent to-[oklch(0.25_0.09_150)] animate-gradient-shift" />

      {/* 8. Subtle dot-grid pattern overlay */}
      <div className="absolute inset-0 dot-grid-pattern pointer-events-none" />

      {/* 1. Floating animated hardware particles */}
      <div className="absolute inset-0 pointer-events-none">
        {particles.map((p, i) => {
          const Icon = p.icon;
          return (
            <div
              key={i}
              className="absolute animate-float"
              style={{
                top: p.top,
                left: p.left,
                '--float-duration': p.duration,
                '--float-delay': p.delay,
              } as React.CSSProperties}
            >
              <Icon className={`${p.size} text-white`} style={{ opacity: p.opacity }} />
            </div>
          );
        })}
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Welcome tagline above card */}
        <div className="text-center mb-5 text-white">
          {/* 7. Time-based greeting */}
          <p className="text-sm font-medium text-white/70 mb-1">
            {greeting}
          </p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60 mb-1.5">
            Kenya&apos;s Hardware Trade · Powered by Mbumah
          </p>
          <h2 className="text-xl font-semibold text-white/90 flex items-center justify-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-300" />
            Run your store with confidence
          </h2>
        </div>

        {/* 3. Card with border shimmer + glow */}
        <Card className="shadow-2xl border border-white/10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl animate-border-shimmer">
          <CardHeader className="text-center pb-2">
            {/* 2. Logo entrance animation */}
            <div className="mx-auto w-20 h-20 rounded-2xl overflow-hidden bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center mb-4 shadow-lg ring-4 ring-white/20 animate-scale-in-logo">
              <img src="/logo.png" alt="Mbumah Hardware" className="w-full h-full object-cover" />
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">MBUMAH HARDWARE</CardTitle>
            <CardDescription className="text-base font-medium text-foreground/70">
              Point of Sale &amp; ERP System
            </CardDescription>

            {/* Trust badges row */}
            <div className="flex flex-wrap items-center justify-center gap-1.5 mt-3">
              <span className="inline-flex items-center gap-1 rounded-full border border-green-200 dark:border-green-900/50 bg-green-50 dark:bg-green-950/30 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">
                <ShieldCheck className="h-3 w-3" /> Bank-grade security
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                <Smartphone className="h-3 w-3" /> M-Pesa Daraja ready
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                <Store className="h-3 w-3" /> 5 branches
              </span>
            </div>
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
                    placeholder="cashier@mbumahhardware.co.ke"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 h-11 login-input transition-all duration-300"
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
                    className="pl-10 pr-10 h-11 login-input transition-all duration-300"
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
              {/* 5. Sign-in button with gradient animation */}
              <Button
                type="submit"
                className="w-full font-semibold h-11 shadow-md shadow-accent-orange/20 animate-gradient-button transition-all duration-300 hover:shadow-lg hover:shadow-accent-orange/30 hover:scale-[1.01] active:scale-[0.99]"
                style={{
                  background: 'linear-gradient(135deg, oklch(0.68 0.18 55), oklch(0.6 0.2 35), oklch(0.72 0.17 65))',
                  backgroundSize: '200% 200%',
                  color: 'oklch(0.175 0.05 55)',
                }}
                disabled={isLoading}
                size="lg"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing In...
                  </>
                ) : (
                  <>
                    <LogOut className="mr-2 h-4 w-4 rotate-180" />
                    Sign In to Dashboard
                  </>
                )}
              </Button>
            </form>

            {/* Demo Accounts — collapsible, lower visual weight */}
            <div className="mt-6">
              <div className="flex items-center gap-3 mb-3">
                <Separator className="flex-1" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Quick Demo Access
                </span>
                <Separator className="flex-1" />
              </div>
              {/* 4. Demo buttons with enhanced hover */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {DEMO_ACCOUNTS.map((acct) => {
                  const Icon = acct.icon;
                  return (
                    <button
                      key={acct.email}
                      type="button"
                      onClick={() => fillDemo(acct)}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all duration-200 text-center hover:scale-110 hover:shadow-lg hover:shadow-black/10 active:scale-95 hover:border-current/20 ${acct.bg}`}
                      title={`Sign in as ${acct.role}`}
                    >
                      <Icon className={`h-5 w-5 transition-transform duration-200 group-hover:scale-110 ${acct.color}`} />
                      <span className="text-[10px] font-medium leading-tight">{acct.role}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground/50 text-center mt-2.5">
                Tap a role to auto-fill credentials, then press Sign In
              </p>
            </div>
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
        {/* Branding text */}
        <p className="text-center mt-4 text-xs text-white/40 font-medium tracking-wider">
          Powered by MBUMAH HARDWARE · Made in Kenya 🇰🇪
        </p>
      </div>

      {/* 6. Version badge — bottom-right corner */}
      <div className="fixed bottom-3 right-3 z-50">
        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 backdrop-blur-sm px-2.5 py-1 text-[10px] font-mono font-medium text-white/40">
          v2.5.0
        </span>
      </div>
    </div>
  );
}
