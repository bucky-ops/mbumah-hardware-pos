'use client';

import React, { useState } from 'react';
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
      {/* Animated gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[oklch(0.22_0.07_260)] via-[oklch(0.295_0.1_260)] to-[oklch(0.22_0.06_260)]" />
      <div className="absolute inset-0 bg-gradient-to-tr from-[oklch(0.22_0.08_30)] via-transparent to-[oklch(0.25_0.09_150)] animate-gradient-shift" />

      {/* Decorative hardware pattern */}
      <div className="absolute inset-0 opacity-[0.04] pointer-events-none">
        <div className="absolute top-10 left-10"><Wrench className="h-24 w-24 text-white" /></div>
        <div className="absolute top-32 right-20"><Hammer className="h-16 w-16 text-white" /></div>
        <div className="absolute bottom-20 left-1/4"><Package className="h-20 w-20 text-white" /></div>
        <div className="absolute bottom-32 right-1/3"><Store className="h-28 w-28 text-white" /></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"><Wrench className="h-40 w-40 text-white" /></div>
        <div className="absolute top-60 left-1/2"><Hammer className="h-12 w-12 text-white rotate-45" /></div>
        <div className="absolute bottom-60 right-10"><Package className="h-14 w-14 text-white -rotate-12" /></div>
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Welcome tagline above card */}
        <div className="text-center mb-5 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60 mb-1.5">
            Kenya&apos;s Hardware Trade · Powered by Mbumah
          </p>
          <h2 className="text-xl font-semibold text-white/90 flex items-center justify-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-300" />
            Run your store with confidence
          </h2>
        </div>

        <Card className="shadow-2xl border border-white/10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl">
          <CardHeader className="text-center pb-2">
            {/* Animated logo */}
            <div className="mx-auto w-20 h-20 rounded-2xl overflow-hidden bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center mb-4 shadow-lg ring-4 ring-white/20 animate-pulse-slow">
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
                <Store className="h-3 w-3" /> Multi-branch
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
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 h-11"
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
                    className="pl-10 pr-10 h-11"
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
              <Button
                type="submit"
                className="w-full bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground font-semibold h-11 shadow-md shadow-accent-orange/20"
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
    </div>
  );
}
