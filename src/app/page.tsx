"use strict";
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  const router = useRouter();

  const handleStart = () => {
    router.push("/dashboard");
  };

  return (
    <div className="relative min-h-screen bg-background text-foreground overflow-x-hidden flex flex-col">
      {/* Background radial glow */}
      <div className="absolute top-0 left-1/2 -z-10 h-[900px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-to-b from-purple-700/15 via-purple-900/8 to-transparent blur-[120px]" />
      <div className="absolute -top-[40%] left-[20%] -z-10 h-[600px] w-[600px] rounded-full bg-purple-800/10 blur-[150px]" />

      <Navbar />

      <main className="flex-grow flex items-center justify-center px-4">
        <div className="max-w-2xl w-full text-center space-y-8">

          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.05 }}
            className="flex justify-center"
          >
            <img
              src="/phoenix_frame_logo.png"
              alt="Phoenix Frame Logo"
              className="h-44 w-44 object-contain drop-shadow-[0_0_50px_rgba(168,85,247,0.55)]"
            />
          </motion.div>

          {/* Title */}
          <div className="space-y-3">
            <motion.h1
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15 }}
              className="text-5xl md:text-7xl font-extrabold tracking-tight text-white leading-[1.1]"
            >
              Phoenix Frame
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.22 }}
              className="text-lg text-muted-foreground font-medium tracking-wide"
            >
              Edit. Elevate. Inspire.
            </motion.p>
          </div>

          {/* Start Button */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.32 }}
          >
            <Button
              onClick={handleStart}
              className="group relative rounded-full bg-gradient-to-r from-purple-700 to-violet-700 hover:from-purple-600 hover:to-violet-600 text-white font-bold text-base py-6 px-14 shadow-[0_0_40px_rgba(124,58,237,0.4)] hover:shadow-[0_0_60px_rgba(124,58,237,0.6)] active:scale-95 transition-all duration-300 cursor-pointer"
            >
              <span className="flex items-center gap-2">
                Start
                <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </span>
              <span className="absolute inset-0 rounded-full border border-purple-400/30 pointer-events-none" />
            </Button>
          </motion.div>

        </div>
      </main>
    </div>
  );
}
