"use client";

import React, { useState, useEffect, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Sparkles, Loader2, AlertCircle, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Retrieve callbackUrl or fallback to dashboard
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  // Capture NextAuth query errors if any
  useEffect(() => {
    const authError = searchParams.get("error");
    if (authError) {
      const msg =
        authError === "CredentialsSignin"
          ? "Invalid email or password. Please try again."
          : authError;
      queueMicrotask(() => setError(msg));
    }
  }, [searchParams]);

  // Sandbox auto-login: sign in immediately without requiring user input
  useEffect(() => {
    queueMicrotask(() => setIsLoading(true));
    signIn("credentials", {
      email: "sandbox@auraclip.local",
      password: "sandbox",
      callbackUrl,
      redirect: false,
    })
      .then((res) => {
        if (res && !res.error) {
          router.push(callbackUrl);
          router.refresh();
        } else {
          // If auto-login fails for any reason, reveal the form
          setIsLoading(false);
        }
      })
      .catch(() => setIsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Please fill in all fields.");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const res = await signIn("credentials", {
        email: email.trim(),
        password: password.trim(),
        callbackUrl,
        redirect: false,
      });

      if (res?.error) {
        setError(res.error === "CredentialsSignin" 
          ? "Invalid credentials. If this is your first time, check your details or password strength."
          : res.error
        );
      } else {
        // Success: Redirect to target callback url or dashboard
        router.push(callbackUrl);
        router.refresh();
      }
    } catch (err: unknown) {
      setError("An unexpected authentication error occurred. Please try again.");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-background text-foreground flex items-center justify-center px-4 overflow-hidden">
      {/* Background glowing gradients */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -z-10 h-[500px] w-[500px] rounded-full bg-gradient-to-b from-violet-600/10 via-fuchsia-500/5 to-transparent blur-[100px]" />
      
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-xl shadow-2xl relative"
      >
        {/* Glow border outline overlay */}
        <div className="absolute inset-0 rounded-2xl border border-violet-500/10 pointer-events-none" />

        <div className="text-center space-y-2 mb-8">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-[11px] font-semibold text-violet-300 backdrop-blur-md">
            <Sparkles className="h-3 w-3" />
            <span>AuraClip Portal</span>
          </div>
          
          <h2 className="text-2xl font-extrabold tracking-tight text-white mt-3">
            Welcome to AuraClip
          </h2>
          <p className="text-xs text-muted-foreground">
            Sign in or enter details to auto-register an account
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              Email Address
            </label>
            <Input
              type="email"
              placeholder="creator@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              className="bg-white/5 border-white/10 hover:border-violet-500/30 focus:border-violet-500/50 text-white rounded-lg px-3 py-2 text-sm w-full h-10 transition duration-200"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              Password
            </label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                className="bg-white/5 border-white/10 hover:border-violet-500/30 focus:border-violet-500/50 text-white rounded-lg pl-3 pr-10 py-2 text-sm w-full h-10 transition duration-200"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-white transition-colors duration-200"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-start gap-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 w-full"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </motion.div>
          )}

          <Button
            type="submit"
            disabled={isLoading}
            className="w-full h-10 mt-6 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-semibold rounded-lg shadow-lg hover:shadow-violet-500/20 active:scale-[0.98] transition-all duration-200"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Authenticating...
              </span>
            ) : (
              "Sign In / Register"
            )}
          </Button>
        </form>

        <div className="mt-8 border-t border-white/5 pt-4 text-center">
          <p className="text-[10px] text-muted-foreground leading-normal max-w-[280px] mx-auto">
            Sandbox mode enabled. Enter any credentials to automatically generate and start your session.
          </p>
        </div>
      </motion.div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="relative min-h-screen bg-background text-foreground flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
