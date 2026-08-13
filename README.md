# AuraClip

Private creator studio with a cloud-backed video Library, editing, and publishing to Instagram and YouTube.

## Free cloud setup

1. Create a Neon Free PostgreSQL project and copy its pooled connection string to `DATABASE_URL`.
2. Create a private Cloudflare R2 Standard bucket named `auraclip` and an object API token limited to that bucket.
3. Configure bucket CORS for the local and production app origins with `GET`, `HEAD`, and `PUT` methods.
4. Copy `.env.example` to `.env` and fill the Neon, R2, authentication, OAuth, and stock-provider values.
5. Run `npx prisma migrate deploy`, then `npm run owner:create`.
6. Run `npm run dev`.

AuraClip stops at 8 GB of cloud media. When required, it removes the oldest Published media until usage is below 7 GB. Uploaded and Edited media are never removed automatically. Cloudflare currently provides 10 GB-month of free R2 Standard storage; verify the provider limit before deployment.

## OAuth callbacks

Register both local and production callbacks:

- `/api/oauth/instagram/callback`
- `/api/oauth/youtube/callback`

YouTube needs offline access and the upload scope. Instagram requires a professional account linked to a Facebook Page.

## Vercel

Import the GitHub repository into a Vercel Hobby project. Add every value from `.env.example`, using the production URL for `NEXTAUTH_URL`. Run the PostgreSQL migration and owner setup before first use. Media uploads go directly from the browser to R2 and do not use Vercel function storage.

## Docker

`docker compose up --build` runs only AuraClip. It uses the same Neon and R2 services from `.env` and creates no persistent local volumes.

## Checks

Run `npm run lint` and `npm run build`. Never commit `.env`, database files, downloaded media, or cloud credentials.
