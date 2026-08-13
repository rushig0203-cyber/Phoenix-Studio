const path = require('path');
const readline = require('readline');
const { createClient } = require(path.join(process.cwd(), 'node_modules', '@libsql', 'client'));

const client = createClient({
  url: "file:dev.db"
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

async function main() {
  console.log("\n=======================================================");
  console.log("    AURA CLIP YOUTUBE CREDENTIALS DB UPDATER");
  console.log("=======================================================");
  console.log("Please paste your Google OAuth Credentials below.");
  console.log("-------------------------------------------------------\n");
  
  const clientId = (await askQuestion("1. Client ID: ")).trim();
  const clientSecret = (await askQuestion("2. Client Secret: ")).trim();
  const accessToken = (await askQuestion("3. Access Token (from OAuth Playground): ")).trim();
  const refreshToken = (await askQuestion("4. Refresh Token (from OAuth Playground): ")).trim();
  const channelName = (await askQuestion("5. YouTube Channel Name (e.g. My Channel): ")).trim() || "My YouTube Channel";

  if (!clientId || !clientSecret || !accessToken || !refreshToken) {
    console.error("\n❌ Error: All fields are required to establish the direct connection.");
    rl.close();
    client.close();
    return;
  }

  try {
    // Get the first settings record to update, or insert a new one
    const rows = await client.execute("SELECT id, userId FROM PublishSettings LIMIT 1");
    let userId;
    
    if (rows.rows.length > 0) {
      userId = rows.rows[0].userId;
      await client.execute({
        sql: `UPDATE PublishSettings SET 
                youtubeConnected = 1,
                youtubeChannelName = ?,
                youtubeClientId = ?,
                youtubeClientSecret = ?,
                youtubeAccessToken = ?,
                youtubeRefreshToken = ?,
                updatedAt = datetime('now')
              WHERE userId = ?`,
        args: [channelName, clientId, clientSecret, accessToken, refreshToken, userId]
      });
      console.log("\n✅ Success: YouTube credentials updated successfully in the local database!");
    } else {
      // If no settings exist yet, find a user first
      const users = await client.execute("SELECT id FROM User LIMIT 1");
      if (users.rows.length === 0) {
        console.error("\n❌ Error: No users found in the database. Please register/log in to the app first.");
        rl.close();
        client.close();
        return;
      }
      userId = users.rows[0].id;
      await client.execute({
        sql: `INSERT INTO PublishSettings (
                id, userId, makeWebhookUrl, instagramConnected, youtubeConnected, youtubeChannelName,
                youtubeClientId, youtubeClientSecret, youtubeAccessToken, youtubeRefreshToken,
                aiModel, aiTone, aiInstructions, subtitleFont, subtitleColor, subtitleSize,
                subtitleStroke, subtitleUppercase, defaultMusicVolume, duckingLevel, createdAt, updatedAt
              ) VALUES (
                ?, ?, '', 0, 1, ?, ?, ?, ?, ?, 'gemini-2.0-flash', 'clickbait', '', 'Montserrat', '#FFFF00', 'lg',
                1, 1, 0.15, 0.8, datetime('now'), datetime('now')
              )`,
        args: [
          'setting_' + Math.random().toString(36).substring(2, 9),
          userId,
          channelName,
          clientId,
          clientSecret,
          accessToken,
          refreshToken
        ]
      });
      console.log("\n✅ Success: YouTube credentials created successfully in the local database!");
    }
  } catch (dbErr) {
    console.error("\n❌ Database update failed:", dbErr);
  }
  
  rl.close();
}

main()
  .catch(console.error)
  .finally(() => client.close());
