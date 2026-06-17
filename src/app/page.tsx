"use strict";
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Sparkles, ArrowRight, Shield, Cpu, Zap } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  const router = useRouter();

  const handleStart = () => {
    router.push("/dashboard");
  };

  return (
    <div className="relative min-h-screen bg-background text-foreground overflow-x-hidden flex flex-col justify-between">
      {/* Background radial glow effects */}
      <div className="absolute top-0 left-1/2 -z-10 h-[1000px] w-[1000px] -translate-x-1/2 rounded-full bg-gradient-to-b from-violet-600/10 via-fuchsia-500/5 to-transparent blur-[120px]" />
      <div className="absolute -top-[40%] left-[20%] -z-10 h-[600px] w-[600px] rounded-full bg-indigo-500/10 blur-[150px]" />
      
      <Navbar />

      <main className="flex-grow flex items-center justify-center py-20 px-4">
        <div className="max-w-4xl w-full text-center space-y-10">
          
          {/* AI Badge */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-1.5 text-xs font-semibold text-violet-300 backdrop-blur-md"
          >
            <Sparkles className="h-4 w-4 text-fuchsia-400" />
            <span>100% In-Browser Private Processing</span>
          </motion.div>

          {/* Premium Headline */}
          <div className="space-y-4">
            <motion.h1
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="text-5xl md:text-7xl font-extrabold tracking-tight text-white leading-[1.1]"
            >
              AuraClip Studio
            </motion.h1>
            <motion.h2
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15 }}
              className="text-2xl md:text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-400 via-fuchsia-400 to-rose-400"
            >
              Welcome Rishi
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-base text-muted-foreground sm:text-lg max-w-2xl mx-auto leading-relaxed"
            >
              Cut long videos into viral 9:16 clips, apply auto-generated captions, overlay audio/music tracks, and export directly in your browser. All processed locally with no fees or subscription bills.
            </motion.p>
          </div>

          {/* Start Project CTA Button */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4"
          >
            <Button
              onClick={handleStart}
              className="group relative rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-bold text-base py-6 px-12 shrink-0 shadow-[0_0_30px_rgba(139,92,246,0.3)] hover:shadow-[0_0_35px_rgba(139,92,246,0.5)] active:scale-95 transition-all duration-300 cursor-pointer"
            >
              <span className="flex items-center gap-2">
                Start
                <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform animate-pulse" />
              </span>
              {/* Inner glowing edge */}
              <span className="absolute inset-0 rounded-full border border-white/20 pointer-events-none" />
            </Button>
          </motion.div>

          {/* Core Visual Values */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="pt-10 grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-3xl mx-auto text-left"
          >
            <div className="flex gap-3 bg-white/[0.02] border border-white/5 rounded-2xl p-5 hover:border-violet-500/20 hover:bg-white/[0.04] transition-all">
              <Shield className="h-6 w-6 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-white">0% Server Costs</h4>
                <p className="text-xs text-muted-foreground mt-1">Runs entirely client-side. No API bills or subscription tiers.</p>
              </div>
            </div>
            <div className="flex gap-3 bg-white/[0.02] border border-white/5 rounded-2xl p-5 hover:border-violet-500/20 hover:bg-white/[0.04] transition-all">
              <Cpu className="h-6 w-6 text-violet-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-white">WebAssembly Engine</h4>
                <p className="text-xs text-muted-foreground mt-1">Stitch and blend audio layers offline using client-side FFmpeg.</p>
              </div>
            </div>
            <div className="flex gap-3 bg-white/[0.02] border border-white/5 rounded-2xl p-5 hover:border-violet-500/20 hover:bg-white/[0.04] transition-all">
              <Zap className="h-6 w-6 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-white">Auto-Clips & Subtitles</h4>
                <p className="text-xs text-muted-foreground mt-1">Instant waveform slicing and fully customizable subtitles overlays.</p>
              </div>
            </div>
          </motion.div>

        </div>
      </main>

      <Footer />
    </div>
  );
}
