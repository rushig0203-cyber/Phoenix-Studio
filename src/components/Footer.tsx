"use strict";
"use client";

import React from "react";
import Link from "next/link";

export default function Footer() {
  return (
    <footer className="w-full border-t border-border/20 bg-transparent">
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-2">
        <div className="flex items-center gap-2.5">
          <img
            src="/phoenix_frame_logo.png"
            alt="Phoenix Frame Logo"
            className="h-6 w-6 object-contain opacity-70"
          />
          <span className="text-xs text-muted-foreground font-medium">
            &copy; {new Date().getFullYear()} Phoenix Frame. All rights reserved.
          </span>
        </div>
        <div className="flex space-x-5 text-xs text-muted-foreground/60">
          <a href="#" className="hover:text-white transition-colors">Privacy</a>
          <a href="#" className="hover:text-white transition-colors">Terms</a>
        </div>
      </div>
    </footer>
  );
}
