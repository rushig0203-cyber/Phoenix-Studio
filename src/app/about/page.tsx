import type { Metadata } from "next";
import PublicInfoPage from "@/components/PublicInfoPage";

export const metadata: Metadata = {
  title: "About Phoenix Studio",
  description: "A personal Windows app for creating, editing and reviewing videos, with optional publishing to the owner's connected channels.",
};

export default function AboutPage() {
  return <PublicInfoPage title="Phoenix Studio" description="Create, edit and review videos in a personal Windows workspace, then choose whether to publish to your own connected channels.">
    <section>
      <h2>Make a video, then review it</h2>
      <p>Phoenix Studio can clip an imported video, assemble licensed footage, prepare narrated videos and edit saved exports. The operator&apos;s computer keeps the working files, finished videos and local job history. Optional connected services handle the requests the operator enables.</p>
      <p>Finished videos open for review and remain available for download. Check the picture, audio, captions, rights and posting details before using the final Post action.</p>
    </section>
    <section>
      <h2>Optional YouTube publishing</h2>
      <p>Phoenix Studio uses the YouTube Data API to identify the channel you authorize. Connecting identifies that channel; enabling uploads requests separate upload permission.</p>
      <p>After you review a finished video and press Post to YouTube, the app sends the selected MP4, title, description, visibility choice and made-for-kids setting to YouTube. Opening a preview or connecting an account does not publish a video.</p>
      <p>The <a href="/privacy">privacy policy</a> explains the requested permissions, local storage, optional AI features and how to disconnect or revoke access. The <a href="/terms">terms of use</a> explain review and content-rights responsibilities.</p>
    </section>
    <section>
      <h2>A personal, owner-operated app</h2>
      <p>This instance is maintained for its operator&apos;s own Windows computer and connected accounts. These public pages describe the app and its data practices. Video creation and channel-credential management belong to the local installation.</p>
      <p>Source information is available in the <a href="https://github.com/rushig0203-cyber/Phoenix-Studio">public repository</a>. For app or privacy questions, use its <a href="https://github.com/rushig0203-cyber/Phoenix-Studio/issues">issue tracker</a>. Issues are public.</p>
    </section>
  </PublicInfoPage>;
}
