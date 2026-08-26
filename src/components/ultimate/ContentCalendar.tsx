"use strict";
"use client";

import React, { useState } from "react";
import { 
  Calendar as CalendarIcon, 
  Clock, 
  Send, 
  Plus, 
  Check, 
  AlertCircle, 
  Globe,
  Settings,
  ChevronLeft,
  ChevronRight,
  TrendingUp
} from "lucide-react";
import { Button } from "@/components/ui/button";

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

interface ScheduledPost {
  id: string;
  clipTitle: string;
  time: string;
  day: number; // Day of month
  channels: ("youtube" | "instagram")[];
  status: "scheduled" | "published" | "failed";
}

let postCounter = Date.now();

export default function ContentCalendar() {
  const [currentMonth, setCurrentMonth] = useState("June 2026");
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([
    { id: "post-1", clipTitle: "🚀 Startup Growth Hacks #1", time: "10:00 AM", day: 15, channels: ["youtube", "instagram"], status: "published" },
    { id: "post-2", clipTitle: "💡 AI Curation Intro Clip", time: "02:30 PM", day: 18, channels: ["instagram"], status: "published" },
    { id: "post-3", clipTitle: "🔥 Alex Hormozi Mindset Hook", time: "09:00 AM", day: 22, channels: ["youtube", "instagram"], status: "scheduled" },
    { id: "post-4", clipTitle: "📈 Viral SEO Tutorial Shorts", time: "11:15 AM", day: 25, channels: ["youtube"], status: "scheduled" },
  ]);

  const [unscheduledClips] = useState([
    { id: "uc-1", title: "💥 The Brutal Truth About VC Funding", duration: 42, viralScore: 94 },
    { id: "uc-2", title: "🤫 3 Tools I Use To Automate Business", duration: 58, viralScore: 88 },
  ]);

  const [selectedDay, setSelectedDay] = useState<number | null>(22);
  const [scheduleTime, setScheduleTime] = useState("12:00 PM");
  const [caption, setCaption] = useState("This strategy is going viral right now... 🚀 Let me know your thoughts!");
  const [postDestinations, setPostDestinations] = useState({ youtube: true, instagram: true });
  const [isSyncing, setIsSyncing] = useState(false);

  const daysInMonth = Array.from({ length: 30 }, (_, i) => i + 1);

  const handleCellClick = (day: number) => {
    setSelectedDay(day);
  };

  const handleScheduleClip = (clipTitle: string) => {
    if (!selectedDay) return;
    const channelsList: ("youtube" | "instagram")[] = [];
    if (postDestinations.youtube) channelsList.push("youtube");
    if (postDestinations.instagram) channelsList.push("instagram");

    if (channelsList.length === 0) {
      alert("Please select at least one social channel (YouTube or Instagram).");
      return;
    }

    const newPost: ScheduledPost = {
      id: "post-" + (++postCounter),
      clipTitle,
      time: scheduleTime,
      day: selectedDay,
      channels: channelsList,
      status: "scheduled"
    };

    setScheduledPosts(prev => [...prev, newPost]);
    alert(`Successfully scheduled "${clipTitle}" for June ${selectedDay} at ${scheduleTime}!`);
  };

  const syncPostingQueue = () => {
    setIsSyncing(true);
    setTimeout(() => {
      setIsSyncing(false);
      alert("Successfully pushed queue updates to Make.com Webhook integrations!");
    }, 2000);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      
      {/* Calendar Grid - Left */}
      <div className="lg:col-span-8 space-y-6">
        <div className="rounded-2xl border border-border/40 bg-slate-950 p-6 shadow-2xl space-y-6">
          {/* Calendar Header Controls */}
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-5 w-5 text-violet-400" />
              <h3 className="font-bold text-white text-base">{currentMonth}</h3>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 bg-white/5 border border-border/40 rounded-lg p-0.5">
                <button className="p-1.5 rounded text-muted-foreground hover:text-white transition-colors">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button className="p-1.5 rounded text-muted-foreground hover:text-white transition-colors">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <Button
                onClick={syncPostingQueue}
                disabled={isSyncing}
                size="sm"
                className="rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs gap-1.5 px-4 cursor-pointer"
              >
                <Globe className="h-3.5 w-3.5" />
                {isSyncing ? "Syncing..." : "Sync Make Queue"}
              </Button>
            </div>
          </div>

          {/* Week Days Headers */}
          <div className="grid grid-cols-7 gap-2 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <div>Sun</div>
            <div>Mon</div>
            <div>Tue</div>
            <div>Wed</div>
            <div>Thu</div>
            <div>Fri</div>
            <div>Sat</div>
          </div>

          {/* Days Grid (Starting on Monday for representation) */}
          <div className="grid grid-cols-7 gap-2">
            {/* Blank padding cells to start June on Monday */}
            <div className="aspect-square rounded-xl bg-transparent pointer-events-none" />
            
            {daysInMonth.map((day) => {
              const postsForDay = scheduledPosts.filter(p => p.day === day);
              const isSelected = selectedDay === day;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => handleCellClick(day)}
                  className={`aspect-square rounded-xl p-2 flex flex-col justify-between text-left border relative transition-all cursor-pointer ${
                    isSelected 
                      ? "border-violet-500 bg-violet-600/10 shadow-lg" 
                      : "border-border/30 bg-white/5 hover:border-violet-500/20 hover:bg-white/10"
                  }`}
                >
                  <span className="text-[10px] font-bold text-white/95">{day}</span>
                  
                  {/* Small dots represent schedules */}
                  {postsForDay.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1 max-h-[16px] overflow-hidden">
                      {postsForDay.map(post => (
                        <div 
                          key={post.id} 
                          className={`h-2 w-2 rounded-full ${
                            post.status === "published" 
                              ? "bg-emerald-500" 
                              : "bg-violet-400 animate-pulse"
                          }`}
                          title={`${post.clipTitle} @ ${post.time}`}
                        />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Date Inspector Panel */}
        {selectedDay && (
          <div className="rounded-2xl border border-border/40 bg-card/20 backdrop-blur-md p-6 space-y-4 animate-in fade-in duration-200">
            <h4 className="font-bold text-white text-xs">Schedules for June {selectedDay}, 2026</h4>
            
            {scheduledPosts.filter(p => p.day === selectedDay).length > 0 ? (
              <div className="space-y-3">
                {scheduledPosts.filter(p => p.day === selectedDay).map(post => (
                  <div key={post.id} className="flex justify-between items-center p-3 rounded-xl border border-border/40 bg-slate-900/40">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex gap-1">
                        {post.channels.includes("youtube") && <Youtube className="h-4 w-4 text-red-500" />}
                        {post.channels.includes("instagram") && <Instagram className="h-4 w-4 text-pink-500" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white truncate max-w-[280px]">{post.clipTitle}</p>
                        <span className="text-[9px] text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {post.time}
                        </span>
                      </div>
                    </div>

                    <div>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded border ${
                        post.status === "published" 
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
                          : "bg-violet-500/10 border-violet-500/20 text-violet-400"
                      }`}>
                        {post.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">No posts scheduled for this day yet. Select an unscheduled clip on the right to post.</p>
            )}
          </div>
        )}
      </div>

      {/* Scheduler Queue drawer - Right */}
      <div className="lg:col-span-4 space-y-6">
        
        {/* Unscheduled Clips Dock */}
        <div className="rounded-2xl border border-border/40 bg-card/20 backdrop-blur-md p-6 space-y-4">
          <h3 className="font-bold text-white text-sm">Unscheduled Clips Dock</h3>
          <p className="text-xs text-muted-foreground">Select a date on the calendar, choose your destination channels, and schedule these viral clips.</p>

          <div className="space-y-3">
            {unscheduledClips.map((clip) => (
              <div 
                key={clip.id} 
                className="p-4 rounded-xl border border-border/40 bg-slate-900/60 flex flex-col gap-3 group hover:border-violet-500/40 hover:bg-slate-900 transition-all duration-300"
              >
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] text-violet-400 font-bold bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded">
                      Viral Score: {clip.viralScore}
                    </span>
                    <span className="text-[9px] text-muted-foreground font-mono">{clip.duration}s</span>
                  </div>
                  <h4 className="text-xs font-bold text-white tracking-tight leading-snug">{clip.title}</h4>
                </div>

                <div className="pt-2 border-t border-border/20 flex gap-2 justify-end">
                  <Button
                    onClick={() => handleScheduleClip(clip.title)}
                    disabled={!selectedDay}
                    size="sm"
                    className="w-full rounded-lg bg-white/5 border border-border/30 hover:bg-white/10 hover:border-violet-500/40 text-white text-[10px] font-semibold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {selectedDay ? `Schedule for Day ${selectedDay}` : "Select Calendar Date"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Channels Configuration Setup */}
        <div className="rounded-2xl border border-border/40 bg-card/20 backdrop-blur-md p-6 space-y-4">
          <h3 className="font-bold text-white text-sm">Target Channels</h3>
          
          <div className="space-y-3">
            {/* YouTube Shorts Toggle */}
            <div className="flex justify-between items-center p-2.5 rounded-lg border border-border/40 bg-white/5">
              <div className="flex items-center gap-2">
                <Youtube className="h-4 w-4 text-red-500" />
                <span className="text-xs font-semibold text-white">YouTube Shorts</span>
              </div>
              <button
                type="button"
                onClick={() => setPostDestinations(prev => ({ ...prev, youtube: !prev.youtube }))}
                className={`w-8 h-4 rounded-full transition-all relative ${
                  postDestinations.youtube ? "bg-red-500" : "bg-slate-700"
                }`}
              >
                <div 
                  className={`w-3 h-3 bg-white rounded-full absolute top-[2px] transition-all ${
                    postDestinations.youtube ? "left-4.5" : "left-1"
                  }`} 
                />
              </button>
            </div>

            {/* Instagram Reels Toggle */}
            <div className="flex justify-between items-center p-2.5 rounded-lg border border-border/40 bg-white/5">
              <div className="flex items-center gap-2">
                <Instagram className="h-4 w-4 text-pink-500" />
                <span className="text-xs font-semibold text-white">Instagram Reels</span>
              </div>
              <button
                type="button"
                onClick={() => setPostDestinations(prev => ({ ...prev, instagram: !prev.instagram }))}
                className={`w-8 h-4 rounded-full transition-all relative ${
                  postDestinations.instagram ? "bg-pink-500" : "bg-slate-700"
                }`}
              >
                <div 
                  className={`w-3 h-3 bg-white rounded-full absolute top-[2px] transition-all ${
                    postDestinations.instagram ? "left-4.5" : "left-1"
                  }`} 
                />
              </button>
            </div>
          </div>

          <div className="space-y-1.5 pt-2">
            <label className="text-[10px] uppercase font-bold text-muted-foreground">Post Time Slot</label>
            <select
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
              className="w-full rounded-lg border border-border/40 bg-white/5 px-2.5 py-1.5 text-xs text-white focus:border-violet-500 focus:outline-none cursor-pointer"
            >
              <option value="09:00 AM" className="bg-slate-900">09:00 AM (Early Rush)</option>
              <option value="12:00 PM" className="bg-slate-900">12:00 PM (Lunch Break)</option>
              <option value="02:30 PM" className="bg-slate-900">02:30 PM (Mid Afternoon)</option>
              <option value="06:00 PM" className="bg-slate-900">06:00 PM (Evening Primetime)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] uppercase font-bold text-muted-foreground">Description & Caption</label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border/40 bg-white/5 px-2.5 py-1.5 text-xs text-white focus:border-violet-500 focus:outline-none resize-none font-sans"
            />
          </div>
        </div>

      </div>

    </div>
  );
}
