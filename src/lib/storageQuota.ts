const disabledMessage =
  "Cloud storage quotas are disabled in free local mode. Use Phoenix Studio Review Files on this computer.";

export async function ensureCloudCapacity(
  _userId: string,
  _incomingBytes: number,
) {
  throw new Error(disabledMessage);
}
