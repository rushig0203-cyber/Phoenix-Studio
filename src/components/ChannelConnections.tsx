"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Camera, Link2, Loader2, RefreshCw, Play } from "lucide-react";
import type { ChannelPlatform, ChannelStatus } from "@/lib/channelConnections";

const button = "inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10 disabled:cursor-wait disabled:opacity-50";
const field = "mt-1 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-violet-400";
const names = { youtube: "YouTube", instagram: "Instagram" };

export default function ChannelConnections({ compact = false }: { compact?: boolean }) {
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ChannelPlatform | null>(null);
  const [notice, setNotice] = useState("");
  const [setup, setSetup] = useState<ChannelPlatform | null>(null);
  const [credentials, setCredentials] = useState({ clientId: "", clientSecret: "", accessToken: "" });
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/channels", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load channel connections.");
      setChannels(data.channels);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Channel connections are unavailable."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void load();
    const query = new URLSearchParams(window.location.search);
    if (query.has("channelError")) setNotice(query.get("channelError") || "Channel connection failed.");
    else if (query.has("channelConnected")) setNotice("Account verified and connected. Use the upload link when your video is ready.");
  }, [load]);

  function showSetup(channel: ChannelStatus) {
    setSetup(setup === channel.platform ? null : channel.platform);
    setCredentials({ clientId: channel.clientId, clientSecret: "", accessToken: "" });
    setNotice("");
  }
  async function action(platform: ChannelPlatform, data: Record<string, string>, method = "POST") {
    setBusy(platform); setNotice("");
    try {
      const response = await fetch(`/api/channels/${platform}`, { method, headers: { "Content-Type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(data) } : {}) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The channel action failed.");
      if (result.authorizationUrl) { window.location.assign(result.authorizationUrl); return; }
      setChannels(result.channels);
      setCredentials((current) => ({ ...current, clientSecret: "", accessToken: "" }));
      setNotice(method === "DELETE" ? "Disconnected from Phoenix. You can also remove Phoenix access in your platform account settings." : data.action === "configure" ? "App credentials saved securely on this PC. Now select Connect." : "Connection verified successfully.");
      if (data.action === "instagram-token") setSetup(null);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The channel action failed."); await load(); }
    finally { setBusy(null); }
  }

  return <section id="channels" className="scroll-mt-5 rounded-2xl border border-white/10 bg-[#18191d] p-5 text-white">
    <div className="flex items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 font-semibold"><Link2 className="h-4 w-4 text-violet-400"/>Your channels</h2><p className="mt-1 text-xs leading-5 text-slate-400">Connect your account to verify the posting destination. Upload reviewed videos on the platform using the links below.</p></div><button className={button} onClick={() => void load()} disabled={loading || Boolean(busy)} aria-label="Refresh channel status"><RefreshCw className="h-3.5 w-3.5"/></button></div>
    {notice && <p role="status" className="mt-3 rounded-lg border border-violet-400/20 bg-violet-400/10 p-3 text-xs leading-5 text-violet-100">{notice}</p>}
    {loading ? <p className="mt-4 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-4 w-4 animate-spin"/>Loading channels…</p> : <div className={`mt-4 grid gap-3 ${compact ? "" : "xl:grid-cols-2"}`}>
      {channels.map((channel) => {
        const platform = channel.platform, Icon = platform === "youtube" ? Play : Camera;
        return <div key={platform} className="rounded-xl border border-white/10 bg-black/15 p-4">
          <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-semibold"><Icon className={`h-4 w-4 ${platform === "youtube" ? "text-red-400" : "text-pink-400"}`}/>{names[platform]}</span><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${channel.connected ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"}`}>{channel.connected ? "Connected" : channel.state === "needs_attention" ? "Reconnect needed" : "Not connected"}</span></div>
          <p className="mt-2 text-xs text-slate-300">{channel.name || (platform === "instagram" ? "Intended account: @__bite.hemap" : "Choose your YouTube channel")}</p>
          {channel.verifiedAt && <p className="mt-1 text-[10px] text-slate-500">Last verified {new Date(channel.verifiedAt).toLocaleString()}</p>}
          {channel.error && <p className="mt-2 text-xs text-amber-300">{channel.error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {channel.connected ? <><button className={button} disabled={Boolean(busy)} onClick={() => void action(platform, { action: "verify" })}>{busy === platform ? <Loader2 className="h-3 w-3 animate-spin"/> : <RefreshCw className="h-3 w-3"/>}Check connection</button><button className={button} disabled={Boolean(busy)} onClick={() => void action(platform, {}, "DELETE")}>Disconnect</button></> : <button className={button} disabled={Boolean(busy)} onClick={() => channel.configured && channel.oauthAvailable ? void action(platform, { action: "connect" }) : showSetup(channel)}>{busy === platform ? "Connecting…" : `Connect ${names[platform]}`}</button>}
            <a className={button} href={platform === "youtube" ? "https://www.youtube.com/upload" : "https://www.instagram.com/"} target="_blank" rel="noopener noreferrer">{platform === "youtube" ? "Open YouTube upload" : "Open Instagram · Create"}<ExternalLink className="h-3 w-3"/></a>
            <button className={button} disabled={Boolean(busy)} onClick={() => showSetup(channel)}>{setup === platform ? "Close setup" : "Connection setup"}</button>
          </div>
          {setup === platform && <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
            {platform === "youtube" ? <><p className="text-xs leading-5 text-slate-400">In Google Cloud, enable YouTube Data API v3, configure the OAuth consent screen with your account as a test user, then create a Web application OAuth client. Add this exact redirect URI:</p><code className="block break-all rounded-lg bg-black/20 p-2 text-[11px] text-slate-300">{channel.redirectUri}</code><a className="inline-flex items-center gap-1 text-xs text-violet-300 underline" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">Open Google credentials<ExternalLink className="h-3 w-3"/></a><p className="text-xs text-slate-400">Phoenix requests read-only channel access. This does not enable a paid AI service or publish videos.</p></> : <><p className="text-xs leading-5 text-slate-400">Use an Instagram Creator or Business account. In Meta for Developers, create an app with Instagram API with Instagram Login, add your account as a tester, and generate its access token. Paste that token here; Phoenix verifies the profile before saving it.</p><a className="inline-flex items-center gap-1 text-xs text-violet-300 underline" href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer">Open Meta developer apps<ExternalLink className="h-3 w-3"/></a><label className="block text-xs">Instagram access token<input type="password" autoComplete="off" className={field} value={credentials.accessToken} onChange={(event) => setCredentials({ ...credentials, accessToken: event.target.value })} placeholder="Paste the token here, not in chat"/></label><button className={button} disabled={Boolean(busy) || !credentials.accessToken.trim()} onClick={() => void action(platform, { action: "instagram-token", accessToken: credentials.accessToken })}>Verify and connect Instagram</button><p className="text-xs text-slate-500">This works with local HTTP. Browser OAuth requires an HTTPS callback; {channel.oauthAvailable ? `register ${channel.redirectUri}` : "use the token option on this PC"}.</p></>}
            {(platform === "youtube" || channel.oauthAvailable) && <><label className="block text-xs">{platform === "youtube" ? "OAuth client ID" : "Instagram app ID"}<input className={field} value={credentials.clientId} onChange={(event) => setCredentials({ ...credentials, clientId: event.target.value })} autoComplete="off"/></label><label className="block text-xs">{platform === "youtube" ? "OAuth client secret" : "Instagram app secret"}<input type="password" className={field} value={credentials.clientSecret} onChange={(event) => setCredentials({ ...credentials, clientSecret: event.target.value })} autoComplete="off" placeholder={channel.hasClientSecret ? "Saved · leave blank to keep" : "Enter the app secret"}/></label><div className="flex flex-wrap gap-2"><button className={button} disabled={Boolean(busy) || !credentials.clientId.trim()} onClick={() => void action(platform, { action: "configure", clientId: credentials.clientId, clientSecret: credentials.clientSecret })}>Save app credentials</button>{channel.configured && <button className={button} disabled={Boolean(busy)} onClick={() => void action(platform, { action: "connect" })}>Connect {names[platform]}</button>}</div></>}
            <p className="text-[10px] leading-4 text-slate-500">Secrets are encrypted in this computer&apos;s private storage. Download the reviewed MP4 and copy its posting text before opening the upload page.</p>
          </div>}
        </div>;
      })}
    </div>}
  </section>;
}
