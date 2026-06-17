"use strict";
"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Video, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Footer() {
  const [email, setEmail] = useState("");
  const [isSubscribed, setIsSubscribed] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) {
      setIsSubscribed(true);
      setEmail("");
      setTimeout(() => setIsSubscribed(false), 3000);
    }
  };

  return (
    <footer className="w-full border-t border-border/40 bg-background/50 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="xl:grid xl:grid-cols-3 xl:gap-8">
          {/* Logo and Slogan */}
          <div className="space-y-6">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-500 shadow-md">
                <Video className="h-4 w-4 text-white" />
              </div>
              <span className="text-lg font-bold tracking-tight text-white">
                AuraClip
              </span>
            </Link>
            <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
              Supercharge your long-form videos. AuraClip extracts high-engagement viral clips for TikTok, Shorts, and Reels in minutes.
            </p>
            <div className="flex space-x-4">
              <a href="#" className="text-muted-foreground hover:text-white transition-colors" aria-label="Twitter">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" />
                </svg>
              </a>
              <a href="#" className="text-muted-foreground hover:text-white transition-colors" aria-label="GitHub">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                  <path d="M9 18c-4.51 2-5-2-7-2" />
                </svg>
              </a>
              <a href="#" className="text-muted-foreground hover:text-white transition-colors" aria-label="LinkedIn">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
                  <rect width="4" height="12" x="2" y="9" />
                  <circle cx="4" cy="4" r="2" />
                </svg>
              </a>
            </div>
          </div>

          {/* Navigation Links Grid */}
          <div className="mt-12 grid grid-cols-2 gap-8 xl:col-span-2 xl:mt-0">
            <div className="md:grid md:grid-cols-2 md:gap-8">
              <div>
                <h3 className="text-sm font-semibold text-white tracking-wider">Product</h3>
                <ul role="list" className="mt-4 space-y-3">
                  <li>
                    <Link href="#features" className="text-sm text-muted-foreground hover:text-white transition-colors">
                      Features
                    </Link>
                  </li>

                  <li>
                    <a href="#" className="text-sm text-muted-foreground hover:text-white transition-colors">
                      AI Auto-Caption
                    </a>
                  </li>
                  <li>
                    <a href="#" className="text-sm text-muted-foreground hover:text-white transition-colors">
                      Roadmap
                    </a>
                  </li>
                </ul>
              </div>
              <div className="mt-10 md:mt-0">
                <h3 className="text-sm font-semibold text-white tracking-wider">Resources</h3>
                <ul role="list" className="mt-4 space-y-3">
                  <li>
                    <a href="#" className="text-sm text-muted-foreground hover:text-white transition-colors">
                      Documentation
                    </a>
                  </li>
                  <li>
                    <a href="#" className="text-sm text-muted-foreground hover:text-white transition-colors">
                      Creator Guide
                    </a>
                  </li>
                  <li>
                    <a href="#" className="text-sm text-muted-foreground hover:text-white transition-colors">
                      API Support
                    </a>
                  </li>
                </ul>
              </div>
            </div>
            <div className="space-y-6">
              <h3 className="text-sm font-semibold text-white tracking-wider">Subscribe to Newsletter</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Stay updated with the latest AI video templates, editing strategies, and product updates.
              </p>
              <form onSubmit={handleSubmit} className="relative flex max-w-sm items-center gap-2">
                <input
                  type="email"
                  required
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-full border border-border/40 bg-white/5 px-4 py-2 text-sm text-white placeholder-muted-foreground focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 transition-all duration-200"
                />
                <Button
                  type="submit"
                  size="icon"
                  className="absolute right-1 rounded-full h-8 w-8 bg-violet-600 hover:bg-violet-500 text-white shrink-0 active:scale-95 transition-transform"
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </form>
              {isSubscribed && (
                <p className="text-xs text-emerald-400 font-medium animate-pulse">
                  Awesome! You&apos;ve been subscribed.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Bottom copyright and legal links */}
        <div className="mt-12 border-t border-border/30 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} AuraClip Inc. All rights reserved.
          </p>
          <div className="flex space-x-6 text-xs text-muted-foreground">
            <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-white transition-colors">Cookie Settings</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
