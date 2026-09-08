export const SOCIAL_ACCOUNTS = {
  instagram: "__bite.hemap",
} as const;

export function socialHandle(platform: keyof typeof SOCIAL_ACCOUNTS) {
  return `@${SOCIAL_ACCOUNTS[platform]}`;
}
