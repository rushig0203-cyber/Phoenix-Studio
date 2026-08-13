"use strict";
"use client";

import React, { useState } from "react";
import { 
  TrendingUp, 
  Users, 
  Watch, 
  Flame, 
  ExternalLink, 
  Award,
  BarChart2,
  PieChart,
  Zap
} from "lucide-react";

const Instagram = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={props.className}
  >
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
  </svg>
);

const Youtube = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={props.className}
  >
    <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17z" />
    <polygon points="10 15 15 12 10 9" />
  </svg>
);

interface AnalyticsMetric {
  title: string;
  value: string;
  change: string;
  changeType: "up" | "down";
  icon: React.ReactNode;
}

export default function ViralAnalytics() {
  const [activeClipIndex, setActiveClipIndex] = useState(0);

  const metrics: AnalyticsMetric[] = [
    { title: "Total Views", value: "248.5K", change: "+18.4%", changeType: "up", icon: <TrendingUp className="h-4 w-4 text-violet-400" /> },
    { title: "Audience Reached", value: "142.1K", change: "+24.1%", changeType: "up", icon: <Users className="h-4 w-4 text-violet-400" /> },
    { title: "Average Watch Time", value: "0:45s", change: "+8.5%", changeType: "up", icon: <Watch className="h-4 w-4 text-violet-400" /> },
    { title: "Engagement Score", value: "9.4 / 10", change: "+0.6", changeType: "up", icon: <Flame className="h-4 w-4 text-violet-400" /> },
  ];

  const publishedClips = [
    { id: "pc-1", title: "🚀 Startup Growth Hacks #1", score: 94, ytViews: "142.4K", igViews: "68.2K", comments: 1420, hookScore: "96% (A+)" },
    { id: "pc-2", title: "💡 AI Curation Intro Clip", score: 87, ytViews: "24.5K", igViews: "13.4K", comments: 242, hookScore: "89% (B+)" },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {metrics.map((m, idx) => (
          <div 
            key={idx} 
            className="rounded-2xl border border-border/40 bg-card/20 backdrop-blur-md p-5 flex items-center justify-between shadow-xl relative group hover:border-violet-500/40 hover:shadow-violet-500/5 hover:scale-[1.02] transition-all duration-300"
          >
            <div className="space-y-2">
              <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">{m.title}</span>
              <p className="text-xl font-extrabold text-white">{m.value}</p>
              <div className="flex items-center gap-1">
                <span className={`text-[10px] font-bold ${m.changeType === "up" ? "text-emerald-400" : "text-rose-400"}`}>
                  {m.change}
                </span>
                <span className="text-[9px] text-muted-foreground">vs last week</span>
              </div>
            </div>
            <div className="h-10 w-10 rounded-xl bg-white/5 border border-border/30 flex items-center justify-center group-hover:bg-violet-600/10 group-hover:border-violet-500/20 transition-all">
              {m.icon}
            </div>
          </div>
        ))}
      </div>

      {/* Retention Graph & Breakdown Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Retention Curve Simulator - Left */}
        <div className="lg:col-span-8 rounded-2xl border border-border/40 bg-slate-950 p-6 shadow-2xl space-y-6">
          <div className="flex justify-between items-center border-b border-border/20 pb-4">
            <div className="space-y-1">
              <h3 className="font-bold text-white text-sm">Audience Retention Curve</h3>
              <p className="text-xs text-muted-foreground">Analyze when viewers dropped off. Hook phase highlights first 5s.</p>
            </div>
            <div className="flex items-center gap-1.5 bg-white/5 border border-border/40 rounded-lg p-0.5 text-[10px] font-semibold">
              <span className="bg-violet-600 text-white px-2.5 py-1 rounded">Active Retention</span>
              <span className="text-muted-foreground hover:text-white px-2.5 py-1 rounded transition-colors cursor-pointer">Benchmarks</span>
            </div>
          </div>

          {/* SVG Line Graph representation */}
          <div className="relative h-60 w-full bg-slate-900/40 rounded-xl border border-border/20 p-4 flex flex-col justify-between overflow-hidden">
            {/* Background grid indicators */}
            <div className="absolute inset-0 flex flex-col justify-between p-4 pointer-events-none">
              <div className="w-full border-t border-border/10 flex justify-between text-[8px] text-muted-foreground"><span /><span>100%</span></div>
              <div className="w-full border-t border-border/10 flex justify-between text-[8px] text-muted-foreground"><span /><span>75%</span></div>
              <div className="w-full border-t border-border/10 flex justify-between text-[8px] text-muted-foreground"><span /><span>50%</span></div>
              <div className="w-full border-t border-border/10 flex justify-between text-[8px] text-muted-foreground"><span /><span>25%</span></div>
              <div className="w-full border-t border-border/10 flex justify-between text-[8px] text-muted-foreground"><span>0s</span><span>15s</span><span>30s</span><span>45s</span><span>0%</span></div>
            </div>

            {/* Glowing retention line */}
            <svg viewBox="0 0 500 200" className="w-full h-full absolute inset-0 z-10 p-4" preserveAspectRatio="none">
              <defs>
                <linearGradient id="retGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* Fill Area */}
              <path 
                d="M 0 10 Q 50 15 100 40 T 200 80 T 350 100 T 500 120 L 500 200 L 0 200 Z" 
                fill="url(#retGrad)" 
              />
              {/* Stroke line */}
              <path 
                d="M 0 10 Q 50 15 100 40 T 200 80 T 350 100 T 500 120" 
                fill="none" 
                stroke="#a78bfa" 
                strokeWidth="3" 
                strokeLinecap="round"
              />
              {/* Vertical Hook Line divider */}
              <line x1="80" y1="0" x2="80" y2="200" stroke="#f59e0b" strokeWidth="1" strokeDasharray="3" />
            </svg>

            {/* Hook Zone Indicator overlay */}
            <div className="absolute top-6 left-14 z-20 flex flex-col items-center pointer-events-none">
              <span className="text-[7px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
                ⚡ Hook Retention
              </span>
            </div>
          </div>
        </div>

        {/* Viral score metrics - Right */}
        <div className="lg:col-span-4 rounded-2xl border border-border/40 bg-card/20 backdrop-blur-md p-6 space-y-6 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-border/20 pb-3">
              <Zap className="h-4.5 w-4.5 text-violet-400" />
              <h3 className="font-bold text-white text-sm">Hook Analysis Panel</h3>
            </div>

            <div className="space-y-3">
              <div className="p-4 bg-slate-900/60 rounded-xl border border-border/40 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold text-slate-300">VIRAL HOOK INDEX</span>
                  <Award className="h-4 w-4 text-amber-400" />
                </div>
                <h4 className="text-xl font-extrabold text-white">{publishedClips[activeClipIndex].hookScore}</h4>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  The speaker uses a curiosity-gap hook within the first 2 seconds, scoring in the top 5% of viral retention benchmarks.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-300">Audience Attention Span</span>
                  <span className="font-bold text-violet-400">92%</span>
                </div>
                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-violet-600 to-indigo-500 rounded-full" style={{ width: "92%" }} />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-300">Click Through Rate (CTR)</span>
                  <span className="font-bold text-violet-400">12.4%</span>
                </div>
                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-violet-600 to-indigo-500 rounded-full" style={{ width: "78%" }} />
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 flex justify-between items-center text-xs border-t border-border/20">
            <span className="text-muted-foreground">Detailed transcript check</span>
            <button className="text-violet-400 hover:text-violet-300 font-bold hover:underline flex items-center gap-0.5 cursor-pointer bg-transparent border-0">
              Open Transcripts
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

      </div>

      {/* Performance Ledger Table */}
      <div className="rounded-2xl border border-border/40 bg-slate-950 p-6 shadow-2xl space-y-4">
        <h3 className="font-bold text-white text-sm">Omnichannel Published Performance</h3>
        
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border/20 text-muted-foreground font-bold uppercase tracking-wider text-[9px] pb-3">
                <th className="py-3 px-4">Clip Title</th>
                <th className="py-3 px-4">Viral Score</th>
                <th className="py-3 px-4">YT Shorts Views</th>
                <th className="py-3 px-4">IG Reels Views</th>
                <th className="py-3 px-4">Comments</th>
                <th className="py-3 px-4">Hook Ratio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/10 font-medium">
              {publishedClips.map((c, i) => (
                <tr 
                  key={c.id} 
                  onClick={() => setActiveClipIndex(i)}
                  className={`hover:bg-white/[0.02] cursor-pointer transition-colors ${
                    activeClipIndex === i ? "bg-violet-600/5 text-violet-300" : "text-slate-300"
                  }`}
                >
                  <td className="py-4 px-4 font-bold text-white max-w-[240px] truncate">{c.title}</td>
                  <td className="py-4 px-4">
                    <span className="bg-violet-500/10 text-violet-400 border border-violet-500/20 px-2 py-0.5 rounded font-bold">
                      {c.score}%
                    </span>
                  </td>
                  <td className="py-4 px-4 flex items-center gap-1.5 text-white">
                    <Youtube className="h-3.5 w-3.5 text-red-500" />
                    {c.ytViews}
                  </td>
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-1.5 text-white">
                      <Instagram className="h-3.5 w-3.5 text-pink-500" />
                      {c.igViews}
                    </div>
                  </td>
                  <td className="py-4 px-4 font-mono">{c.comments}</td>
                  <td className="py-4 px-4 font-bold text-amber-400">{c.hookScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
