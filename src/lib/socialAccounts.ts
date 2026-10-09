export const SOCIAL_ACCOUNTS = {
  instagram: "__bitet.hemap",
} as const;

export function socialHandle(platform: keyof typeof SOCIAL_ACCOUNTS) {
  return `@${SOCIAL_ACCOUNTS[platform]}`;
}
